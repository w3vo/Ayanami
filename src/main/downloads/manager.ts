import { mkdirSync } from 'fs'
import { basename } from 'path'
import type {
  DownloadQueueItem,
  DownloadSettings,
  DownloadUpdateEvent,
  NewDownloadInput,
  QueueDownloadResult,
  ReleaseType,
  StoreGame
} from '../../shared/types'
import { isAutomaticDownloadUri } from '../../shared/download-links'
import {
  DownloadPausedError,
  HttpDownloadTask,
  type HttpTaskOverrides,
  type HttpTaskProgress
} from './http'
import { Postprocessor } from './postprocess'
import { DownloadRepository } from './repository'
import { DownloadSettingsStore } from './settings'
import {
  TorrentDownloadTask,
  TorrentPausedError,
  type TorrentTaskProgress
} from './torrent'
import { isLandingPageError } from './resolver'

const MAX_ACTIVE_DOWNLOADS = 2
const PERSIST_INTERVAL_MS = 1_500

/**
 * A browser-captured link is valid for a short time and may be bound to the
 * page's cookies and referer. It is queued as-is instead of being re-resolved.
 */
export interface CapturedDownloadInput {
  title: string
  sourceUri: string
  originUri: string
  releaseType: ReleaseType
  savePath?: string
  totalBytes?: number | null
  preferredFileName?: string | null
  referer?: string | null
}

interface ActiveDownload {
  task: HttpDownloadTask | TorrentDownloadTask
  lastBytes: number
  lastSampleAt: number
  speed: number
}

function isPausedError(error: unknown): boolean {
  return error instanceof DownloadPausedError || error instanceof TorrentPausedError
}

function titleFromUri(uri: string): string {
  if (uri.startsWith('magnet:')) {
    try {
      const name = new URL(uri).searchParams.get('dn')
      if (name?.trim()) return name.trim()
    } catch {
      // Fall through to the generic label.
    }
    return 'Torrent download'
  }

  if (/\.torrent$/i.test(uri)) {
    return basename(uri).replace(/\.torrent$/i, '').trim() || 'Torrent download'
  }

  try {
    const parsed = new URL(uri)
    const name = decodeURIComponent(basename(parsed.pathname))
    if (name) return name.replace(/\.[a-z0-9]{2,5}$/i, '') || name
  } catch {
    // Fall through to the generic label.
  }
  return 'Untitled download'
}

