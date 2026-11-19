import { mkdirSync } from 'fs'
import { dirname } from 'path'
import Database from 'better-sqlite3'
import type { Game, NewGameInput } from '../shared/types'

interface GameRow {
  id: number
  title: string
  igdb_id: number | null
  steamgriddb_id: number | null
  cover_url: string | null
  hero_url: string | null
  exe_path: string
  save_folder_path: string | null
  total_playtime_seconds: number | null
  last_played_at: string | null
  auto_sync_enabled: number | null
  last_synced_at: string | null
  created_at: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  igdb_id INTEGER,
  steamgriddb_id INTEGER,
  cover_url TEXT,
  hero_url TEXT,
  exe_path TEXT NOT NULL,
  save_folder_path TEXT,
  total_playtime_seconds INTEGER DEFAULT 0,
  last_played_at TEXT,
  auto_sync_enabled INTEGER DEFAULT 0,
  last_synced_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  download_type TEXT CHECK(download_type IN ('torrent', 'http')) NOT NULL,
  release_type TEXT CHECK(release_type IN ('preinstalled', 'repack')) NOT NULL,
  status TEXT DEFAULT 'queued',
  progress REAL DEFAULT 0,
  save_path TEXT NOT NULL,
  downloaded_bytes INTEGER DEFAULT 0,
  total_bytes INTEGER,
  download_speed REAL DEFAULT 0,
  upload_speed REAL DEFAULT 0,
  eta_seconds INTEGER,
  file_path TEXT,
  error_message TEXT,
  postprocess_status TEXT DEFAULT 'idle',
  postprocess_message TEXT,
  completed_at TEXT,
  updated_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`

const DOWNLOAD_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: 'downloaded_bytes', definition: 'INTEGER DEFAULT 0' },
  { name: 'total_bytes', definition: 'INTEGER' },
  { name: 'download_speed', definition: 'REAL DEFAULT 0' },
  { name: 'upload_speed', definition: 'REAL DEFAULT 0' },
  { name: 'eta_seconds', definition: 'INTEGER' },
  { name: 'file_path', definition: 'TEXT' },
  { name: 'error_message', definition: 'TEXT' },
  { name: 'postprocess_status', definition: "TEXT DEFAULT 'idle'" },
  { name: 'postprocess_message', definition: 'TEXT' },
  { name: 'completed_at', definition: 'TEXT' },
  { name: 'updated_at', definition: 'TEXT' }
]

function ensureDownloadColumns(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(downloads)').all() as Array<{ name: string }>
  const names = new Set(columns.map((column) => column.name))
  for (const column of DOWNLOAD_COLUMNS) {
    if (!names.has(column.name)) {
      db.exec(`ALTER TABLE downloads ADD COLUMN ${column.name} ${column.definition}`)
    }
  }
}

function normalizeTimestamp(value: string | null): string | null {
  if (!value) return null
  if (value.includes('T')) return value
  return `${value.replace(' ', 'T')}Z`
}

function mapGame(row: GameRow): Game {
  return {
    id: row.id,
    title: row.title,
    igdbId: row.igdb_id,
    steamgriddbId: row.steamgriddb_id,
    coverUrl: row.cover_url,
    heroUrl: row.hero_url,
    exePath: row.exe_path,
    saveFolderPath: row.save_folder_path,
    totalPlaytimeSeconds: row.total_playtime_seconds ?? 0,
    lastPlayedAt: normalizeTimestamp(row.last_played_at),
    autoSyncEnabled: Boolean(row.auto_sync_enabled),
    lastSyncedAt: normalizeTimestamp(row.last_synced_at),
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    isRunning: false
  }
}

/**
 * Opens the shared Ayanami database and ensures the base schema exists. Each
 * repository keeps its own connection; WAL mode lets the library and catalog
 * repositories read and write independently without blocking the UI.
 */
export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.exec(SCHEMA)
  ensureDownloadColumns(db)

  const version = db.pragma('user_version', { simple: true }) as number
  if (version < 1) db.pragma('user_version = 1')
  return db
}

export class GameRepository {
  private readonly db: Database.Database

  constructor(private readonly dbPath: string) {
    this.db = openDatabase(dbPath)
  }

  listGames(): Game[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM games
         ORDER BY COALESCE(last_played_at, created_at) DESC, id DESC`
      )
      .all() as GameRow[]

    return rows.map(mapGame)
  }

  getGame(id: number): Game | null {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as
      | GameRow
      | undefined
    return row ? mapGame(row) : null
  }

  addGame(input: NewGameInput): Game {
    const title = input.title.trim()
    const exePath = input.exePath.trim()

    if (!title) throw new Error('A game title is required.')
    if (!exePath) throw new Error('A game executable is required.')

    const result = this.db
      .prepare(
        `INSERT INTO games (
           title, igdb_id, steamgriddb_id, cover_url, hero_url,
           exe_path, save_folder_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        title,
        input.igdbId,
        input.steamgriddbId,
        input.coverUrl,
        input.heroUrl,
        exePath,
        input.saveFolderPath?.trim() || null
      )

    const game = this.getGame(Number(result.lastInsertRowid))
    if (!game) throw new Error('The game could not be saved. Please try again.')
    return game
  }

  markLaunched(id: number): void {
    this.db
      .prepare('UPDATE games SET last_played_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
  }

  updateGameSettings(
    id: number,
    saveFolderPath: string | null,
    autoSyncEnabled: boolean
  ): Game {
    const existing = this.getGame(id)
    if (!existing) throw new Error('That game is no longer in your library.')

    this.db
      .prepare('UPDATE games SET save_folder_path = ?, auto_sync_enabled = ? WHERE id = ?')
      .run(saveFolderPath, autoSyncEnabled ? 1 : 0, id)

    const updated = this.getGame(id)
    if (!updated) throw new Error('The game settings could not be saved.')
    return updated
  }

  markSynced(id: number, syncedAt = new Date().toISOString()): Game {
    this.db.prepare('UPDATE games SET last_synced_at = ? WHERE id = ?').run(syncedAt, id)
    const updated = this.getGame(id)
    if (!updated) throw new Error('That game is no longer in your library.')
    return updated
  }

  /**
   * Persists one completed play session atomically. The session close time is
   * written as last_played_at so the library shows the most recent activity.
   */
  recordPlaySession(id: number, elapsedSeconds: number): void {
    const seconds = Number.isFinite(elapsedSeconds)
      ? Math.max(0, Math.floor(elapsedSeconds))
      : 0

    this.db
      .prepare(
        `UPDATE games
         SET total_playtime_seconds = COALESCE(total_playtime_seconds, 0) + ?,
             last_played_at = ?
         WHERE id = ?`
      )
      .run(seconds, new Date().toISOString(), id)
  }

  close(): void {
    this.db.close()
  }

  get path(): string {
    return this.dbPath
  }
}
