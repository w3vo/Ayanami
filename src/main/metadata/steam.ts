import { createEmptyRequirementTier, createEmptyRequirements } from '../../shared/specs'
import type {
  RequirementTier,
  StoreMetadata,
  SystemRequirements
} from '../../shared/types'

const STORE_SEARCH_URL = 'https://store.steampowered.com/api/storesearch/'
const STORE_APP_DETAILS_URL = 'https://store.steampowered.com/api/appdetails'
const COMMUNITY_SEARCH_URL = 'https://steamcommunity.com/actions/SearchApps'
const ARTWORK_BASE_URL = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps'
const REQUEST_TIMEOUT_MS = 7_000
const MAX_CONCURRENT_REQUESTS = 4
const REQUEST_SPACING_MS = 40
const LOOKUP_BUDGET_MS = 14_000
const LOOKUP_CACHE_MS = 6 * 60 * 60 * 1000
const MISS_CACHE_MS = 10 * 60 * 1000
const APP_DETAILS_CACHE_MS = 6 * 60 * 60 * 1000
const MAX_SYNOPSIS_LENGTH = 3_500
const MAX_SCREENSHOTS = 6
const MAX_MATCHES_TO_VERIFY = 3
const APP_DETAILS_FILTERS =
  'basic,genres,screenshots,developers,publishers,release_date'
const STEAM_COOKIE =
  'birthtime=28800; lastagecheckage=1-January-1990; mature_content=1; wants_mature_content=1'

interface SteamStoreSearchItem {
  type?: string
  id?: number
  name?: string
}

interface SteamCommunitySearchItem {
  appid?: string
  name?: string
}

interface SteamAppDetailsData {
  type?: string
  name?: string
  short_description?: string
  detailed_description?: string
  about_the_game?: string
  header_image?: string
  background?: string
  background_raw?: string
  screenshots?: Array<{ path_full?: string; path_thumbnail?: string }>
  pc_requirements?: unknown
  release_date?: { date?: string; coming_soon?: boolean }
  developers?: string[]
  publishers?: string[]
  genres?: Array<{ description?: string }>
}

interface SteamCandidate {
  appId: number
  name: string
  score: number
  source: 'store' | 'community'
}

interface RequirementFields {
  cpu: string | null
  gpu: string | null
  ramGb: number | null
  storageGb: number | null
}

interface CachedLookup {
  result: StoreMetadata | null
  expiresAt: number
}

interface CachedAppDetails {
  data: SteamAppDetailsData | null
  expiresAt: number
}

interface VerifiedCandidate {
  candidate: SteamCandidate
  details: SteamAppDetailsData
  score: number
}

const lookupCache = new Map<string, CachedLookup>()
const inFlightLookups = new Map<string, Promise<StoreMetadata | null>>()
const appDetailsCache = new Map<number, CachedAppDetails>()

function stash<K, V>(cache: Map<K, V>, key: K, value: V): void {
  if (cache.size >= 500) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

let activeRequests = 0
let nextRequestAt = 0
const requestWaiters: Array<() => void> = []

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireRequestSlot(): Promise<void> {
  while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => requestWaiters.push(resolve))
  }

  activeRequests += 1
  const now = Date.now()
  const startAt = Math.max(now, nextRequestAt)
  nextRequestAt = startAt + REQUEST_SPACING_MS
  if (startAt > now) await delay(startAt - now)
}

function releaseRequestSlot(): void {
  activeRequests = Math.max(0, activeRequests - 1)
  requestWaiters.shift()?.()
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}

function ensureBudget(deadline: number, phase: string): void {
  if (remainingMs(deadline) < 800) {
    throw new Error(`Steam ${phase} timed out`)
  }
}

