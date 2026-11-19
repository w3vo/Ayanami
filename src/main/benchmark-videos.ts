import type {
  BenchmarkLookupResult,
  BenchmarkVideo,
  HardwareProfile,
  StoreGame
} from '../shared/types'
import type { CatalogRepository } from './catalog-repository'
import { cleanCatalogTitle } from './metadata/steam'

const YOUTUBE_ORIGIN = 'https://www.youtube.com'
const YOUTUBE_NOCOOKIE_ORIGIN = 'https://www.youtube-nocookie.com'
const REQUEST_TIMEOUT_MS = 15_000
const REQUEST_SPACING_MS = 1_500
// Bump when the relevance rules change so older, looser matches are ignored.
const CACHE_VERSION = 'relevance-v4'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const ROMAN_TOKENS: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12'
}

const STOP_TOKENS = new Set([
  'a',
  'all',
  'an',
  'and',
  'benchmark',
  'co',
  'complete',
  'coop',
  'definitive',
  'deluxe',
  'download',
  'edition',
  'for',
  'free',
  'game',
  'goty',
  'in',
  'lan',
  'multiplayer',
  'of',
  'on',
  'online',
  'op',
  'pc',
  'remake',
  'remastered',
  'repack',
  'the',
  'to',
  'ultimate',
  'with',
  'year'
])

// Clips that cover a franchise or several games are never a benchmark for one
// specific catalog title.
const COMPILATION_PATTERN =
  /\b(?:franchise|all games|game collection|series benchmark|history of|multi game|compilation)\b/

interface VideoCandidate {
  videoId: string
  title: string
  channel: string | null
  length: string | null
  index: number
}

interface ScoredCandidate extends VideoCandidate, CandidateRelevance {}

let queue: Promise<void> = Promise.resolve()
let nextRequestAt = 0

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function scheduleRequest<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = nextRequestAt - Date.now()
    if (wait > 0) await delay(wait)
    nextRequestAt = Date.now() + REQUEST_SPACING_MS
    return task()
  })
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export function youtubeSearchUrl(query: string): string {
  return `${YOUTUBE_ORIGIN}/results?search_query=${encodeURIComponent(query)}&hl=en&gl=US`
}

