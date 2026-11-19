import { sourceFetch } from './source-session'

const DEFAULT_TIMEOUT_MS = 5_000

export class LandingPageError extends Error {
  constructor(
    public readonly finalUrl: string,
    public readonly contentType: string | null
  ) {
    super(
      'That link opened a web page instead of a file. The catalog entry is probably a download page or an expired link. Open the source page, re-import the catalog, or add a direct file URL or magnet.'
    )
    this.name = 'LandingPageError'
  }
}

export interface ResolvedDownloadLink {
  uri: string
  finalUrl: string
  contentType: string | null
  contentDisposition: string | null
  landingPage: boolean
  ok: boolean
  status: number
  supportsRanges: boolean
  totalBytes: number | null
  etag: string | null
  lastModified: string | null
}

export interface ResolveDownloadLinkOptions {
  timeoutMs?: number
  /** Extra request headers, typically the source page used as a Referer. */
  headers?: Record<string, string>
}

export function isLandingPageContentType(contentType: string | null): boolean {
  if (!contentType) return false
  return contentType.toLowerCase().includes('text/html')
}

export function isLandingPageError(error: unknown): boolean {
  return error instanceof LandingPageError
}

function contentLength(response: Response): number | null {
  const value = response.headers.get('content-length')
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function totalFromContentRange(header: string | null): number | null {
  if (!header) return null
  const match = /\/(\d+)$/.exec(header)
  if (!match?.[1]) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function fetchWithTimeout(
  url: string,
  method: 'HEAD' | 'GET',
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Response> {
  // Electron's session fetch rejects `redirect: 'manual'` with "Redirect was
  // cancelled", so Chromium follows the chain itself. It enforces its own hop
  // cap and answers 3xx loops with a network error; the final hop is read from
  // Response.url when the network stack exposes it.
  return sourceFetch(url, {
    method,
    redirect: 'follow',
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  })
}

/**
 * Resolves a download URI to a final URL and classifies the target as a direct
 * file or a landing page. HEAD is tried first and a ranged GET is used as a
 * fallback for hosts that reject HEAD. Requests share the source session, so
 * cookies from a previous hop or a solved challenge are replayed here.
 */
export async function resolveDownloadLink(
  uri: string,
  options: ResolveDownloadLinkOptions = {}
): Promise<ResolvedDownloadLink> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const headers = options.headers ?? {}

  const response = await fetchWithTimeout(uri, 'HEAD', headers, timeoutMs)
  let finalResponse = response
  let finalUrl = response.url || uri
  let ok = response.ok
  let contentType = response.headers.get('content-type')
  let contentDisposition = response.headers.get('content-disposition')
  let supportsRanges = (response.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes')
  let totalBytes = contentLength(response)
  let etag = response.headers.get('etag')
  let lastModified = response.headers.get('last-modified')

  if (!ok) {
    const getResponse = await fetchWithTimeout(
      finalUrl,
      'GET',
      { ...headers, Range: 'bytes=0-0' },
      timeoutMs
    )
    finalResponse = getResponse
    finalUrl = getResponse.url || finalUrl
    ok = getResponse.ok || getResponse.status === 206
    contentType = getResponse.headers.get('content-type')
    contentDisposition = getResponse.headers.get('content-disposition')
    supportsRanges = (getResponse.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes')
    totalBytes =
      getResponse.status === 206
        ? totalFromContentRange(getResponse.headers.get('content-range'))
        : contentLength(getResponse)
    etag = getResponse.headers.get('etag')
    lastModified = getResponse.headers.get('last-modified')
  }

  const landingPage = isLandingPageContentType(contentType)
  if (landingPage) {
    throw new LandingPageError(finalUrl, contentType)
  }
  if (!ok) {
    throw new Error(`The download server returned HTTP ${finalResponse.status}.`)
  }

  return {
    uri,
    finalUrl,
    contentType,
    contentDisposition,
    landingPage,
    ok,
    status: finalResponse.status,
    supportsRanges,
    totalBytes,
    etag,
    lastModified
  }
}