async function fetchSteamJson<T>(url: string, deadline: number): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    ensureBudget(deadline, 'request')

    await acquireRequestSlot()
    try {
      const timeout = Math.max(750, Math.min(REQUEST_TIMEOUT_MS, remainingMs(deadline)))
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Ayanami/0.1 (local game launcher)',
          Referer: 'https://store.steampowered.com/',
          Cookie: STEAM_COOKIE
        },
        signal: AbortSignal.timeout(timeout)
      })

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        lastError = new Error(`Steam request failed with status ${response.status}`)
        if (retryable && attempt === 0 && remainingMs(deadline) > 2_000) {
          await delay(550)
          continue
        }
        throw lastError
      }

      return (await response.json()) as T
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Steam request failed')
      const timedOut = /timeout|timed out|aborted/i.test(lastError.message)
      if (!timedOut && attempt === 0 && remainingMs(deadline) > 2_000) {
        await delay(450)
        continue
      }
      throw lastError
    } finally {
      releaseRequestSlot()
    }
  }

  throw lastError ?? new Error('Steam request failed')
}

const PARENTHETICAL_MARKERS =
  /\b(?:v\d[\d.]*|build\s*\d+|update\s*\d+|all\s+dlcs?|dlcs?|online|lan|co-?op|multiplayer|repack|portable|fitgirl|dodi)\b/i

/** Removes storefront suffixes so Steam sees "NieR:Automata", not the release name. */
export function cleanCatalogTitle(value: string): string {
  let title = value.replace(/\s*[-–—:]?\s*\bfree\s+download\b/gi, ' ')

  title = title.replace(/\(([^()]*)\)/g, (match, inner: string) =>
    PARENTHETICAL_MARKERS.test(inner) ? ' ' : match
  )
  title = title.replace(/\[([^\]]*)\]/g, (match, inner: string) =>
    PARENTHETICAL_MARKERS.test(inner) ? ' ' : match
  )

  return title
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
    .trim()
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Lower is better; scores above 3 mean the match is only token-based. */
function matchScore(query: string, name: string): number {
  const normalizedQuery = normalizeTitle(query)
  const normalizedName = normalizeTitle(name)
  if (!normalizedQuery || !normalizedName) return 99
  if (normalizedName === normalizedQuery) return 0
  if (normalizedName.startsWith(normalizedQuery)) return 1
  if (normalizedName.includes(normalizedQuery)) return 2

  const queryTokens = new Set(normalizedQuery.split(' ').filter(Boolean))
  const nameTokens = new Set(normalizedName.split(' ').filter(Boolean))
  if (queryTokens.size === 0) return 99

  let shared = 0
  for (const token of queryTokens) {
    if (nameTokens.has(token)) shared += 1
  }

  const ratio = shared / queryTokens.size
  if (ratio >= 0.7) return 3 + (1 - ratio)
  return 99
}

