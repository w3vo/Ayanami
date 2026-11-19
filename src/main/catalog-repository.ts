import { mkdirSync } from 'fs'
import { dirname } from 'path'
import Database from 'better-sqlite3'
import type {
  CatalogSource,
  DownloadQueueItem,
  DownloadType,
  MetadataStatus,
  OnlineStatus,
  QueueDownloadResult,
  ReleaseType,
  StoreGame,
  StoreMetadata,
  SystemRequirements
} from '../shared/types'
import {
  createEmptyRequirementTier,
  hasRequirementsData
} from '../shared/specs'
import { hasOnlineKeywords } from '../shared/catalog'
import { isTorrentUri, orderDownloadUris } from '../shared/download-links'
import { benchmarkCpuRequirement, benchmarkGpuRequirement } from './hardware-benchmarks'
import { openDatabase } from './db'

export type CatalogGameInput = Omit<
  StoreGame,
  | 'id'
  | 'sourceId'
  | 'sourceName'
  | 'importedAt'
  | 'steamAppId'
  | 'metadataStatus'
  | 'metadataUpdatedAt'
  | 'onlineCheckedAt'
  | 'onlineMatchUrl'
  | 'onlineByKeyword'
>

interface SourceRow {
  id: number
  name: string
  description: string | null
  path: string
  path_key: string
  manifest_version: number | null
  game_count: number | null
  is_sample: number | null
  imported_at: string
  updated_at: string
}

interface GameRow {
  id: number
  source_id: number
  source_name: string
  slug: string
  title: string
  synopsis: string
  release_year: number | null
  developer: string | null
  publisher: string | null
  genres: string
  cover_url: string | null
  hero_url: string | null
  screenshots: string
  online_status: string
  online_checked_at: string | null
  online_match_url: string | null
  download_url: string | null
  download_type: string | null
  release_type: string | null
  download_size_bytes: number | null
  mirror_urls: string
  storage_gb: number | null
  catalog_added_at: string | null
  steam_app_id: number | null
  metadata_status: string | null
  metadata_updated_at: string | null
  requirements: string
  imported_at: string
}

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

export interface CachedBenchmarkVideo {
  query: string
  status: 'found' | 'empty'
  videoId: string | null
  title: string | null
  channel: string | null
  fetchedAt: string
}

interface BenchmarkVideoRow {
  query: string
  status: string
  video_id: string | null
  video_title: string | null
  channel: string | null
  fetched_at: string
}

const CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS catalog_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  path TEXT NOT NULL,
  path_key TEXT NOT NULL UNIQUE,
  manifest_version INTEGER,
  game_count INTEGER NOT NULL DEFAULT 0,
  is_sample INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS catalog_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  synopsis TEXT NOT NULL DEFAULT '',
  release_year INTEGER,
  developer TEXT,
  publisher TEXT,
  genres TEXT NOT NULL DEFAULT '[]',
  cover_url TEXT,
  hero_url TEXT,
  screenshots TEXT NOT NULL DEFAULT '[]',
  online_status TEXT NOT NULL DEFAULT 'offline',
  online_checked_at TEXT,
  online_match_url TEXT,
  download_url TEXT,
  download_type TEXT,
  release_type TEXT,
  download_size_bytes INTEGER,
  mirror_urls TEXT NOT NULL DEFAULT '[]',
  storage_gb REAL,
  catalog_added_at TEXT,
  steam_app_id INTEGER,
  metadata_status TEXT NOT NULL DEFAULT 'pending',
  metadata_updated_at TEXT,
  requirements TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_catalog_games_source
  ON catalog_games(source_id, sort_order, id);

