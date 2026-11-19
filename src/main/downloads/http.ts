import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync
} from 'fs'
import { once } from 'events'
import { basename, extname, join } from 'path'
import { LandingPageError, resolveDownloadLink } from './resolver'
import { prepareSource, type SourcePlan } from './source-plan'
import { sourceFetch } from './source-session'
import type { DownloadQueueItem } from '../../shared/types'

const SEGMENT_COUNT = 4
const MIN_SEGMENTED_BYTES = 4 * 1024 * 1024
const PROGRESS_INTERVAL_MS = 250

interface DownloadState {
  version: 1
  url: string
  totalBytes: number | null
  partCount: number
  etag: string | null
  lastModified: string | null
}

interface ProbeResult {
  totalBytes: number | null
  supportsRanges: boolean
  fileName: string
  contentType: string | null
  etag: string | null
  lastModified: string | null
}

class RangeUnsupportedError extends Error {
  constructor() {
    super('The server ignored a ranged request.')
    this.name = 'RangeUnsupportedError'
  }
}

export interface HttpTaskProgress {
  downloadedBytes: number
  totalBytes: number | null
}

export interface HttpTaskCallbacks {
  onProgress: (progress: HttpTaskProgress) => void
  onResolved: (filePath: string, totalBytes: number | null) => void
}

/**
 * Captured browser downloads are already the final signed URL. They also carry
 * the page's referer and the filename the host advertised, neither of which can
 * be recovered by probing the URL alone.
 */
export interface HttpTaskOverrides {
  skipPrepare?: boolean
  requestHeaders?: Record<string, string>
  preferredFileName?: string | null
  /** Page to re-prepare if a captured signed link expires mid-transfer. */
  refreshUri?: string
}