const EDITION_SUFFIX =
  /\s+(?:(?:deluxe|ultimate|definitive|enhanced|complete|premium|gold|legendary|collector'?s?|anniversary|game of the year|goty)\s+edition|remastered|remake|goty|game of the year)\s*$/i

function fallbackSearchTitle(term: string): string | null {
  let fallback = term.replace(/\s+VR$/i, '').trim()
  fallback = fallback.replace(EDITION_SUFFIX, '').trim()

  const colonIndex = fallback.indexOf(':')
  if (colonIndex > 0) {
    const base = fallback.slice(0, colonIndex).trim()
    if (base.split(/\s+/).length >= 2) fallback = base
  }

  fallback = fallback.replace(/\s*\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  if (!fallback || fallback.length < 3 || fallback === term) return null
  return fallback
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&trade;/gi, '™')
    .replace(/&reg;/gi, '®')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
}

function steamHtmlToText(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '')
    .replace(/<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  return decodeEntities(text)
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function limitText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function uniqueStrings(values: unknown, maxCount: number, maxLength: number): string[] {
  if (!Array.isArray(values)) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(limitText(text, maxLength))
    if (result.length >= maxCount) break
  }
  return result
}

function parseGigabytes(value: string | null): number | null {
  if (!value) return null

  const match = /(\d+(?:[.,]\d+)?)\s*(tb|tib|gb|gib|mb|mib)\b/i.exec(value)
  if (!match) return null

  const amount = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null

  const unit = match[2].toLowerCase()
  const multiplier = unit.startsWith('t') ? 1024 : unit.startsWith('g') ? 1 : 1 / 1024
  return Math.round(amount * multiplier * 10) / 10
}

function extractRequirementField(text: string, labels: string[]): string | null {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const match = /^([^:]{2,48}):\s*(.+)$/.exec(line)
    if (!match) continue

    const label = match[1]
      .toLowerCase()
      .replace(/[^a-z ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!labels.some((candidate) => label.includes(candidate))) continue

    const value = match[2].trim().replace(/[;,\s]+$/, '')
    if (!value || /^(?:n\/?a|none|unknown)$/i.test(value)) continue
    return limitText(value, 200)
  }

  return null
}

function requirementText(value: unknown): string {
  if (typeof value === 'string') return steamHtmlToText(value)
  if (Array.isArray(value)) {
    return steamHtmlToText(value.filter((entry) => typeof entry === 'string').join('<br>'))
  }
  return ''
}

function parseRequirementTier(value: unknown): RequirementTier {
  const text = requirementText(value)
  if (!text) return createEmptyRequirementTier()

  const fields: RequirementFields = {
    cpu: extractRequirementField(text, ['processor', 'cpu']),
    gpu: extractRequirementField(text, ['graphics', 'video card', 'gpu']),
    ramGb: parseGigabytes(
      extractRequirementField(text, ['memory', 'ram'])
    ),
    storageGb: parseGigabytes(
      extractRequirementField(text, ['storage', 'hard disk', 'hard drive', 'disk space'])
    )
  }

  return {
    ...createEmptyRequirementTier(),
    ...fields
  }
}

function parseRequirements(data: SteamAppDetailsData): SystemRequirements {
  const raw = data.pc_requirements
  if (!raw) return createEmptyRequirements()

  if (typeof raw === 'string' || Array.isArray(raw)) {
    return {
      minimum: parseRequirementTier(raw),
      recommended: createEmptyRequirementTier()
    }
  }

  if (typeof raw !== 'object') return createEmptyRequirements()

  const requirements = raw as { minimum?: unknown; recommended?: unknown }
  return {
    minimum: parseRequirementTier(requirements.minimum),
    recommended: parseRequirementTier(requirements.recommended)
  }
}

function parseReleaseYear(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  if (!Number.isNaN(parsed)) return new Date(parsed).getUTCFullYear()
  const match = /\b(?:19|20)\d{2}\b/.exec(value)
  return match ? Number(match[0]) : null
}

function joinNames(values: unknown): string | null {
  const names = uniqueStrings(values, 2, 120)
  return names.length > 0 ? names.join(', ') : null
}

function buildMetadata(appId: number, data: SteamAppDetailsData): StoreMetadata {
  const synopsisSource =
    data.detailed_description ?? data.about_the_game ?? data.short_description ?? ''
  const synopsis = limitText(steamHtmlToText(synopsisSource), MAX_SYNOPSIS_LENGTH)

  const screenshots = uniqueStrings(
    (data.screenshots ?? []).map((screenshot) => screenshot.path_full),
    MAX_SCREENSHOTS,
    4_000
  ).filter((url) => url.startsWith('https://'))

  return {
    steamAppId: appId,
    synopsis,
    releaseYear: parseReleaseYear(data.release_date?.date),
    developer: joinNames(data.developers),
    publisher: joinNames(data.publishers),
    genres: uniqueStrings(
      (data.genres ?? []).map((genre) => genre.description),
      3,
      60
    ),
    coverUrl: `${ARTWORK_BASE_URL}/${appId}/library_600x900.jpg`,
    heroUrl:
      httpsUrl(data.background_raw) ??
      httpsUrl(data.background) ??
      `${ARTWORK_BASE_URL}/${appId}/library_hero.jpg`,
    screenshots,
    requirements: parseRequirements(data)
  }
}

async function searchSteamStore(term: string, deadline: number): Promise<SteamCandidate[]> {
  const url = `${STORE_SEARCH_URL}?term=${encodeURIComponent(term)}&l=english&cc=us`
  const payload = await fetchSteamJson<{ items?: SteamStoreSearchItem[] }>(url, deadline)
  const seen = new Set<number>()
  const candidates: SteamCandidate[] = []

  for (const item of payload.items ?? []) {
    if (item.type !== 'app' || typeof item.id !== 'number' || !item.name) continue
    if (seen.has(item.id)) continue
    const score = matchScore(term, item.name)
    if (score >= 10) continue
    seen.add(item.id)
    candidates.push({ appId: item.id, name: item.name, score, source: 'store' })
  }

  return candidates.sort((first, second) => first.score - second.score)
}

async function searchSteamCommunity(term: string, deadline: number): Promise<SteamCandidate[]> {
  const url = `${COMMUNITY_SEARCH_URL}/${encodeURIComponent(term)}`
  const payload = await fetchSteamJson<SteamCommunitySearchItem[]>(url, deadline)
  if (!Array.isArray(payload)) return []

  const seen = new Set<number>()
  const candidates: SteamCandidate[] = []
  for (const item of payload) {
    const appId = Number(item.appid)
    if (!Number.isInteger(appId) || appId <= 0 || !item.name) continue
    if (seen.has(appId)) continue
    const score = matchScore(term, item.name)
    if (score >= 10) continue
    seen.add(appId)
    candidates.push({ appId, name: item.name, score, source: 'community' })
  }

  return candidates.sort((first, second) => first.score - second.score)
}

async function getSteamAppDetails(
  appId: number,
  deadline: number,
  force = false
): Promise<SteamAppDetailsData | null> {
  const cached = appDetailsCache.get(appId)
  if (!force && cached && cached.expiresAt > Date.now()) return cached.data

  const url = `${STORE_APP_DETAILS_URL}?appids=${appId}&l=english&cc=us&filters=${encodeURIComponent(
    APP_DETAILS_FILTERS
  )}`
  const payload = await fetchSteamJson<
    Record<string, { success?: boolean; data?: SteamAppDetailsData }>
  >(url, deadline)
  const entry = payload[String(appId)]
  const data = entry?.success && entry.data ? entry.data : null
  stash(appDetailsCache, appId, {
    data,
    expiresAt: Date.now() + (data ? APP_DETAILS_CACHE_MS : MISS_CACHE_MS)
  })
  return data
}

function isSupportedAppType(type: string | undefined): boolean {
  return !type || type === 'game' || type === 'software'
}

async function searchSteamCandidates(
  term: string,
  deadline: number
): Promise<SteamCandidate[]> {
  let storeCandidates: SteamCandidate[] | null = null
  let storeError: unknown = null
  try {
    storeCandidates = await searchSteamStore(term, deadline)
  } catch (error) {
    storeError = error
  }

  // A strong store hit is enough; only ask the looser community index when
  // storesearch is empty, weak, or unavailable.
  if (storeCandidates && storeCandidates.some((candidate) => candidate.score <= 2)) {
    return storeCandidates
  }

  let communityCandidates: SteamCandidate[] | null = null
  let communityError: unknown = null
  try {
    communityCandidates = await searchSteamCommunity(term, deadline)
  } catch (error) {
    communityError = error
  }

  if (!storeCandidates && !communityCandidates) {
    const reason = storeError ?? communityError
    throw reason instanceof Error ? reason : new Error('Steam search failed')
  }

  const merged = new Map<number, SteamCandidate>()
  for (const candidates of [storeCandidates ?? [], communityCandidates ?? []]) {
    for (const candidate of candidates) {
      const existing = merged.get(candidate.appId)
      if (!existing || candidate.score < existing.score) {
        merged.set(candidate.appId, candidate)
      }
    }
  }

  if (merged.size === 0 && storeError) {
    throw storeError instanceof Error ? storeError : new Error('Steam store search failed')
  }

  return [...merged.values()].sort(
    (first, second) =>
      first.score - second.score ||
      (first.source === second.source ? 0 : first.source === 'store' ? -1 : 1) ||
      first.appId - second.appId
  )
}

async function verifyCandidate(
  candidate: SteamCandidate,
  term: string,
  deadline: number,
  force: boolean
): Promise<VerifiedCandidate | null> {
  const details = await getSteamAppDetails(candidate.appId, deadline, force)
  if (!details || !isSupportedAppType(details.type)) return null

  const detailScore = matchScore(term, details.name ?? candidate.name)
  const limit = candidate.source === 'community' ? 3.2 : 8
  if (detailScore > limit) return null

  return {
    candidate,
    details,
    score: Math.min(candidate.score, detailScore)
  }
}

async function lookupWithTerm(
  term: string,
  deadline: number,
  force: boolean
): Promise<StoreMetadata | null> {
  ensureBudget(deadline, 'search')
  const candidates = await searchSteamCandidates(term, deadline)
  if (candidates.length === 0) return null

  ensureBudget(deadline, 'details')
  const viable = candidates.filter(
    (candidate) => candidate.source === 'store' || candidate.score <= 3.2
  )
  if (viable.length === 0) return null

  const batch = viable.slice(0, MAX_MATCHES_TO_VERIFY)
  const probes = await Promise.all(
    batch.map(async (candidate) => {
      try {
        return {
          verified: await verifyCandidate(candidate, term, deadline, force),
          error: null
        }
      } catch (error) {
        return {
          verified: null,
          error: error instanceof Error ? error : new Error('Steam details failed')
        }
      }
    })
  )

  const verified = probes
    .map((probe) => probe.verified)
    .filter((entry): entry is VerifiedCandidate => entry !== null)

  if (verified.length === 0) {
    const firstError = probes.find((probe) => probe.error !== null)?.error
    if (firstError) throw firstError
    return null
  }

  verified.sort(
    (first, second) =>
      first.score - second.score ||
      (first.candidate.source === second.candidate.source
        ? 0
        : first.candidate.source === 'store'
          ? -1
          : 1) ||
      first.candidate.appId - second.candidate.appId
  )

  const best = verified[0]
  return buildMetadata(best.candidate.appId, best.details)
}

/**
 * Resolves a catalog title to the Steam Store's public metadata. No API key is
 * required; results are cached by the catalog repository after a successful
 * lookup, and misses are recorded so they are not retried on every page view.
 * Concurrent lookups for the same title share one request, and transient
 * network failures are thrown so the caller can record a retryable error
 * instead of a permanent miss.
 */
export async function lookupSteamGame(
  rawTitle: string,
  options: { force?: boolean } = {}
): Promise<StoreMetadata | null> {
  const term = cleanCatalogTitle(rawTitle)
  if (!term) return null

  const key = normalizeTitle(term)
  if (!key) return null

  const cached = lookupCache.get(key)
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.result
  }

  const pending = inFlightLookups.get(key)
  if (!options.force && pending) return pending

  const deadline = Date.now() + LOOKUP_BUDGET_MS
  let task: Promise<StoreMetadata | null> | null = null
  task = (async () => {
    try {
      const primary = await lookupWithTerm(term, deadline, options.force === true)
      if (primary) {
        stash(lookupCache, key, {
          result: primary,
          expiresAt: Date.now() + LOOKUP_CACHE_MS
        })
        return primary
      }

      const fallback = fallbackSearchTitle(term)
      if (fallback && remainingMs(deadline) > 1_500) {
        ensureBudget(deadline, 'search')
        const secondary = await lookupWithTerm(fallback, deadline, options.force === true)
        if (secondary) {
          stash(lookupCache, key, {
            result: secondary,
            expiresAt: Date.now() + LOOKUP_CACHE_MS
          })
          return secondary
        }
      }

      stash(lookupCache, key, {
        result: null,
        expiresAt: Date.now() + MISS_CACHE_MS
      })
      return null
    } finally {
      if (task && inFlightLookups.get(key) === task) inFlightLookups.delete(key)
    }
  })()

  inFlightLookups.set(key, task)
  return task
}
