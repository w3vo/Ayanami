import { rmSync } from 'fs'
import { join } from 'path'
import type { DownloadQueueItem } from '../../shared/types'

interface TorrentFileLike {
  path: string
}

interface TorrentLike {
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  timeRemaining: number
  length: number
  path?: string
  name?: string
  files?: TorrentFileLike[]
  pause: () => void
  resume: () => void
  destroy: (callback?: () => void) => void
  on: (event: string, listener: (...args: unknown[]) => void) => void
}

interface WebTorrentClientLike {
  add: (
    torrentId: string,
    options: { path: string },
    callback?: (torrent: TorrentLike) => void
  ) => TorrentLike
  destroy: (callback?: () => void) => void
  on: (event: string, listener: (...args: unknown[]) => void) => void
}

type WebTorrentConstructor = new (options?: {
  maxConns?: number
  dht?: boolean
}) => WebTorrentClientLike

export interface TorrentTaskProgress {
  downloadedBytes: number
  totalBytes: number | null
  downloadSpeed: number
  uploadSpeed: number
  etaSeconds: number | null
}

export interface TorrentTaskCallbacks {
  onProgress: (progress: TorrentTaskProgress) => void
  onResolved: (filePath: string, totalBytes: number | null) => void
}

export class TorrentPausedError extends Error {
  constructor() {
    super('Download paused')
    this.name = 'TorrentPausedError'
  }
}

/**
 * Thin wrapper around WebTorrent kept behind a narrow local interface. The
 * package is ESM-only, so the main process loads it with a dynamic import.
 */
export class TorrentDownloadTask {
  private client: WebTorrentClientLike | null = null
  private torrent: TorrentLike | null = null
  private paused = false
  private settled = false
  private lastReportAt = 0
  private resolvedPath: string | null = null
  private abortRun: ((error: Error) => void) | null = null

  constructor(
    private readonly item: DownloadQueueItem,
    private readonly callbacks: TorrentTaskCallbacks
  ) {}

  async start(): Promise<string> {
    if (this.paused) throw new TorrentPausedError()

    const module = (await import('webtorrent')) as unknown as {
      default: WebTorrentConstructor
    }
    if (this.paused) throw new TorrentPausedError()

    const client = new module.default({ maxConns: 50 })
    this.client = client

    return new Promise<string>((resolve, reject) => {
      const fail = (error: unknown): void => {
        if (this.settled) return
        this.settled = true
        this.abortRun = null
        this.destroyClient()
        reject(error instanceof Error ? error : new Error(String(error)))
      }

      const succeed = (): void => {
        if (this.settled) return
        this.settled = true
        this.abortRun = null
        const torrent = this.torrent
        const filePath = this.resolveContentPath(torrent)
        this.resolvedPath = filePath
        const totalBytes = torrent && torrent.length > 0 ? torrent.length : null
        this.callbacks.onResolved(filePath, totalBytes)
        torrent?.pause()
        this.destroyClient()
        resolve(filePath)
      }

      this.abortRun = (error) => {
        this.abortRun = null
        reject(error)
      }

      try {
        const torrent = client.add(this.item.sourceUri, { path: this.item.savePath })
        this.torrent = torrent

        torrent.on('metadata', () => {
          this.report(true)
        })
        torrent.on('download', () => {
          this.report()
        })
        torrent.on('upload', () => {
          this.report()
        })
        torrent.on('done', () => {
          succeed()
        })
        torrent.on('error', (error) => {
          fail(error instanceof Error ? error : new Error(String(error)))
        })
        client.on('error', (error) => {
          fail(error instanceof Error ? error : new Error(String(error)))
        })

        const totalBytes = torrent.length > 0 ? torrent.length : null
        const filePath = this.resolveContentPath(torrent)
        this.resolvedPath = filePath
        this.callbacks.onResolved(filePath, totalBytes)
        this.report(true)
      } catch (error) {
        fail(error)
      }

      if (this.paused) {
        fail(new TorrentPausedError())
      }
    })
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.settled = true
    this.destroyClient()
    this.abortRun?.(new TorrentPausedError())
    this.abortRun = null
  }

  /** Removes the torrent's downloaded files when the queue item is discarded. */
  cleanup(): void {
    const contentPath = this.resolvedPath
    if (contentPath && contentPath !== this.item.savePath) {
      rmSync(contentPath, { recursive: true, force: true })
    }
  }

  private resolveContentPath(torrent: TorrentLike | null): string {
    if (!torrent) return this.item.savePath
    const root = torrent.path && torrent.path.length > 0 ? torrent.path : this.item.savePath
    const files = torrent.files ?? []
    // Single-file torrents live directly in the save folder; multi-file torrents
    // get a root folder named after the torrent.
    if (files.length === 1) return join(root, files[0].path)
    if (torrent.name) return join(root, torrent.name)
    return root
  }

  private report(force = false): void {
    if (this.settled || this.paused) return
    const now = Date.now()
    if (!force && now - this.lastReportAt < 500) return
    this.lastReportAt = now

    const torrent = this.torrent
    if (!torrent) return

    const totalBytes = torrent.length > 0 ? torrent.length : null
    const downloadedBytes = totalBytes
      ? Math.min(totalBytes, Math.round(torrent.progress * totalBytes))
      : 0
    const etaSeconds =
      Number.isFinite(torrent.timeRemaining) && torrent.timeRemaining > 0
        ? Math.round(torrent.timeRemaining / 1000)
        : null

    this.callbacks.onProgress({
      downloadedBytes,
      totalBytes,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      etaSeconds
    })
  }

  private destroyClient(): void {
    const client = this.client
    this.client = null
    this.torrent = null
    if (!client) return
    try {
      client.destroy()
    } catch {
      // The client may already be closing after a network error.
    }
  }
}
