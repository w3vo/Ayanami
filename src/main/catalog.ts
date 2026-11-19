import { existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { basename, extname, resolve } from 'path'
import type {
  CatalogSource,
  DownloadType,
  ImportCatalogResult,
  QueueDownloadResult,
  ReleaseType,
  RequirementTier,
  StoreGame,
  SystemRequirements
} from '../shared/types'
import { isTorrentUri, orderDownloadUris } from '../shared/download-links'
import { createEmptyRequirementTier, createEmptyRequirements } from '../shared/specs'
import type { CatalogGameInput, CatalogRepository } from './catalog-repository'

const MAX_MANIFEST_BYTES = 10 * 1024 * 1024
const MAX_GAMES = 10_000
const MAX_WARNINGS = 30
const MAX_MIRRORS = 8
/**
 * Ranking happens after collection, so a late-listed automatic mirror must not
 * be discarded by the mirror cap before the sorter sees it.
 */
const MAX_URI_CANDIDATES = 64
const MAX_ARTWORK_URL_LENGTH = 4_000_000

type JsonObject = Record<string, unknown>

interface NormalizedManifest {
  name: string
  description: string | null
  manifestVersion: number | null
  games: CatalogGameInput[]
  warnings: string[]
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function limit(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trim()}…`
}

function readStringList(value: unknown, maxCount: number, maxLength: number): string[] {
  const values =
    typeof value === 'string'
      ? value.split(/[,;]/)
      : Array.isArray(value)
        ? value
        : []

  const result: string[] = []
  const seen = new Set<string>()
  for (const entry of values) {
    const text = readString(entry)
    if (!text) continue
    const normalized = text.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(limit(text, maxLength))
    if (result.length >= maxCount) break
  }
  return result
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
  return slug || 'game'
}

function normalizeArtworkUrl(value: unknown): string | null {
  const text = readString(value)
  if (!text || text.length > MAX_ARTWORK_URL_LENGTH) return null
  if (text.startsWith('data:image/')) return text
  try {
    const parsed = new URL(text)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? text : null
  } catch {
    return null
  }
}

function artworkFrom(
  raw: JsonObject,
  artwork: JsonObject | null,
  keys: string[]
): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null) return raw[key]
  }
  if (artwork) {
    for (const key of keys) {
      if (artwork[key] !== undefined && artwork[key] !== null) return artwork[key]
    }
  }
  return null
}

function normalizeScreenshots(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const screenshots: string[] = []
  for (const entry of entries) {
    const normalized = normalizeArtworkUrl(entry)
    if (normalized) screenshots.push(normalized)
    if (screenshots.length >= 8) break
  }
  return screenshots
}

function parseFileSizeBytes(value: unknown): number | null {
  const text = readString(value)
  if (!text) return null

  const normalized = text
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    // Treat a single comma followed by one or two digits as a decimal comma.
    .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')

  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4
  }

  let largest = 0
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(tb|gb|mb|kb|b)\b/gi)) {
    const amount = Number(match[1])
    const unit = match[2].toLowerCase()
    if (!Number.isFinite(amount) || amount <= 0) continue
    largest = Math.max(largest, amount * multipliers[unit])
  }

  return largest > 0 ? Math.round(largest) : null
}

function normalizeUriList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const uris: string[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    const text = readString(entry)
    if (!text || text.length > MAX_ARTWORK_URL_LENGTH) continue

    let normalized: string | null = null
    if (text.startsWith('magnet:')) {
      normalized = text
    } else {
      try {
        const parsed = new URL(text)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') normalized = text
      } catch {
        normalized = null
      }
    }

    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    uris.push(normalized)
    if (uris.length >= MAX_URI_CANDIDATES) break
  }

  return uris
}

function normalizeCatalogDate(value: unknown): string | null {
  const text = readString(value)
  if (!text) return null
  const timestamp = Date.parse(text)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

function cleanHydraTitle(value: string): string {
  return value
    .replace(/\s*\bFree\s+Download\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function hydraReleaseType(title: string, primaryUri: string): ReleaseType {
  return /\brepack\b/i.test(title) || /\.exe(?:$|\?)/i.test(primaryUri)
    ? 'repack'
    : 'preinstalled'
}

function uniqueSlug(base: string, used: Set<string>): string {
  let slug = base
  let suffix = 2
  while (used.has(slug)) {
    slug = `${base}-${suffix}`
    suffix += 1
  }
  used.add(slug)
  return slug
}

function normalizeReleaseYear(value: unknown): number | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    const parsed = Number(value.slice(0, 4))
    return parsed >= 1950 && parsed <= 2100 ? parsed : null
  }
  const number = readNumber(value)
  if (number === null) return null
  const year = Math.round(number)
  return year >= 1950 && year <= 2100 ? year : null
}

function normalizeRequirementsTier(raw: JsonObject | null): RequirementTier {
  const tier = createEmptyRequirementTier()
  if (!raw) return tier

  tier.cpu = readString(raw.cpu ?? raw.processor)
  tier.gpu = readString(raw.gpu ?? raw.graphics ?? raw.videoCard)
  tier.ramGb = readNumber(raw.ramGb ?? raw.ram ?? raw.memoryGb ?? raw.memory)
  tier.storageGb = readNumber(raw.storageGb ?? raw.storage ?? raw.diskGb ?? raw.disk)

  return tier
}

function normalizeRequirements(raw: JsonObject | null): SystemRequirements {
  if (!raw) return createEmptyRequirements()
  return {
    minimum: normalizeRequirementsTier(
      asObject(raw.minimum ?? raw.min) ?? asObject(raw.minimumRequirements)
    ),
    recommended: normalizeRequirementsTier(
      asObject(raw.recommended ?? raw.rec) ?? asObject(raw.recommendedRequirements)
    )
  }
}

interface NormalizedDownload {
  url: string | null
  type: DownloadType | null
  releaseType: ReleaseType | null
  sizeBytes: number | null
  mirrors: string[]
}

function normalizeDownload(raw: JsonObject): NormalizedDownload {
  const download = asObject(raw.download)
  const url = readString(download?.url ?? raw.downloadUrl ?? raw.downloadUri)
  const typeText = readString(download?.type ?? raw.downloadType)?.toLowerCase() ?? null
  const releaseText = readString(download?.releaseType ?? raw.releaseType)?.toLowerCase() ?? null

  let validUrl: string | null = null
  let type: DownloadType | null = null

  if (url) {
    if (url.startsWith('magnet:')) {
      validUrl = url
      type = 'torrent'
    } else {
      try {
        const parsed = new URL(url)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          validUrl = url
          type = 'http'
        }
      } catch {
        validUrl = null
      }
    }
  }

  if (typeText === 'torrent' || typeText === 'magnet') type = 'torrent'
  if (typeText === 'http' || typeText === 'https' || typeText === 'direct') type = 'http'

  let releaseType: ReleaseType | null = null
  if (releaseText) {
    if (['preinstalled', 'pre-installed', 'portable', 'archive', 'zip'].includes(releaseText)) {
      releaseType = 'preinstalled'
    } else if (['repack', 'installer', 'setup', 'exe'].includes(releaseText)) {
      releaseType = 'repack'
    }
  }
  if (validUrl && !releaseType) {
    releaseType = /\.exe(?:$|\?)/i.test(validUrl) ? 'repack' : 'preinstalled'
  }

  const explicitBytes = readNumber(download?.sizeBytes ?? raw.downloadSizeBytes)
  const explicitGigabytes = readNumber(download?.sizeGb ?? raw.downloadSizeGb)
  const sizeBytes =
    explicitBytes !== null && explicitBytes > 0
      ? Math.round(explicitBytes)
      : explicitGigabytes !== null && explicitGigabytes > 0
        ? Math.round(explicitGigabytes * 1024 ** 3)
        : null

  return { url: validUrl, type, releaseType, sizeBytes, mirrors: [] }
}

function normalizeGame(
  raw: JsonObject,
  index: number,
  warnings: string[]
): CatalogGameInput | null {
  const title = readString(raw.title ?? raw.name)
  if (!title) {
    warnings.push(`Entry ${index + 1} has no title and was skipped.`)
    return null
  }
  if (title.length > 200) {
    warnings.push(`“${title.slice(0, 60)}…” has an overly long title and was skipped.`)
    return null
  }

  const slugSource = readString(raw.slug) ?? title
  const artwork = asObject(raw.artwork)

  const download = normalizeDownload(raw)
  if (!download.url) {
    warnings.push(`“${title}” has no valid download link; its store page will be read-only.`)
  }

  const coverValue = artworkFrom(raw, artwork, ['coverUrl', 'cover', 'coverArt'])
  const heroValue = artworkFrom(raw, artwork, ['heroUrl', 'hero', 'banner', 'background'])
  const screenshotValue = artworkFrom(raw, artwork, ['screenshots', 'gallery'])

  const coverUrl = normalizeArtworkUrl(coverValue)
  const heroUrl = normalizeArtworkUrl(heroValue)
  if (coverValue && !coverUrl) {
    warnings.push(`“${title}” has an invalid cover URL; Ayanami will use generated art.`)
  }
  if (heroValue && !heroUrl) {
    warnings.push(`“${title}” has an invalid hero URL; Ayanami will use generated art.`)
  }

  const requirements = normalizeRequirements(asObject(raw.requirements))
  const storageFromRaw = readNumber(raw.storageGb ?? raw.installSizeGb)
  const storageGb =
    storageFromRaw !== null && storageFromRaw > 0
      ? Math.round(storageFromRaw * 10) / 10
      : download.sizeBytes
        ? Math.round((download.sizeBytes / 1024 ** 3) * 10) / 10
        : null

  return {
    slug: slugify(slugSource),
    title,
    synopsis: limit(readString(raw.synopsis ?? raw.description) ?? '', 6000),
    releaseYear: normalizeReleaseYear(raw.releaseYear ?? raw.releaseDate),
    developer: limit(readString(raw.developer) ?? '', 120) || null,
    publisher: limit(readString(raw.publisher) ?? '', 120) || null,
    genres: readStringList(raw.genres ?? raw.tags, 8, 40),
    coverUrl,
    heroUrl,
    screenshots: normalizeScreenshots(screenshotValue),
    onlineStatus: 'offline',
    storageGb,
    requirements,
    download,
    catalogAddedAt: null
  }
}

function parseHydraManifest(root: JsonObject, filePath: string): NormalizedManifest {
  const downloads = root.downloads
  if (!Array.isArray(downloads)) {
    throw new Error('The source must contain a "downloads" array.')
  }
  if (downloads.length === 0) {
    throw new Error('This source does not contain any downloads.')
  }
  if (downloads.length > MAX_GAMES) {
    throw new Error(
      `This source has too many entries (limit: ${MAX_GAMES.toLocaleString('en-US')}).`
    )
  }

  const warnings: string[] = []
  const games: CatalogGameInput[] = []
  const slugs = new Set<string>()

  downloads.forEach((entry, index) => {
    const raw = asObject(entry)
    if (!raw) {
      warnings.push(`Entry ${index + 1} is not a JSON object and was skipped.`)
      return
    }

    const rawTitle = readString(raw.title)
    if (!rawTitle) {
      warnings.push(`Entry ${index + 1} has no title and was skipped.`)
      return
    }

    const title = cleanHydraTitle(rawTitle)
    if (!title) {
      warnings.push(`Entry ${index + 1} has an empty title and was skipped.`)
      return
    }
    if (title.length > 200) {
      warnings.push(`“${title.slice(0, 60)}…” has an overly long title and was skipped.`)
      return
    }

    const uris = normalizeUriList(raw.uris)
    if (uris.length === 0) {
      warnings.push(`“${title}” has no valid download link and was skipped.`)
      return
    }

    const orderedUris = orderDownloadUris(uris[0], uris.slice(1))
    const primaryUri = orderedUris[0]
    const type: DownloadType = isTorrentUri(primaryUri) ? 'torrent' : 'http'
    const sizeBytes = parseFileSizeBytes(raw.fileSize)
    const storageGb =
      sizeBytes === null ? null : Math.round((sizeBytes / 1024 ** 3) * 10) / 10

    games.push({
      slug: uniqueSlug(slugify(title), slugs),
      title,
      synopsis: '',
      releaseYear: null,
      developer: null,
      publisher: null,
      genres: [],
      coverUrl: null,
      heroUrl: null,
      screenshots: [],
      onlineStatus: 'offline',
      storageGb,
      requirements: createEmptyRequirements(),
      download: {
        url: primaryUri,
        type,
        releaseType: hydraReleaseType(title, primaryUri),
        sizeBytes,
        mirrors: orderedUris.slice(1, MAX_MIRRORS + 1)
      },
      catalogAddedAt: normalizeCatalogDate(raw.uploadDate)
    })
  })

  if (games.length === 0) {
    const detail = warnings.slice(0, 3).join(' ')
    throw new Error(`No valid downloads could be imported.${detail ? ` ${detail}` : ''}`)
  }

  const name = readString(root.name) ?? basename(filePath, extname(filePath))
  const description =
    readString(root.description) ??
    `Hydra-style source with ${games.length.toLocaleString('en-US')} downloadable entries.`

  return {
    name: limit(name, 120),
    description: limit(description, 500),
    manifestVersion: null,
    games,
    warnings: warnings.slice(0, MAX_WARNINGS)
  }
}

function parseManifest(raw: unknown, filePath: string): NormalizedManifest {
  const root = asObject(raw)
  if (root && Array.isArray(root.downloads)) {
    return parseHydraManifest(root, filePath)
  }

  const gamesValue = Array.isArray(raw) ? raw : root?.games
  if (!Array.isArray(gamesValue)) {
    throw new Error(
      'The manifest must contain a "games" array, or be a JSON array of game entries.'
    )
  }
  if (gamesValue.length === 0) {
    throw new Error('This manifest does not contain any games.')
  }
  if (gamesValue.length > MAX_GAMES) {
    throw new Error(`This manifest has too many games (limit: ${MAX_GAMES}).`)
  }

  const warnings: string[] = []
  const games: CatalogGameInput[] = []
  const slugs = new Set<string>()

  gamesValue.forEach((entry, index) => {
    const gameObject = asObject(entry)
    if (!gameObject) {
      warnings.push(`Entry ${index + 1} is not a JSON object and was skipped.`)
      return
    }
    const parsed = normalizeGame(gameObject, index, warnings)
    if (!parsed) return

    const slug = uniqueSlug(parsed.slug, slugs)
    games.push({ ...parsed, slug })
  })

  if (games.length === 0) {
    const detail = warnings.slice(0, 3).join(' ')
    throw new Error(`No valid games could be imported.${detail ? ` ${detail}` : ''}`)
  }

  const versionRaw = root ? readNumber(root.version) : null
  const name = (root ? readString(root.name) : null) ?? basename(filePath, extname(filePath))
  const description = root ? readString(root.description) : null

  return {
    name: limit(name, 120),
    description: description ? limit(description, 500) : null,
    manifestVersion: versionRaw === null ? null : Math.round(versionRaw),
    games,
    warnings: warnings.slice(0, MAX_WARNINGS)
  }
}

/**
 * Owns user-supplied catalog manifests: validation, SQLite persistence, source
 * management, and hand-off of queued downloads for the future download engine.
 */
export class CatalogManager {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly options: { samplePath: string; downloadsDirectory: string }
  ) {}

  listSources(): CatalogSource[] {
    return this.repository.listSources()
  }

  listGames(): StoreGame[] {
    return this.repository.listGames()
  }

  getGame(gameId: number): StoreGame | null {
    return this.repository.getGame(gameId)
  }

  importSource(filePath: string, isSample = false): ImportCatalogResult {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new Error('Choose a sources.json manifest to import.')
    }

    const resolvedPath = resolve(filePath)
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
      throw new Error('That manifest file could not be found.')
    }
    if (extname(resolvedPath).toLowerCase() !== '.json') {
      throw new Error('Catalog manifests must be .json files.')
    }
    if (statSync(resolvedPath).size > MAX_MANIFEST_BYTES) {
      throw new Error('That manifest is too large. The limit is 10 MB.')
    }

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(resolvedPath, 'utf8'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error'
      throw new Error(`That manifest is not valid JSON. ${message}`)
    }

    const manifest = parseManifest(raw, resolvedPath)
    const sample = isSample || resolve(this.options.samplePath) === resolvedPath
    const { source, created } = this.repository.upsertSource({
      name: manifest.name,
      description: manifest.description,
      path: resolvedPath,
      manifestVersion: manifest.manifestVersion,
      isSample: sample
    })
    const updatedSource = this.repository.replaceGames(source.id, manifest.games)

    return {
      source: updatedSource,
      importedCount: manifest.games.length,
      replaced: !created,
      warnings: manifest.warnings
    }
  }

  loadSample(): ImportCatalogResult {
    if (!existsSync(this.options.samplePath)) {
      throw new Error(
        'The sample catalog is missing from this build. Import a sources.json file instead.'
      )
    }
    return this.importSource(this.options.samplePath, true)
  }

  refreshSource(sourceId: number): ImportCatalogResult {
    const source = this.repository.getSource(sourceId)
    if (!source) throw new Error('That catalog source no longer exists.')
    if (!existsSync(source.path)) {
      throw new Error(
        'The manifest file has moved or been deleted. Remove this source, then import it again.'
      )
    }
    return this.importSource(source.path, source.isSample)
  }

  removeSource(sourceId: number): CatalogSource[] {
    if (!this.repository.getSource(sourceId)) {
      throw new Error('That catalog source no longer exists.')
    }
    return this.repository.removeSource(sourceId)
  }

  queueDownload(gameId: number): QueueDownloadResult {
    mkdirSync(this.options.downloadsDirectory, { recursive: true })
    return this.repository.queueDownload(gameId, this.options.downloadsDirectory)
  }

  close(): void {
    this.repository.close()
  }
}