function inferDownloadType(uri: string): 'torrent' | 'http' {
  if (uri.startsWith('magnet:')) return 'torrent'
  if (/^https?:\/\//i.test(uri)) {
    return /\.torrent(?:[?#]|$)/i.test(uri) ? 'torrent' : 'http'
  }
  throw new Error('Enter a magnet link or an http(s) download URL.')
}

function normalizeReleaseType(value: unknown): ReleaseType {
  return value === 'repack' ? 'repack' : 'preinstalled'
}

/**
 * Owns the live transfer queue. HTTP and torrent tasks are interchangeable at
 * this level; both expose progress, pause, and cleanup. Two transfers run at a
 * time, queued items start automatically, and completed files are handed to the
 * post-download workflow.
 */
export class DownloadManager {
  private readonly items = new Map<number, DownloadQueueItem>()
  private readonly active = new Map<number, ActiveDownload>()
  private readonly mirrorLists = new Map<number, string[]>()
  private readonly lastPersistAt = new Map<number, number>()
  /** Catalog page a captured transfer came from; M4 will persist this. */
  private readonly origins = new Map<number, string>()
  private readonly overrides = new Map<number, HttpTaskOverrides>()
  /** Captured transfers get the extra transfer slot and sort first. */
  private readonly immediate = new Set<number>()
  private stopped = false

  constructor(
    private readonly repository: DownloadRepository,
    private readonly settings: DownloadSettingsStore,
    private readonly postprocessor: Postprocessor,
    private readonly broadcast: (event: DownloadUpdateEvent) => void
  ) {
    for (const item of repository.list()) {
      this.items.set(item.id, item)
    }
  }

  initialize(): void {
    this.startQueued()
  }

  list(): DownloadQueueItem[] {
    return [...this.items.values()].sort((first, second) => second.id - first.id)
  }

  getSettings(): DownloadSettings {
    return this.settings.get()
  }

  updateSettings(input: Partial<DownloadSettings>): DownloadSettings {
    return this.settings.update(input)
  }

  add(input: NewDownloadInput): QueueDownloadResult {
    const torrentPath = input.torrentPath?.trim() ?? ''
    const uri = input.uri?.trim() ?? ''
    const sourceUri = torrentPath || uri
    if (!sourceUri) {
      throw new Error('Enter a magnet link or an http(s) download URL, or choose a .torrent file.')
    }

    const downloadType = torrentPath ? 'torrent' : inferDownloadType(uri)
    const existing = this.repository.findActiveByUri(sourceUri)
    if (existing) {
      this.items.set(existing.id, existing)
      return { item: existing, alreadyQueued: true }
    }

    const title = input.title?.trim() || titleFromUri(sourceUri)
    const savePath = input.savePath?.trim() || this.settings.get().downloadDirectory
    mkdirSync(savePath, { recursive: true })

    const item = this.repository.create({
      title,
      sourceUri,
      downloadType,
      releaseType: normalizeReleaseType(input.releaseType),
      savePath
    })
    this.items.set(item.id, item)
    this.emit(item)
    this.startQueued()
    return { item, alreadyQueued: false }
  }

  queueStoreGame(game: StoreGame): QueueDownloadResult {
    if (!game.download.url) throw new Error('This catalog entry does not include a download.')
    if (!game.download.type || !game.download.releaseType) {
      throw new Error('This catalog entry is missing its download type.')
    }

    const existing = this.repository.findActiveByUri(game.download.url)
    if (existing) {
      this.items.set(existing.id, existing)
      return { item: existing, alreadyQueued: true }
    }

    const savePath = this.settings.get().downloadDirectory
    mkdirSync(savePath, { recursive: true })
    const item = this.repository.create({
      title: game.title,
      sourceUri: game.download.url,
      downloadType: game.download.type,
      releaseType: game.download.releaseType,
      savePath,
      totalBytes: game.download.sizeBytes
    })
    this.items.set(item.id, item)
    this.mirrorLists.set(item.id, [
      game.download.url,
      ...game.download.mirrors.filter((mirror) => mirror && mirror !== game.download.url)
    ])
    this.emit(item)
    this.startQueued()
    return { item, alreadyQueued: false }
  }

  /**
   * Queues a link the source window watched Chromium request. The URL is the
   * already-signed final link, so the HTTP engine must not re-prepare it.
   */
  addCaptured(input: CapturedDownloadInput): QueueDownloadResult {
    const sourceUri = input.sourceUri.trim()
    if (!/^https?:\/\//i.test(sourceUri)) {
      throw new Error('The source page produced a download Ayanami cannot replay.')
    }
    const originUri = input.originUri.trim()
    if (!originUri) throw new Error('The download source page is missing.')

    const existing = this.findCaptured(sourceUri, originUri)
    if (existing) {
      this.items.set(existing.id, existing)
      return { item: existing, alreadyQueued: true }
    }

    const savePath = input.savePath?.trim() || this.settings.get().downloadDirectory
    mkdirSync(savePath, { recursive: true })
    const item = this.repository.create({
      title: input.title.trim() || titleFromUri(sourceUri),
      sourceUri,
      downloadType: 'http',
      releaseType: normalizeReleaseType(input.releaseType),
      savePath,
      totalBytes: input.totalBytes ?? null
    })

    this.items.set(item.id, item)
    this.origins.set(item.id, originUri)
    this.immediate.add(item.id)
    this.overrides.set(item.id, {
      skipPrepare: true,
      requestHeaders: input.referer ? { Referer: input.referer } : {},
      preferredFileName: input.preferredFileName ?? null,
      ...(isAutomaticDownloadUri(originUri) ? { refreshUri: originUri } : {})
    })
    this.emit(item)
    this.startQueued()
    return { item, alreadyQueued: false }
  }

  /** Page a captured/failed transfer came from; falls back to its URL. */
  getOriginUri(id: number): string | null {
    return this.origins.get(id) ?? this.items.get(id)?.sourceUri ?? null
  }

  private findCaptured(sourceUri: string, originUri: string): DownloadQueueItem | null {
    const byUrl = this.repository.findActiveByUri(sourceUri)
    if (byUrl) return byUrl

    for (const [id, origin] of this.origins) {
      if (origin !== originUri) continue
      const item = this.items.get(id)
      if (
        item &&
        (item.status === 'queued' || item.status === 'downloading' || item.status === 'paused')
      ) {
        return item
      }
    }
    return null
  }

  pause(id: number): DownloadQueueItem {
    const item = this.items.get(id)
    if (!item) throw new Error('That download no longer exists.')
    if (item.status !== 'downloading' && item.status !== 'queued') return item

    const active = this.active.get(id)
    if (active) {
      active.task.pause()
      this.active.delete(id)
    }

    const updated = this.patch(id, {
      status: 'paused',
      downloadSpeed: 0,
      uploadSpeed: 0,
      etaSeconds: null,
      updatedAt: new Date().toISOString()
    })
    this.startQueued()
    return updated
  }

  resume(id: number): DownloadQueueItem {
    const item = this.items.get(id)
    if (!item) throw new Error('That download no longer exists.')
    if (item.status === 'complete') return item

    const updated = this.patch(id, {
      status: 'queued',
      errorMessage: null,
      downloadSpeed: 0,
      uploadSpeed: 0,
      etaSeconds: null,
      updatedAt: new Date().toISOString()
    })
    this.startQueued()
    return updated
  }

  retryPostprocess(id: number): DownloadQueueItem {
    const item = this.items.get(id)
    if (!item) throw new Error('That download no longer exists.')
    if (item.status !== 'complete') {
      throw new Error('Finish the download before retrying its post-processing.')
    }
    const updated = this.patch(id, {
      postprocessStatus: 'pending',
      postprocessMessage: 'Retrying post-processing…',
      updatedAt: new Date().toISOString()
    })
    void this.runPostprocess(updated)
    return updated
  }

  remove(id: number): void {
    const item = this.items.get(id)
    if (!item) return

    const active = this.active.get(id)
    if (active) {
      active.task.pause()
      this.active.delete(id)
      if (item.status !== 'complete') {
        // Let active streams close before Windows tries to delete their files.
        setTimeout(() => active.task.cleanup(), 600)
      }
    }

    this.items.delete(id)
    this.lastPersistAt.delete(id)
    this.origins.delete(id)
    this.overrides.delete(id)
    this.immediate.delete(id)
    this.mirrorLists.delete(id)
    try {
      this.repository.remove(id)
    } catch {
      // The row may already be gone; removal is still successful from the UI.
    }
    this.broadcast({ id, item: null })
    this.startQueued()
  }

  shutdown(): void {
    this.stopped = true
    for (const [id, active] of this.active) {
      active.task.pause()
      const item = this.items.get(id)
      if (item) {
        this.persist(
          this.patchInMemory(id, {
            status: 'paused',
            downloadSpeed: 0,
            uploadSpeed: 0,
            etaSeconds: null
          }),
          true
        )
      }
    }
    this.active.clear()
  }

  close(): void {
    this.repository.close()
  }

  private startQueued(): void {
    if (this.stopped) return
    const queued = [...this.items.values()]
      .filter((item) => item.status === 'queued')
      .sort((first, second) => {
        const firstPriority = this.immediate.has(first.id) ? 0 : 1
        const secondPriority = this.immediate.has(second.id) ? 0 : 1
        return firstPriority - secondPriority || first.id - second.id
      })

    // Captured links are time-limited. Let one of them start as a third
    // transfer instead of waiting behind two large ordinary downloads, while
    // ordinary transfers still keep their two-slot limit.
    let normalActive = [...this.active.keys()].filter((id) => !this.immediate.has(id)).length

    for (const item of queued) {
      const captured = this.immediate.has(item.id)
      if (captured) {
        if (this.active.size >= MAX_ACTIVE_DOWNLOADS + 1) break
      } else if (normalActive >= MAX_ACTIVE_DOWNLOADS) {
        continue
      }
      if (this.active.has(item.id)) continue
      this.startItem(item)
      if (!captured) normalActive += 1
    }
  }

  private startItem(item: DownloadQueueItem): void {
    const started = this.patch(item.id, {
      status: 'downloading',
      errorMessage: null,
      downloadSpeed: 0,
      uploadSpeed: 0,
      etaSeconds: null,
      updatedAt: new Date().toISOString()
    })

    const active: ActiveDownload = {
      task:
        started.downloadType === 'torrent'
          ? new TorrentDownloadTask(started, {
              onProgress: (progress) => this.handleTorrentProgress(started.id, progress),
              onResolved: (filePath, totalBytes) =>
                this.handleResolved(started.id, filePath, totalBytes)
            })
          : new HttpDownloadTask(
              started,
              {
                onProgress: (progress) => this.handleHttpProgress(started.id, progress),
                onResolved: (filePath, totalBytes) =>
                  this.handleResolved(started.id, filePath, totalBytes)
              },
              this.overrides.get(started.id)
            ),
      lastBytes: started.downloadedBytes,
      lastSampleAt: Date.now(),
      speed: 0
    }
    this.active.set(started.id, active)

    active.task
      .start()
      .then((filePath) => {
        if (this.stopped || this.active.get(item.id) !== active) return
        const current = this.items.get(item.id)
        if (!current || current.status !== 'downloading') return
        this.complete(item.id, filePath)
      })
      .catch((error: unknown) => {
        if (
          this.stopped ||
          this.active.get(item.id) !== active ||
          isPausedError(error)
        ) {
          return
        }
        const current = this.items.get(item.id)
        if (!current || current.status !== 'downloading') return

        if (isLandingPageError(error)) {
          const candidates = this.mirrorLists.get(item.id) ?? [current.sourceUri]
          const index = candidates.indexOf(current.sourceUri)
          const nextUri = index >= 0 ? candidates[index + 1] : undefined
          if (nextUri) {
            this.patch(item.id, { sourceUri: nextUri, errorMessage: null })
            this.startItem(this.items.get(item.id) as DownloadQueueItem)
            return
          }
        }

        this.fail(item.id, error)
      })
      .finally(() => {
        if (this.active.get(item.id) === active) this.active.delete(item.id)
        this.startQueued()
      })
  }

  private handleResolved(id: number, filePath: string, totalBytes: number | null): void {
    const item = this.items.get(id)
    if (!item) return
    this.patch(id, {
      filePath,
      totalBytes: totalBytes ?? item.totalBytes,
      updatedAt: new Date().toISOString()
    })
  }

  private handleHttpProgress(id: number, progress: HttpTaskProgress): void {
    this.applyProgress(id, progress.downloadedBytes, progress.totalBytes, null, null, null)
  }

  private handleTorrentProgress(id: number, progress: TorrentTaskProgress): void {
    this.applyProgress(
      id,
      progress.downloadedBytes,
      progress.totalBytes,
      progress.downloadSpeed,
      progress.uploadSpeed,
      progress.etaSeconds
    )
  }

  private applyProgress(
    id: number,
    downloadedBytes: number,
    totalBytes: number | null,
    reportedDownloadSpeed: number | null,
    reportedUploadSpeed: number | null,
    reportedEta: number | null
  ): void {
    const item = this.items.get(id)
    const active = this.active.get(id)
    if (!item || item.status !== 'downloading') return

    const now = Date.now()
    let downloadSpeed = reportedDownloadSpeed ?? 0
    let etaSeconds = reportedEta
    if (active) {
      const elapsed = (now - active.lastSampleAt) / 1000
      if (reportedDownloadSpeed === null && elapsed > 0.15) {
        const instantaneous = Math.max(0, (downloadedBytes - active.lastBytes) / elapsed)
        active.speed = active.speed > 0 ? active.speed * 0.55 + instantaneous * 0.45 : instantaneous
        downloadSpeed = active.speed
      } else if (reportedDownloadSpeed !== null) {
        active.speed = reportedDownloadSpeed
      }
      active.lastBytes = downloadedBytes
      active.lastSampleAt = now
      if (etaSeconds === null && totalBytes && downloadSpeed > 0) {
        etaSeconds = Math.max(0, Math.round((totalBytes - downloadedBytes) / downloadSpeed))
      }
    }

    const safeTotal = totalBytes && totalBytes > 0 ? totalBytes : null
    const progress = safeTotal
      ? Math.min(100, Math.max(0, (downloadedBytes / safeTotal) * 100))
      : item.progress

    this.patch(
      id,
      {
        progress,
        downloadedBytes,
        totalBytes: safeTotal,
        downloadSpeed,
        uploadSpeed: reportedUploadSpeed ?? item.uploadSpeed,
        etaSeconds,
        updatedAt: new Date(now).toISOString()
      },
      false
    )

  }

  private complete(id: number, filePath: string | null): void {
    const item = this.items.get(id)
    if (!item) return
    const completed = this.patch(id, {
      status: 'complete',
      progress: 100,
      downloadedBytes: item.totalBytes ?? item.downloadedBytes,
      downloadSpeed: 0,
      uploadSpeed: 0,
      etaSeconds: null,
      filePath: filePath ?? item.filePath,
      errorMessage: null,
      postprocessStatus: 'pending',
      postprocessMessage: item.releaseType === 'repack'
        ? 'Download complete. Preparing the installer…'
        : 'Download complete. Preparing files…',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    this.origins.delete(id)
    this.overrides.delete(id)
    this.immediate.delete(id)
    this.mirrorLists.delete(id)
    void this.runPostprocess(completed)
  }

  private fail(id: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.patch(id, {
      status: 'error',
      downloadSpeed: 0,
      uploadSpeed: 0,
      etaSeconds: null,
      errorMessage: message,
      updatedAt: new Date().toISOString()
    })
  }

  private async runPostprocess(item: DownloadQueueItem): Promise<void> {
    if (!this.items.has(item.id)) return
    try {
      const result = await this.postprocessor.run(item, {
        onStatus: (status, message) => {
          if (!this.items.has(item.id)) return
          this.patch(item.id, {
            postprocessStatus: status,
            postprocessMessage: message,
            updatedAt: new Date().toISOString()
          })
        }
      })
      if (!this.items.has(item.id)) return
      this.patch(item.id, {
        ...(result.location ? { filePath: result.location } : {}),
        postprocessStatus: result.status,
        postprocessMessage: result.message,
        updatedAt: new Date().toISOString()
      })
    } catch (error) {
      if (!this.items.has(item.id)) return
      const message = error instanceof Error ? error.message : String(error)
      this.patch(item.id, {
        postprocessStatus: 'error',
        postprocessMessage: message,
        updatedAt: new Date().toISOString()
      })
    }
  }

  private patch(
    id: number,
    patch: Parameters<DownloadRepository['update']>[1],
    persistImmediately = true
  ): DownloadQueueItem {
    const item = this.patchInMemory(id, patch)
    this.persist(item, persistImmediately)
    this.broadcast({ id, item })
    return item
  }

  private patchInMemory(
    id: number,
    patch: Parameters<DownloadRepository['update']>[1]
  ): DownloadQueueItem {
    const current = this.items.get(id)
    if (!current) throw new Error('That download no longer exists.')
    const next = { ...current, ...patch } as DownloadQueueItem
    this.items.set(id, next)
    return next
  }

  private emit(item: DownloadQueueItem): void {
    this.persist(item, true)
    this.broadcast({ id: item.id, item })
  }

  private persist(item: DownloadQueueItem, force: boolean): void {
    const now = Date.now()
    const last = this.lastPersistAt.get(item.id) ?? 0
    if (!force && now - last < PERSIST_INTERVAL_MS) return
    this.lastPersistAt.set(item.id, now)

    try {
      this.repository.update(item.id, {
        status: item.status,
        progress: item.progress,
        downloadedBytes: item.downloadedBytes,
        totalBytes: item.totalBytes,
        downloadSpeed: item.downloadSpeed,
        uploadSpeed: item.uploadSpeed,
        etaSeconds: item.etaSeconds,
        filePath: item.filePath,
        errorMessage: item.errorMessage,
        postprocessStatus: item.postprocessStatus,
        postprocessMessage: item.postprocessMessage,
        completedAt: item.completedAt,
        updatedAt: item.updatedAt
      })
    } catch {
      // Progress writes must never crash a transfer if the row was removed.
    }
  }
}
