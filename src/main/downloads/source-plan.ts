import { net } from 'electron'
import { sourceFetch, sourceSession } from './source-session'

/**
 * Some file hosts gate their file page behind a referer. The value is never
 * hardcoded here: Buzzheavier redirects to the publisher when the referer is
 * missing, so its origin is discovered from that redirect and cached, while
 * MegaDB simply expects its own origin.
 */
const BUZZHEAVIER_HOSTS = new Set(['bzzhr.to', 'buzzheavier.com'])
const SAME_ORIGIN_REFERER_HOSTS = new Set(['megadb.net'])

const discoveredReferers = new Map<string, string>()

/**
 * Buzzheavier renders the signed link into the file page as `hx-get`
 * (`/id/download?t=<timestamp>.<signature>`). The signature is issued for the
 * page view, so it is used immediately and refreshed if a transfer later gets
 * a 401/403/410.
 */
const SIGNED_DOWNLOAD_PATTERN = /(?:hx-get|href)="([^"]*\/download\?t=[^"&]+(?:&amp;[^"]*)?)"/i

const PAGE_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'

export interface SourcePlan {
  /** URL the transfer engine should request. */
  url: string
  /** Headers the host requires (Referer, mostly). */
  headers: Record<string, string>
}

export function hostOf(uri: string): string | null {
  try {
    const host = new URL(uri).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return null
  }
}

/**
 * Reads the referer a host expects from the host itself. Without a referer,
 * Buzzheavier answers with a 303 to the publisher that linked the file, so the
 * redirect origin is exactly the value the following request must send.
 */
function discoverReferer(uri: string, host: string): Promise<string | null> {
  const cached = discoveredReferers.get(host)
  if (cached) return Promise.resolve(cached)

  return new Promise((resolve) => {
    let settled = false
    let request: ReturnType<typeof net.request> | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (value) discoveredReferers.set(host, value)
      resolve(value)
    }

    try {
      request = net.request({
        url: uri,
        session: sourceSession(),
        redirect: 'manual',
        method: 'GET'
      })
    } catch {
      finish(null)
      return
    }

    request.on('redirect', (_status, _method, redirectUrl) => {
      let origin: string | null = null
      try {
        origin = new URL(redirectUrl).origin
      } catch {
        // A non-http redirect target cannot be used as a referer.
      }
      finish(origin && origin !== 'null' ? origin : null)
      request?.abort()
    })
    request.on('response', () => {
      finish(null)
      request?.abort()
    })
    request.on('error', () => finish(null))

    timer = setTimeout(() => {
      finish(null)
      request?.abort()
    }, 6_000)

    request.end()
  })
}

/**
 * The referer a source page's initial navigation needs. MegaDB rejects a deep
 * link without its own origin, and Buzzheavier expects the publisher origin it
 * redirects to when no referer is supplied.
 */
export function sourcePageReferer(uri: string): Promise<string | null> {
  const host = hostOf(uri)
  return host ? refererFor(uri, host) : Promise.resolve(null)
}

async function refererFor(uri: string, host: string): Promise<string | null> {
  if (SAME_ORIGIN_REFERER_HOSTS.has(host)) {
    try {
      return new URL(uri).origin
    } catch {
      return null
    }
  }

  if (BUZZHEAVIER_HOSTS.has(host)) {
    return discoverReferer(uri, host)
  }

  return null
}

async function resolveBuzzheavier(uri: string, referer: string | null): Promise<SourcePlan | null> {
  const headers: Record<string, string> = { Accept: PAGE_ACCEPT }
  if (referer) headers.Referer = referer

  const response = await sourceFetch(uri, {
    redirect: 'follow',
    headers,
    signal: AbortSignal.timeout(10_000)
  })

  // A missing referer or an unknown id lands on the publisher's home page,
  // which has no signed link, so this naturally reports a landing page later.
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    return null
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) {
    // Already a file (for example a direct CDN link); nothing to unwrap.
    await response.body?.cancel().catch(() => {})
    return { url: uri, headers: referer ? { Referer: referer } : {} }
  }

  const html = await response.text()
  const signed = SIGNED_DOWNLOAD_PATTERN.exec(html)?.[1]
  if (!signed) return null

  const absolute = new URL(signed.replace(/&amp;/g, '&'), uri).href
  return { url: absolute, headers: referer ? { Referer: referer } : {} }
}

/**
 * Turns a catalog URI into the request the transfer engine should make.
 * Direct hosts pass through; hosts behind a signed landing page are unwrapped
 * here so the segmented downloader can issue range requests against the CDN.
 */
export async function prepareSource(uri: string): Promise<SourcePlan> {
  const host = hostOf(uri)
  if (!host) return { url: uri, headers: {} }

  const referer = await refererFor(uri, host)

  if (BUZZHEAVIER_HOSTS.has(host)) {
    try {
      const plan = await resolveBuzzheavier(uri, referer)
      if (plan) return plan
    } catch {
      // Fall through to the page URL; the resolver reports the real failure.
    }
  }

  return { url: uri, headers: referer ? { Referer: referer } : {} }
}