export class DownloadPausedError extends Error {
  constructor() {
    super('Download paused')
    this.name = 'DownloadPausedError'
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function sanitizeFileName(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return cleaned.slice(0, 180) || 'download'
}

function decodeFileName(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header)
  if (star?.[1]) {
    return decodeFileName(star[1].replace(/^"|"$/g, '').trim())
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain?.[1] ? decodeFileName(plain[1].trim()) : null
}

function fileNameFromUri(uri: string): string | null {
  try {
    const parsed = new URL(uri)
    const raw = basename(parsed.pathname)
    return raw && raw !== '/' ? decodeFileName(raw) : null
  } catch {
    return null
  }
}

function extensionForContentType(contentType: string | null): string {
  if (!contentType) return ''
  const normalized = contentType.toLowerCase()
  if (normalized.includes('zip')) return '.zip'
  if (normalized.includes('rar')) return '.rar'
  if (normalized.includes('7z')) return '.7z'
  if (normalized.includes('x-msdownload') || normalized.includes('executable')) return '.exe'
  if (normalized.includes('x-bittorrent')) return '.torrent'
  return ''
}

function chooseFileName(probe: ProbeResult, item: DownloadQueueItem): string {
  const guessed = sanitizeFileName(probe.fileName || fileNameFromUri(item.sourceUri) || item.title)
  if (extname(guessed)) return guessed
  return `${guessed}${extensionForContentType(probe.contentType)}`
}

function uniquePath(directory: string, fileName: string): string {
  mkdirSync(directory, { recursive: true })
  const extension = extname(fileName)
  const stem = basename(fileName, extension)
  let candidate = join(directory, fileName)
  let counter = 2
  while (existsSync(candidate)) {
    candidate = join(directory, `${stem} (${counter})${extension}`)
    counter += 1
  }
  return candidate
}

function readState(statePath: string): DownloadState | null {
  if (!existsSync(statePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as DownloadState
    return parsed.version === 1 ? parsed : null
  } catch {
    return null
  }
}

function contentLength(response: Response): number | null {
  const value = response.headers.get('content-length')
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function hostsMatch(first: string, second: string): boolean {
  try {
    return new URL(first).hostname.toLowerCase() === new URL(second).hostname.toLowerCase()
  } catch {
    return false
  }
}

function isNetworkError(error: unknown): boolean {
  return error instanceof Error && /net::ERR_/i.test(error.message)
}

function totalFromContentRange(header: string | null): number | null {
  if (!header) return null
  const match = /\/(\d+)$/.exec(header)
  if (!match?.[1]) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function probeRemote(item: DownloadQueueItem, plan: SourcePlan): Promise<ProbeResult> {
  const resolved = await resolveDownloadLink(plan.url, { headers: plan.headers })

  if (resolved.landingPage) {
    throw new LandingPageError(resolved.finalUrl, resolved.contentType)
  }
  if (!resolved.ok) {
    throw new Error(`The download server returned HTTP ${resolved.status}.`)
  }

  const fallbackName =
    fileNameFromUri(item.sourceUri) ?? fileNameFromUri(resolved.finalUrl) ?? item.title
  const probe: ProbeResult = {
    totalBytes: resolved.totalBytes,
    supportsRanges: resolved.supportsRanges,
    fileName: fileNameFromDisposition(resolved.contentDisposition) ?? fallbackName,
    contentType: resolved.contentType,
    etag: resolved.etag,
    lastModified: resolved.lastModified
  }
  const fileName = chooseFileName(probe, item)

  return {
    totalBytes: probe.totalBytes,
    supportsRanges: probe.supportsRanges,
    fileName,
    contentType: probe.contentType,
    etag: resolved.etag,
    lastModified: resolved.lastModified
  }
}

async function writeChunk(stream: ReturnType<typeof createWriteStream>, chunk: Uint8Array): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(chunk, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function closeStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject)
    stream.once('finish', resolve)
    stream.end()
  })
}

/**
 * A resumable HTTP transfer. Large files are split into four ranged requests
 * that write separate part files, then merge locally. The sidecar state file
 * and part sizes are enough to resume after pause or an app restart.
 */
export class HttpDownloadTask {
  private readonly controllers = new Set<AbortController>()
  private paused = false
  private filePath: string | null = null
  private statePath: string | null = null
  private partPaths: string[] = []
  private totalBytes: number | null = null
  private downloadedBytes = 0
  private lastReportAt = 0
  private requestUrl: string
  private requestHeaders: Record<string, string> = {}
  /** A captured CDN may reject a cross-host Referer; retry once without it. */
  private refererDropped = false

  constructor(
    private readonly item: DownloadQueueItem,
    private readonly callbacks: HttpTaskCallbacks,
    private readonly overrides: HttpTaskOverrides = {}
  ) {
    this.requestUrl = item.sourceUri
  }

  async start(): Promise<string> {
    let plan: SourcePlan
    if (this.overrides.skipPrepare) {
      plan = { url: this.item.sourceUri, headers: {} }
    } else {
      const prepared = await this.guard(() => prepareSource(this.item.sourceUri))
      if (this.paused) throw new DownloadPausedError()
      plan = prepared
    }
    this.requestUrl = plan.url
    this.requestHeaders = this.mergedHeaders(plan.headers)

    let probe: ProbeResult
    try {
      probe = await this.guard(() =>
        probeRemote(this.item, { url: this.requestUrl, headers: this.requestHeaders })
      )
    } catch (error) {
      if (!this.dropRefererOnNetworkError(error)) throw error
      probe = await this.guard(() =>
        probeRemote(this.item, { url: this.requestUrl, headers: this.requestHeaders })
      )
    }
    if (this.paused) throw new DownloadPausedError()
    if (!probe.totalBytes && !probe.supportsRanges) {
      // A length-less single stream still works; progress becomes indeterminate.
    }

    const requestedName = chooseFileName(
      this.overrides.preferredFileName
        ? { ...probe, fileName: this.overrides.preferredFileName }
        : probe,
      this.item
    )
    const itemPath = this.item.filePath
    const existingState = itemPath ? readState(`${itemPath}.ayanami.json`) : null
    const canResume =
      Boolean(itemPath) &&
      Boolean(existingState) &&
      existingState?.url === this.item.sourceUri &&
      existingState?.totalBytes === probe.totalBytes

    const filePath = canResume
      ? (itemPath as string)
      : uniquePath(this.item.savePath, requestedName)

    this.filePath = filePath
    this.statePath = `${filePath}.ayanami.json`
    this.totalBytes = probe.totalBytes ?? null
    this.callbacks.onResolved(filePath, this.totalBytes)

    if (probe.supportsRanges && probe.totalBytes && probe.totalBytes >= MIN_SEGMENTED_BYTES) {
      await this.downloadSegmented(probe, canResume)
    } else {
      await this.downloadSingle(probe)
    }

    if (this.paused) throw new DownloadPausedError()
    this.report(true)
    return filePath
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    for (const controller of this.controllers) controller.abort()
    this.report(true)
  }

  /** Deletes part files for an abandoned transfer. Completed files are kept. */
  cleanup(): void {
    for (const partPath of this.partPaths) {
      rmSync(partPath, { force: true })
    }
    if (this.statePath) rmSync(this.statePath, { force: true })
    if (this.filePath) {
      rmSync(`${this.filePath}.ayanami.download`, { force: true })
      if (!this.completed) rmSync(this.filePath, { force: true })
    }
  }

  private completed = false

  private async downloadSegmented(probe: ProbeResult, canResume: boolean): Promise<void> {
    const totalBytes = probe.totalBytes
    if (!totalBytes || !this.filePath || !this.statePath) return

    const partCount = SEGMENT_COUNT
    const chunkSize = Math.ceil(totalBytes / partCount)
    this.partPaths = Array.from({ length: partCount }, (_, index) => `${this.filePath}.ayanami.part${index}`)

    let state = canResume ? readState(this.statePath) : null
    if (
      !state ||
      state.partCount !== partCount ||
      state.totalBytes !== totalBytes ||
      state.url !== this.item.sourceUri
    ) {
      state = {
        version: 1,
        url: this.item.sourceUri,
        totalBytes,
        partCount,
        etag: probe.etag,
        lastModified: probe.lastModified
      }
      writeFileSync(this.statePath, JSON.stringify(state), 'utf8')
      for (const partPath of this.partPaths) rmSync(partPath, { force: true })
    }

    for (let index = 0; index < partCount; index += 1) {
      const start = index * chunkSize
      const end = Math.min(totalBytes - 1, start + chunkSize - 1)
      const expected = end - start + 1
      const partPath = this.partPaths[index]
      if (existsSync(partPath)) {
        const size = statSync(partPath).size
        if (size > expected) truncateSync(partPath, expected)
      }
    }

    this.downloadedBytes = this.partPaths.reduce(
      (sum, partPath) => sum + (existsSync(partPath) ? statSync(partPath).size : 0),
      0
    )
    this.report(true)

    const jobs = this.partPaths.map((partPath, index) =>
      this.downloadPart(probe, partPath, index, chunkSize, totalBytes)
    )
    const results = await Promise.allSettled(jobs)
    if (this.paused) throw new DownloadPausedError()

    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) {
      if (failure.reason instanceof RangeUnsupportedError) {
        for (const partPath of this.partPaths) rmSync(partPath, { force: true })
        if (this.statePath) rmSync(this.statePath, { force: true })
        this.downloadedBytes = 0
        await this.downloadSingle({ ...probe, supportsRanges: false })
        return
      }
      throw failure.reason
    }

    const finalPath = this.filePath
    const output = createWriteStream(finalPath, { flags: 'w' })
    try {
      for (const partPath of this.partPaths) {
        if (!existsSync(partPath)) throw new Error('A download part is missing.')
        for await (const chunk of createReadStream(partPath)) {
          if (!output.write(chunk)) await once(output, 'drain')
        }
      }
      await closeStream(output)
    } catch (error) {
      output.destroy()
      throw error
    }

    const finalSize = statSync(finalPath).size
    if (finalSize !== totalBytes) {
      throw new Error(`The merged file is ${finalSize} bytes; expected ${totalBytes}.`)
    }

    for (const partPath of this.partPaths) rmSync(partPath, { force: true })
    rmSync(this.statePath, { force: true })
    this.downloadedBytes = totalBytes
    this.completed = true
    this.report(true)
  }

  private async downloadPart(
    probe: ProbeResult,
    partPath: string,
    index: number,
    chunkSize: number,
    totalBytes: number
  ): Promise<void> {
    const start = index * chunkSize
    const end = Math.min(totalBytes - 1, start + chunkSize - 1)
    const expected = end - start + 1

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.paused) throw new DownloadPausedError()
      const existing = existsSync(partPath) ? statSync(partPath).size : 0
      if (existing >= expected) return

      const controller = new AbortController()
      this.controllers.add(controller)
      let stream: ReturnType<typeof createWriteStream> | null = null
      try {
        const response = await sourceFetch(this.requestUrl, {
          headers: {
            ...this.requestHeaders,
            Range: `bytes=${start + existing}-${end}`,
            ...(probe.etag ? { 'If-Range': probe.etag } : {})
          },
          redirect: 'follow',
          signal: controller.signal
        })

        if (this.paused) throw new DownloadPausedError()
        if (
          (response.status === 401 || response.status === 403 || response.status === 410) &&
          attempt < 2
        ) {
          // The host's signed link expired mid-transfer. Fetch a fresh one and
          // retry the same range instead of failing a multi-gigabyte download.
          await response.body?.cancel().catch(() => {})
          if (await this.refreshSource()) continue
        }
        if (response.status === 200) {
          throw new RangeUnsupportedError()
        }
        if (response.status !== 206) {
          throw new Error(`The server returned HTTP ${response.status} for a file segment.`)
        }
        if (!response.body) throw new Error('The download response was empty.')

        stream = createWriteStream(partPath, { flags: 'a' })
        const reader = response.body.getReader()
        let received = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (this.paused) throw new DownloadPausedError()
          if (!value) continue
          received += value.length
          this.downloadedBytes += value.length
          await writeChunk(stream, value)
          this.report()
        }
        await closeStream(stream)
        stream = null

        const actual = existsSync(partPath) ? statSync(partPath).size : 0
        if (actual !== expected) {
          throw new Error(
            `A file segment ended at ${actual} bytes; expected ${expected}.`
          )
        }
        return
      } catch (error) {
        if (stream) {
          stream.destroy()
          stream = null
        }
        if (error instanceof RangeUnsupportedError) throw error
        if (this.paused || (error instanceof Error && error.name === 'AbortError')) {
          throw new DownloadPausedError()
        }
        if (this.dropRefererOnNetworkError(error)) continue
        if (attempt >= 2) throw error
        await delay(600 * (attempt + 1))
      } finally {
        this.controllers.delete(controller)
      }
    }
  }

  private async downloadSingle(probe: ProbeResult): Promise<void> {
    if (!this.filePath) return
    const temporaryPath = `${this.filePath}.ayanami.download`
    mkdirSync(this.item.savePath, { recursive: true })

    // Single-stream transfers keep a sidecar too, so pausing below 4 MB (or on
    // servers without range support) resumes into the same file instead of
    // allocating a duplicate "(2)" download.
    if (this.statePath && !existsSync(this.statePath)) {
      writeFileSync(
        this.statePath,
        JSON.stringify({
          version: 1,
          url: this.item.sourceUri,
          totalBytes: probe.totalBytes,
          partCount: 0,
          etag: probe.etag,
          lastModified: probe.lastModified
        } satisfies DownloadState),
        'utf8'
      )
    }

    let offset = existsSync(temporaryPath) ? statSync(temporaryPath).size : 0
    this.downloadedBytes = offset
    this.totalBytes = probe.totalBytes ?? null
    this.report(true)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.paused) throw new DownloadPausedError()
      offset = existsSync(temporaryPath) ? statSync(temporaryPath).size : 0
      const controller = new AbortController()
      this.controllers.add(controller)
      let stream: ReturnType<typeof createWriteStream> | null = null
      try {
        const headers: Record<string, string> = { ...this.requestHeaders }
        if (offset > 0) headers.Range = `bytes=${offset}-`

        const response = await sourceFetch(this.requestUrl, {
          headers,
          redirect: 'follow',
          signal: controller.signal
        })
        if (this.paused) throw new DownloadPausedError()
        if (!response.ok) {
          if (
            (response.status === 401 || response.status === 403 || response.status === 410) &&
            attempt < 2
          ) {
            await response.body?.cancel().catch(() => {})
            if (await this.refreshSource()) continue
          }
          throw new Error(`The download server returned HTTP ${response.status}.`)
        }
        if (!response.body) throw new Error('The download response was empty.')

        const ranged = response.status === 206
        if (!ranged && offset > 0) {
          rmSync(temporaryPath, { force: true })
          offset = 0
          this.downloadedBytes = 0
        }

        const total =
          totalFromContentRange(response.headers.get('content-range')) ??
          (response.status === 206
            ? offset + (contentLength(response) ?? 0)
            : contentLength(response))
        if (total && total > 0) this.totalBytes = total

        stream = createWriteStream(temporaryPath, { flags: ranged && offset > 0 ? 'a' : 'w' })
        const reader = response.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (this.paused) throw new DownloadPausedError()
          if (!value) continue
          this.downloadedBytes += value.length
          await writeChunk(stream, value)
          this.report()
        }
        await closeStream(stream)
        stream = null
        break
      } catch (error) {
        if (stream) {
          stream.destroy()
          stream = null
        }
        if (this.paused || (error instanceof Error && error.name === 'AbortError')) {
          throw new DownloadPausedError()
        }
        if (this.dropRefererOnNetworkError(error)) continue
        if (attempt >= 2) throw error
        await delay(600 * (attempt + 1))
      } finally {
        this.controllers.delete(controller)
      }
    }

    if (this.paused) throw new DownloadPausedError()
    const finalPath = this.filePath
    if (!finalPath) throw new Error('The download path was not resolved.')
    const temporaryExists = existsSync(temporaryPath)
    if (!temporaryExists) throw new Error('The downloaded file is missing.')
    renameSync(temporaryPath, finalPath)
    if (this.statePath) rmSync(this.statePath, { force: true })
    this.downloadedBytes = statSync(finalPath).size
    this.totalBytes = this.totalBytes ?? this.downloadedBytes
    this.completed = true
    this.report(true)
  }

  private report(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastReportAt < PROGRESS_INTERVAL_MS) return
    this.lastReportAt = now
    this.callbacks.onProgress({
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes
    })
  }

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      if (this.paused) throw new DownloadPausedError()
      throw error
    }
  }

  /** Re-resolves a signed source link; false when nothing changed. */
  private async refreshSource(): Promise<boolean> {
    try {
      const sourceUri = this.overrides.refreshUri ?? this.item.sourceUri
      const plan = await prepareSource(sourceUri)
      if (plan.url === this.requestUrl) return false
      this.requestUrl = plan.url
      // A refreshed link is a new request context: try its faithful referer
      // again and let the network-error fallback drop it if the CDN objects.
      this.refererDropped = false
      this.requestHeaders = this.mergedHeaders(plan.headers)
      return true
    } catch {
      return false
    }
  }

  private mergedHeaders(base: Record<string, string>): Record<string, string> {
    const headers = { ...base, ...(this.overrides.requestHeaders ?? {}) }
    if (this.refererDropped) delete headers.Referer
    return headers
  }

  /**
   * Some CDNs reject a Referer from a different host with a client-level
   * network error. The captured URL is already signed, so retrying without the
   * cross-host Referer is safe; a same-host referer gate (MegaDB) is kept.
   */
  private dropRefererOnNetworkError(error: unknown): boolean {
    if (!isNetworkError(error) || this.refererDropped) return false
    if (!this.overrides.skipPrepare) return false
    const referer = this.requestHeaders.Referer
    if (!referer || hostsMatch(referer, this.requestUrl)) return false
    this.refererDropped = true
    const headers = { ...this.requestHeaders }
    delete headers.Referer
    this.requestHeaders = headers
    return true
  }
}
