import { mkdirSync } from 'fs'
import { dirname } from 'path'
import Database from 'better-sqlite3'
import type {
  DownloadPostprocessStatus,
  DownloadQueueItem,
  DownloadStatus,
  DownloadType,
  ReleaseType
} from '../../shared/types'
import { openDatabase } from '../db'

interface DownloadRow {
  id: number
  title: string
  source_uri: string
  download_type: string
  release_type: string
  status: string
  progress: number | null
  save_path: string
  downloaded_bytes: number | null
  total_bytes: number | null
  download_speed: number | null
  upload_speed: number | null
  eta_seconds: number | null
  file_path: string | null
  error_message: string | null
  postprocess_status: string | null
  postprocess_message: string | null
  completed_at: string | null
  updated_at: string | null
  created_at: string
}

export interface CreateDownloadRecord {
  title: string
  sourceUri: string
  downloadType: DownloadType
  releaseType: ReleaseType
  savePath: string
  totalBytes?: number | null
}

export interface DownloadPatch {
  sourceUri?: string
  title?: string
  status?: DownloadStatus
  progress?: number
  savePath?: string
  downloadedBytes?: number
  totalBytes?: number | null
  downloadSpeed?: number
  uploadSpeed?: number
  etaSeconds?: number | null
  filePath?: string | null
  errorMessage?: string | null
  postprocessStatus?: DownloadPostprocessStatus
  postprocessMessage?: string | null
  completedAt?: string | null
  updatedAt?: string | null
}

const PATCH_COLUMNS: Record<keyof DownloadPatch, string> = {
  sourceUri: 'source_uri',
  title: 'title',
  status: 'status',
  progress: 'progress',
  savePath: 'save_path',
  downloadedBytes: 'downloaded_bytes',
  totalBytes: 'total_bytes',
  downloadSpeed: 'download_speed',
  uploadSpeed: 'upload_speed',
  etaSeconds: 'eta_seconds',
  filePath: 'file_path',
  errorMessage: 'error_message',
  postprocessStatus: 'postprocess_status',
  postprocessMessage: 'postprocess_message',
  completedAt: 'completed_at',
  updatedAt: 'updated_at'
}

function normalizeTimestamp(value: string | null): string | null {
  if (!value) return null
  if (value.includes('T')) return value
  return `${value.replace(' ', 'T')}Z`
}

function mapDownload(row: DownloadRow): DownloadQueueItem {
  return {
    id: row.id,
    title: row.title,
    sourceUri: row.source_uri,
    downloadType: row.download_type as DownloadType,
    releaseType: row.release_type as ReleaseType,
    status: row.status as DownloadStatus,
    progress: row.progress ?? 0,
    savePath: row.save_path,
    downloadedBytes: row.downloaded_bytes ?? 0,
    totalBytes: row.total_bytes,
    downloadSpeed: row.download_speed ?? 0,
    uploadSpeed: row.upload_speed ?? 0,
    etaSeconds: row.eta_seconds,
    filePath: row.file_path,
    errorMessage: row.error_message,
    postprocessStatus:
      (row.postprocess_status as DownloadPostprocessStatus | null) ?? 'idle',
    postprocessMessage: row.postprocess_message,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    completedAt: normalizeTimestamp(row.completed_at),
    updatedAt: normalizeTimestamp(row.updated_at)
  }
}

/**
 * Persistence for the download queue. Part files and torrent payloads live on
 * disk; this table keeps the user-facing queue and enough state to resume after
 * an app restart.
 */
export class DownloadRepository {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = openDatabase(dbPath)
    this.resetInterrupted()
  }

  list(): DownloadQueueItem[] {
    const rows = this.db
      .prepare('SELECT * FROM downloads ORDER BY id DESC')
      .all() as DownloadRow[]
    return rows.map(mapDownload)
  }

  get(id: number): DownloadQueueItem | null {
    const row = this.db.prepare('SELECT * FROM downloads WHERE id = ?').get(id) as
      | DownloadRow
      | undefined
    return row ? mapDownload(row) : null
  }

  findActiveByUri(sourceUri: string): DownloadQueueItem | null {
    const row = this.db
      .prepare(
        `SELECT * FROM downloads
         WHERE source_uri = ?
           AND status IN ('queued', 'downloading', 'paused')
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(sourceUri) as DownloadRow | undefined
    return row ? mapDownload(row) : null
  }

  create(input: CreateDownloadRecord): DownloadQueueItem {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO downloads (
           title, source_uri, download_type, release_type, status, progress,
           save_path, downloaded_bytes, total_bytes, download_speed, upload_speed,
           postprocess_status, updated_at
         ) VALUES (?, ?, ?, ?, 'queued', 0, ?, 0, ?, 0, 0, 'idle', ?)`
      )
      .run(
        input.title,
        input.sourceUri,
        input.downloadType,
        input.releaseType,
        input.savePath,
        input.totalBytes ?? null,
        now
      )

    const item = this.get(Number(result.lastInsertRowid))
    if (!item) throw new Error('The download could not be added to the queue.')
    return item
  }

  update(id: number, patch: DownloadPatch): DownloadQueueItem {
    const entries = Object.entries(patch).filter(
      (entry): entry is [keyof DownloadPatch, NonNullable<DownloadPatch[keyof DownloadPatch]>] =>
        entry[1] !== undefined
    )

    if (entries.length > 0) {
      const assignments = entries.map(([key]) => `${PATCH_COLUMNS[key]} = ?`)
      const values = entries.map(([, value]) => value)
      this.db
        .prepare(`UPDATE downloads SET ${assignments.join(', ')} WHERE id = ?`)
        .run(...values, id)
    }

    const updated = this.get(id)
    if (!updated) throw new Error('That download no longer exists.')
    return updated
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id).changes > 0
  }

  /**
   * A download marked "downloading" died with the previous process. Pausing it
   * preserves its parts and makes the resume action explicit on next launch.
   */
  private resetInterrupted(): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE downloads
         SET status = 'paused',
             download_speed = 0,
             upload_speed = 0,
             eta_seconds = NULL,
             updated_at = ?
         WHERE status = 'downloading'`
      )
      .run(now)

    this.db
      .prepare(
        `UPDATE downloads
         SET postprocess_status = 'error',
             postprocess_message = 'Post-processing was interrupted. Retry it from the download card.',
             updated_at = ?
         WHERE postprocess_status IN ('pending', 'extracting', 'installing')`
      )
      .run(now)
  }

  close(): void {
    this.db.close()
  }
}