CREATE TABLE IF NOT EXISTS catalog_benchmark_videos (
  game_id INTEGER PRIMARY KEY REFERENCES catalog_games(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  status TEXT NOT NULL,
  video_id TEXT,
  video_title TEXT,
  channel TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`

function normalizeTimestamp(value: string | null): string | null {
  if (!value) return null
  if (value.includes('T')) return value
  return `${value.replace(' ', 'T')}Z`
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function scoreRequirementTier(
  tier: SystemRequirements['minimum']
): SystemRequirements['minimum'] {
  const cpu = benchmarkCpuRequirement(tier.cpu)
  const gpu = benchmarkGpuRequirement(tier.gpu)
  return {
    ...tier,
    cpuBenchmark: cpu.score,
    gpuBenchmark: gpu.score,
    cpuBenchmarkModel: cpu.model,
    gpuBenchmarkModel: gpu.model,
    cpuGeneric: cpu.generic,
    gpuGeneric: gpu.generic
  }
}

function normalizeRequirements(value: string): SystemRequirements {
  const parsed = parseJson<Partial<SystemRequirements>>(value, {})
  return {
    minimum: scoreRequirementTier({
      ...createEmptyRequirementTier(),
      ...(parsed.minimum ?? {})
    }),
    recommended: scoreRequirementTier({
      ...createEmptyRequirementTier(),
      ...(parsed.recommended ?? {})
    })
  }
}

function mapSource(row: SourceRow): CatalogSource {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    path: row.path,
    manifestVersion: row.manifest_version,
    gameCount: row.game_count ?? 0,
    isSample: Boolean(row.is_sample),
    importedAt: normalizeTimestamp(row.imported_at) ?? new Date().toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date().toISOString()
  }
}

function mapGame(row: GameRow): StoreGame {
  const genres = parseJson<string[]>(row.genres, [])
  const downloadUris = orderDownloadUris(
    row.download_url,
    parseJson<string[]>(row.mirror_urls, [])
  )
  const downloadUrl = downloadUris[0] ?? null
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    slug: row.slug,
    title: row.title,
    synopsis: row.synopsis,
    releaseYear: row.release_year,
    developer: row.developer,
    publisher: row.publisher,
    genres,
    coverUrl: row.cover_url,
    heroUrl: row.hero_url,
    screenshots: parseJson<string[]>(row.screenshots, []),
    onlineStatus: row.online_status === 'online-fix' ? 'online-fix' : 'offline',
    onlineCheckedAt: normalizeTimestamp(row.online_checked_at),
    onlineMatchUrl: row.online_match_url,
    onlineByKeyword: hasOnlineKeywords({ title: row.title }),
    storageGb: row.storage_gb,
    requirements: normalizeRequirements(row.requirements),
    download: {
      url: downloadUrl,
      type: downloadUrl
        ? isTorrentUri(downloadUrl)
          ? 'torrent'
          : 'http'
        : (row.download_type as DownloadType | null),
      releaseType: row.release_type as ReleaseType | null,
      sizeBytes: row.download_size_bytes,
      mirrors: downloadUris.slice(1)
    },
    catalogAddedAt: normalizeTimestamp(row.catalog_added_at),
    steamAppId: row.steam_app_id,
    metadataStatus:
      row.metadata_status === 'ready' ||
      row.metadata_status === 'missing' ||
      row.metadata_status === 'error'
        ? row.metadata_status
        : 'pending',
    metadataUpdatedAt: normalizeTimestamp(row.metadata_updated_at),
    importedAt: normalizeTimestamp(row.imported_at) ?? new Date().toISOString()
  }
}

function mapDownload(row: DownloadRow): DownloadQueueItem {
  return {
    id: row.id,
    title: row.title,
    sourceUri: row.source_uri,
    downloadType: row.download_type as DownloadType,
    releaseType: row.release_type as ReleaseType,
    status: row.status as DownloadQueueItem['status'],
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
      (row.postprocess_status as DownloadQueueItem['postprocessStatus']) ?? 'idle',
    postprocessMessage: row.postprocess_message,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date().toISOString(),
    completedAt: normalizeTimestamp(row.completed_at),
    updatedAt: normalizeTimestamp(row.updated_at)
  }
}

export class CatalogRepository {
  private readonly db: Database.Database

  constructor(private readonly dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = openDatabase(dbPath)
    this.db.exec(CATALOG_SCHEMA)
    this.ensureCatalogColumns()
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version < 5) this.db.pragma('user_version = 5')
  }

  private ensureCatalogColumns(): void {
    const columns = this.db
      .prepare('PRAGMA table_info(catalog_games)')
      .all() as Array<{ name: string }>
    const names = new Set(columns.map((column) => column.name))
    if (!names.has('mirror_urls')) {
      this.db.exec("ALTER TABLE catalog_games ADD COLUMN mirror_urls TEXT NOT NULL DEFAULT '[]'")
    }
    if (!names.has('catalog_added_at')) {
      this.db.exec('ALTER TABLE catalog_games ADD COLUMN catalog_added_at TEXT')
    }
    if (!names.has('steam_app_id')) {
      this.db.exec('ALTER TABLE catalog_games ADD COLUMN steam_app_id INTEGER')
    }
    if (!names.has('metadata_status')) {
      this.db.exec(
        "ALTER TABLE catalog_games ADD COLUMN metadata_status TEXT NOT NULL DEFAULT 'pending'"
      )
    }
    if (!names.has('metadata_updated_at')) {
      this.db.exec('ALTER TABLE catalog_games ADD COLUMN metadata_updated_at TEXT')
    }
    if (!names.has('online_checked_at')) {
      this.db.exec('ALTER TABLE catalog_games ADD COLUMN online_checked_at TEXT')
    }
    if (!names.has('online_match_url')) {
      this.db.exec('ALTER TABLE catalog_games ADD COLUMN online_match_url TEXT')
    }

    // Online status is derived only from online-fix.me. Drop old manifest values
    // (including the removed LAN state) so unchecked titles show "Checking…".
    this.db.exec(
      `UPDATE catalog_games
       SET online_status = 'offline', online_checked_at = NULL, online_match_url = NULL
       WHERE online_status NOT IN ('offline', 'online-fix')`
    )
    this.db.exec(
      `UPDATE catalog_games
       SET online_status = 'offline', online_match_url = NULL
       WHERE online_checked_at IS NULL`
    )
  }

  listSources(): CatalogSource[] {
    const rows = this.db
      .prepare('SELECT * FROM catalog_sources ORDER BY id ASC')
      .all() as SourceRow[]
    return rows.map(mapSource)
  }

  getSource(id: number): CatalogSource | null {
    const row = this.db
      .prepare('SELECT * FROM catalog_sources WHERE id = ?')
      .get(id) as SourceRow | undefined
    return row ? mapSource(row) : null
  }

  findSourceByPath(path: string): CatalogSource | null {
    const row = this.db
      .prepare('SELECT * FROM catalog_sources WHERE path_key = ?')
      .get(path.toLowerCase()) as SourceRow | undefined
    return row ? mapSource(row) : null
  }

  upsertSource(input: {
    name: string
    description: string | null
    path: string
    manifestVersion: number | null
    isSample: boolean
  }): { source: CatalogSource; created: boolean } {
    const existing = this.findSourceByPath(input.path)

    if (existing) {
      this.db
        .prepare(
          `UPDATE catalog_sources
           SET name = ?, description = ?, manifest_version = ?, is_sample = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(
          input.name,
          input.description,
          input.manifestVersion,
          input.isSample ? 1 : 0,
          existing.id
        )
      const source = this.getSource(existing.id)
      if (!source) throw new Error('The catalog source could not be updated.')
      return { source, created: false }
    }

    const result = this.db
      .prepare(
        `INSERT INTO catalog_sources (
           name, description, path, path_key, manifest_version, is_sample
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.description,
        input.path,
        input.path.toLowerCase(),
        input.manifestVersion,
        input.isSample ? 1 : 0
      )

    const source = this.getSource(Number(result.lastInsertRowid))
    if (!source) throw new Error('The catalog source could not be saved.')
    return { source, created: true }
  }

  replaceGames(sourceId: number, games: CatalogGameInput[]): CatalogSource {
    const source = this.getSource(sourceId)
    if (!source) throw new Error('The catalog source no longer exists.')

    const insert = this.db.prepare(
      `INSERT INTO catalog_games (
         source_id, slug, title, synopsis, release_year, developer, publisher,
         genres, cover_url, hero_url, screenshots, online_status, download_url,
         download_type, release_type, download_size_bytes, mirror_urls, storage_gb,
         catalog_added_at, requirements, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const replace = this.db.transaction(() => {
      this.db.prepare('DELETE FROM catalog_games WHERE source_id = ?').run(sourceId)
      games.forEach((game, index) => {
        insert.run(
          sourceId,
          game.slug,
          game.title,
          game.synopsis,
          game.releaseYear,
          game.developer,
          game.publisher,
          JSON.stringify(game.genres),
          game.coverUrl,
          game.heroUrl,
          JSON.stringify(game.screenshots),
          game.onlineStatus,
          game.download.url,
          game.download.type,
          game.download.releaseType,
          game.download.sizeBytes,
          JSON.stringify(game.download.mirrors),
          game.storageGb,
          game.catalogAddedAt,
          JSON.stringify(game.requirements),
          index
        )
      })
      this.db
        .prepare(
          `UPDATE catalog_sources
           SET game_count = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(games.length, sourceId)
    })

    replace()
    const updated = this.getSource(sourceId)
    if (!updated) throw new Error('The catalog source could not be updated.')
    return updated
  }

  removeSource(id: number): CatalogSource[] {
    this.db.prepare('DELETE FROM catalog_sources WHERE id = ?').run(id)
    return this.listSources()
  }

  listGames(): StoreGame[] {
    const rows = this.db
      .prepare(
        `SELECT g.*, s.name AS source_name
         FROM catalog_games g
         JOIN catalog_sources s ON s.id = g.source_id
         ORDER BY g.source_id ASC, g.sort_order ASC, g.id ASC`
      )
      .all() as GameRow[]
    return rows.map(mapGame)
  }

  getGame(id: number): StoreGame | null {
    const row = this.db
      .prepare(
        `SELECT g.*, s.name AS source_name
         FROM catalog_games g
         JOIN catalog_sources s ON s.id = g.source_id
         WHERE g.id = ?`
      )
      .get(id) as GameRow | undefined
    return row ? mapGame(row) : null
  }

  applyGameMetadata(gameId: number, metadata: StoreMetadata): StoreGame | null {
    const game = this.getGame(gameId)
    if (!game) return null

    const synopsis = game.synopsis.trim() ? game.synopsis : metadata.synopsis
    const genres = game.genres.length > 0 ? game.genres : metadata.genres
    const screenshots = game.screenshots.length > 0 ? game.screenshots : metadata.screenshots
    const requirements = hasRequirementsData(game.requirements)
      ? game.requirements
      : metadata.requirements

    this.db
      .prepare(
        `UPDATE catalog_games
         SET steam_app_id = ?,
             synopsis = ?,
             release_year = ?,
             developer = ?,
             publisher = ?,
             genres = ?,
             cover_url = ?,
             hero_url = ?,
             screenshots = ?,
             requirements = ?,
             metadata_status = 'ready',
             metadata_updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(
        metadata.steamAppId,
        synopsis,
        game.releaseYear ?? metadata.releaseYear,
        game.developer ?? metadata.developer,
        game.publisher ?? metadata.publisher,
        JSON.stringify(genres),
        game.coverUrl ?? metadata.coverUrl,
        game.heroUrl ?? metadata.heroUrl,
        JSON.stringify(screenshots),
        JSON.stringify(requirements),
        gameId
      )

    return this.getGame(gameId)
  }

  markGameMetadata(gameId: number, status: Exclude<MetadataStatus, 'ready'>): StoreGame | null {
    this.db
      .prepare(
        `UPDATE catalog_games
         SET metadata_status = ?, metadata_updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(status, gameId)
    return this.getGame(gameId)
  }

  markOnlineStatus(
    gameId: number,
    status: OnlineStatus,
    matchUrl: string | null
  ): StoreGame | null {
    this.db
      .prepare(
        `UPDATE catalog_games
         SET online_status = ?,
             online_checked_at = CURRENT_TIMESTAMP,
             online_match_url = ?
         WHERE id = ?`
      )
      .run(status, matchUrl, gameId)
    return this.getGame(gameId)
  }

  getBenchmarkVideoCache(gameId: number, query: string): CachedBenchmarkVideo | null {
    const row = this.db
      .prepare(
        `SELECT query, status, video_id, video_title, channel, fetched_at
         FROM catalog_benchmark_videos
         WHERE game_id = ?`
      )
      .get(gameId) as BenchmarkVideoRow | undefined

    if (!row || row.query !== query) return null
    if (row.status !== 'found' && row.status !== 'empty') return null

    return {
      query: row.query,
      status: row.status,
      videoId: row.video_id,
      title: row.video_title,
      channel: row.channel,
      fetchedAt: normalizeTimestamp(row.fetched_at) ?? new Date().toISOString()
    }
  }

  saveBenchmarkVideoCache(
    gameId: number,
    query: string,
    result: {
      status: 'found' | 'empty'
      videoId: string | null
      title: string | null
      channel: string | null
    }
  ): void {
    this.db
      .prepare(
        `INSERT INTO catalog_benchmark_videos (
           game_id, query, status, video_id, video_title, channel, fetched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id) DO UPDATE SET
           query = excluded.query,
           status = excluded.status,
           video_id = excluded.video_id,
           video_title = excluded.video_title,
           channel = excluded.channel,
           fetched_at = excluded.fetched_at`
      )
      .run(
        gameId,
        query,
        result.status,
        result.videoId,
        result.title,
        result.channel,
        new Date().toISOString()
      )
  }

  clearBenchmarkVideoCache(gameId: number): void {
    this.db.prepare('DELETE FROM catalog_benchmark_videos WHERE game_id = ?').run(gameId)
  }

  queueDownload(gameId: number, savePath: string): QueueDownloadResult {
    const game = this.getGame(gameId)
    if (!game) throw new Error('That game is no longer in the catalog.')
    if (!game.download.url) throw new Error('This catalog entry does not include a download.')
    if (!game.download.type || !game.download.releaseType) {
      throw new Error('This catalog entry is missing its download type.')
    }

    const existing = this.db
      .prepare(
        `SELECT * FROM downloads
         WHERE source_uri = ?
           AND status IN ('queued', 'downloading', 'paused')
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(game.download.url) as DownloadRow | undefined

    if (existing) {
      return { item: mapDownload(existing), alreadyQueued: true }
    }

    const result = this.db
      .prepare(
        `INSERT INTO downloads (
           title, source_uri, download_type, release_type, status, progress, save_path
         ) VALUES (?, ?, ?, ?, 'queued', 0, ?)`
      )
      .run(
        game.title,
        game.download.url,
        game.download.type,
        game.download.releaseType,
        savePath
      )

    const row = this.db
      .prepare('SELECT * FROM downloads WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as DownloadRow | undefined
    if (!row) throw new Error('The download could not be queued.')
    return { item: mapDownload(row), alreadyQueued: false }
  }

  close(): void {
    this.db.close()
  }

  get path(): string {
    return this.dbPath
  }
}