/** Uses the compact marketing name so YouTube sees "GTX 1650", not "NVIDIA GeForce GTX 1650". */
export function shortGpuName(gpu: string): string {
  return gpu
    .replace(/\(r\)|\(tm\)|\(c\)|™|®|©/gi, ' ')
    .replace(/^(?:nvidia|amd|intel|apple)\s+/i, '')
    .replace(/^(?:geforce|radeon)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildBenchmarkQuery(gameTitle: string, gpu: string): string {
  const game = cleanCatalogTitle(gameTitle) || gameTitle.trim()
  const card = shortGpuName(gpu)
  if (!card || /^unknown/i.test(card)) return `${game} benchmark`
  return `${card} ${game} benchmark`
}

export function normalizeTokens(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((token) => ROMAN_TOKENS[token] ?? token)
    .filter((token) => token.length >= 2 && !STOP_TOKENS.has(token))

  // Duplicate title words (Far Far West) must not satisfy two token hits by
  // themselves.
  return [...new Set(tokens)]
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((token) => ROMAN_TOKENS[token] ?? token)
    .join(' ')
}

function matchesToken(haystack: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Word boundaries for names so "ring" does not match "during"; plain
  // substring matching for model numbers keeps "1650" easy to detect.
  if (/^\d+$/.test(token)) return haystack.includes(token)
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(haystack)
}

interface CandidateRelevance {
  score: number
  gameHits: number
  gameTokenCount: number
  gpuCoverage: number
  gpuModelHits: number
  gpuModelTokenCount: number
}

/** Model numbers (1650, A750, 4070) distinguish one card from another. */
function isGpuModelToken(token: string): boolean {
  return /\d/.test(token) && !/^\d+(?:gb|mb|tb)$/.test(token)
}

function scoreCandidate(
  candidate: VideoCandidate,
  gpu: string,
  gameTitle: string
): CandidateRelevance {
  const title = normalizeText(candidate.title)
  const gpuTokens = normalizeTokens(shortGpuName(gpu))
  const gameTokens = normalizeTokens(cleanCatalogTitle(gameTitle) || gameTitle)
  const gpuModelTokens = gpuTokens.filter(isGpuModelToken)

  const gpuHits = gpuTokens.filter((token) => matchesToken(title, token)).length
  const gpuModelHits = gpuModelTokens.filter((token) => matchesToken(title, token)).length
  const gameHits = gameTokens.filter((token) => matchesToken(title, token)).length
  const gameCoverage = gameTokens.length > 0 ? gameHits / gameTokens.length : 0
  const gpuCoverage = gpuTokens.length > 0 ? gpuHits / gpuTokens.length : 0

  let score = 0
  if (gameCoverage >= 0.99) score += 6
  else if (gameCoverage >= 0.75) score += 4
  else if (gameHits > 0) score += 1
  if (gpuCoverage >= 0.99) score += 5
  else if (gpuCoverage >= 0.5) score += 3
  else if (gpuHits > 0) score += 1
  if (/\bbenchmark\b/.test(title)) score += 3
  if (/\b(?:fps|performance|test)\b/.test(title)) score += 1
  if (/\b(?:1080p|1440p|4k)\b/.test(title)) score += 1
  const queryText = normalizeText(shortGpuName(gpu))
  if (/\b(?:mobile|laptop|notebook)\b/.test(title) && !/\b(?:mobile|laptop|notebook)\b/.test(queryText)) {
    score -= 2
  }
  return {
    score,
    gameHits,
    gameTokenCount: gameTokens.length,
    gpuCoverage,
    gpuModelHits,
    gpuModelTokenCount: gpuModelTokens.length
  }
}

function parseVideoRenderer(
  renderer: Record<string, unknown>,
  index: number
): VideoCandidate | null {
  const videoId = typeof renderer.videoId === 'string' ? renderer.videoId : ''
  if (!/^[\w-]{11}$/.test(videoId)) return null

  const titleObject = renderer.title as
    | { runs?: Array<{ text?: string }>; simpleText?: string }
    | undefined
  const title =
    titleObject?.runs?.map((run) => run.text ?? '').join('') ||
    titleObject?.simpleText ||
    ''
  if (!title) return null

  const owner = renderer.ownerText as { runs?: Array<{ text?: string }> } | undefined
  const longByline = renderer.longBylineText as
    | { runs?: Array<{ text?: string }> }
    | undefined
  const shortByline = renderer.shortBylineText as
    | { runs?: Array<{ text?: string }> }
    | undefined
  const channel =
    owner?.runs?.[0]?.text ??
    longByline?.runs?.[0]?.text ??
    shortByline?.runs?.[0]?.text ??
    null

  const length = (renderer.lengthText as { simpleText?: string } | undefined)?.simpleText ?? null

  const badges = renderer.badges
  if (Array.isArray(badges)) {
    const labels = badges
      .map((badge) => {
        const meta = (badge as { metadataBadgeRenderer?: { label?: string } })
          .metadataBadgeRenderer
        return meta?.label ?? ''
      })
      .join(' ')
    if (/\b(?:live|upcoming|premiere)\b/i.test(labels)) return null
  }

  return { videoId, title: title.trim(), channel: channel?.trim() || null, length, index }
}

function collectVideos(node: unknown, output: VideoCandidate[]): void {
  if (!node || typeof node !== 'object' || output.length >= 40) return

  if (Array.isArray(node)) {
    for (const entry of node) collectVideos(entry, output)
    return
  }

  const record = node as Record<string, unknown>
  const renderer = record.videoRenderer
  if (renderer && typeof renderer === 'object') {
    const parsed = parseVideoRenderer(renderer as Record<string, unknown>, output.length)
    if (parsed) output.push(parsed)
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectVideos(value, output)
  }
}

function extractInitialData(html: string): unknown {
  const match =
    /ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(html) ??
    /ytInitialData\s*=\s*(\{[\s\S]*?\});/.exec(html)
  if (!match) return null

  try {
    return JSON.parse(match[1]) as unknown
  } catch {
    return null
  }
}

async function fetchYoutubeCandidates(query: string): Promise<VideoCandidate[]> {
  const response = await fetch(youtubeSearchUrl(query), {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(`YouTube search failed with status ${response.status}`)
  }

  const html = await response.text()
  const initialData = extractInitialData(html)
  if (!initialData) throw new Error('YouTube did not return search results.')

  const candidates: VideoCandidate[] = []
  collectVideos(initialData, candidates)
  return candidates
}

export function bestCandidate(
  candidates: VideoCandidate[],
  gpu: string,
  gameTitle: string
): VideoCandidate | null {
  const scored: ScoredCandidate[] = candidates
    .map((candidate) => ({
      ...candidate,
      ...scoreCandidate(candidate, gpu, gameTitle)
    }))
    .filter((candidate) => {
      // Never substitute a different game or a different graphics card.
      // Short titles must match every distinctive token; longer titles may miss
      // at most a quarter of them. The card's model number must always match,
      // so a GTX 1050 clip cannot stand in for a GTX 1650.
      const title = normalizeText(candidate.title)
      if (COMPILATION_PATTERN.test(title)) return false

      const requiredGameHits =
        candidate.gameTokenCount <= 3
          ? candidate.gameTokenCount
          : Math.ceil(candidate.gameTokenCount * 0.75)

      return (
        candidate.score >= 6 &&
        candidate.gpuCoverage >= 0.5 &&
        candidate.gpuModelHits === candidate.gpuModelTokenCount &&
        candidate.gameTokenCount > 0 &&
        candidate.gameHits >= requiredGameHits
      )
    })
    .sort(
      (first, second) =>
        second.score - first.score ||
        second.gameHits - first.gameHits ||
        second.gpuCoverage - first.gpuCoverage ||
        first.index - second.index
    )

  return scored[0] ?? null
}

function embedUrlFor(videoId: string): string {
  return `${YOUTUBE_NOCOOKIE_ORIGIN}/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`
}

function toVideo(
  candidate: VideoCandidate,
  query: string,
  fetchedAt: string
): BenchmarkVideo {
  return {
    videoId: candidate.videoId,
    title: candidate.title,
    channel: candidate.channel,
    watchUrl: `${YOUTUBE_ORIGIN}/watch?v=${candidate.videoId}`,
    embedUrl: embedUrlFor(candidate.videoId),
    thumbnailUrl: `https://i.ytimg.com/vi/${candidate.videoId}/hqdefault.jpg`,
    searchUrl: youtubeSearchUrl(query),
    query,
    fetchedAt
  }
}

/**
 * Finds one relevant YouTube benchmark per game and GPU. Results and misses are
 * cached in SQLite, keyed by the exact query so changing hardware invalidates
 * the old video automatically.
 */
export class BenchmarkVideoService {
  constructor(private readonly repository: CatalogRepository) {}

  async getForGame(
    gameId: number,
    hardware: HardwareProfile,
    force = false
  ): Promise<BenchmarkLookupResult> {
    const game: StoreGame | null = this.repository.getGame(gameId)
    if (!game) throw new Error('That game is no longer in the catalog.')

    const query = buildBenchmarkQuery(game.title, hardware.gpu)
    const searchUrl = youtubeSearchUrl(query)
    const cacheKey = `${CACHE_VERSION}:${query}`

    if (!force) {
      const cached = this.repository.getBenchmarkVideoCache(gameId, cacheKey)
      if (cached) {
        if (cached.status === 'found' && cached.videoId && cached.title) {
          return {
            status: 'found',
            video: {
              videoId: cached.videoId,
              title: cached.title,
              channel: cached.channel,
              watchUrl: `${YOUTUBE_ORIGIN}/watch?v=${cached.videoId}`,
              embedUrl: embedUrlFor(cached.videoId),
              thumbnailUrl: `https://i.ytimg.com/vi/${cached.videoId}/hqdefault.jpg`,
              searchUrl,
              query,
              fetchedAt: cached.fetchedAt
            }
          }
        }
        return { status: 'empty', query, searchUrl }
      }
    }

    try {
      const candidate = await scheduleRequest(async () => {
        const candidates = await fetchYoutubeCandidates(query)
        return bestCandidate(candidates, hardware.gpu, game.title)
      })

      if (!candidate) {
        this.repository.saveBenchmarkVideoCache(gameId, cacheKey, {
          status: 'empty',
          videoId: null,
          title: null,
          channel: null
        })
        return { status: 'empty', query, searchUrl }
      }

      const fetchedAt = new Date().toISOString()
      const video = toVideo(candidate, query, fetchedAt)
      this.repository.saveBenchmarkVideoCache(gameId, cacheKey, {
        status: 'found',
        videoId: video.videoId,
        title: video.title,
        channel: video.channel
      })
      return { status: 'found', video }
    } catch (error) {
      return {
        status: 'error',
        query,
        searchUrl,
        message: error instanceof Error ? error.message : 'YouTube search failed.'
      }
    }
  }
}
