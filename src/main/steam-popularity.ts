import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { PopularGamesResult, StoreGame } from '../shared/types'
import { parseCatalogTitleVersion, selectLatestCatalogGames } from '../shared/catalog'
import type { CatalogRepository } from './catalog-repository'

const POPULAR_LIMIT = 20
const CACHE_TTL_MS = 30 * 60 * 1000
const FETCH_TIMEOUT_MS = 8_000
const USER_AGENT = 'Ayanami/0.1 (Windows desktop game launcher)'

const EDITION_WORDS =
  /\b(deluxe|ultimate|definitive|enhanced|complete|premium|gold|legendary|collector|collectors|edition|remastered|remake|goty|game of the year|anniversary)\b/g

interface PopularEntry {
  appId: number | null
  name: string | null
  rank: number
}

interface PopularCache {
  updatedAt: string
  entries: PopularEntry[]
}

interface MostPlayedResponse {
  response?: {
    ranks?: Array<{ rank?: number; appid?: number }>
  }
}

interface FeaturedResponse {
  top_sellers?: { items?: Array<{ id?: number; name?: string }> }
  specials?: { items?: Array<{ id?: number; name?: string }> }
}

interface SteamSpyEntry {
  appid?: number | string
  name?: string
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(EDITION_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function readCache(path: string): PopularCache | null {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PopularCache
    if (!Array.isArray(parsed.entries)) return null
    return parsed
  } catch {
    return null
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Steam popularity request failed with HTTP ${response.status}.`)
  return (await response.json()) as T
}

/**
 * Resolves Steam's live most-played chart against the user's imported catalog.
 * Only chart entries that exist in the catalog are shown, so the Store front
 * page stays a curated, fully-enrichable set instead of a 5,000-title wall.
 */
export class SteamPopularityService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly cachePath: string
  ) {}

  async getPopularGames(limit = POPULAR_LIMIT): Promise<PopularGamesResult> {
    const cached = readCache(this.cachePath)
    const cacheFresh =
      cached !== null && Date.now() - Date.parse(cached.updatedAt) < CACHE_TTL_MS

    let entries = cacheFresh ? cached.entries : []
    let updatedAt = cacheFresh ? cached.updatedAt : new Date().toISOString()

    if (!cacheFresh) {
      try {
        entries = await this.fetchPopularEntries()
        updatedAt = new Date().toISOString()
        this.writeCache({ updatedAt, entries })
      } catch {
        entries = cached?.entries ?? []
        updatedAt = cached?.updatedAt ?? updatedAt
      }
    }

    const games = this.resolveGames(entries, limit)
    return {
      games,
      source: entries.length > 0 ? 'steam' : 'catalog',
      updatedAt
    }
  }

  private async fetchPopularEntries(): Promise<PopularEntry[]> {
    const [mostPlayedResult, featuredResult, steamSpyResult] = await Promise.allSettled([
      fetchJson<MostPlayedResponse>(
        'https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/'
      ),
      fetchJson<FeaturedResponse>(
        'https://store.steampowered.com/api/featuredcategories?cc=us&l=english'
      ),
      fetchJson<Record<string, SteamSpyEntry>>(
        'https://steamspy.com/api.php?request=top100in2weeks'
      )
    ])

    const entries: PopularEntry[] = []
    const seen = new Set<string>()

    const push = (appId: number | null, name: string | null): void => {
      const key = appId ? `app:${appId}` : name ? `name:${normalizeTitle(name)}` : null
      if (!key || seen.has(key)) return
      seen.add(key)
      entries.push({ appId, name, rank: entries.length + 1 })
    }

    if (mostPlayedResult.status === 'fulfilled') {
      const ranks = mostPlayedResult.value.response?.ranks ?? []
      for (const rank of ranks) {
        if (typeof rank.appid !== 'number') continue
        push(rank.appid, null)
      }
    }

    const featuredNames = new Map<number, string>()
    if (featuredResult.status === 'fulfilled') {
      for (const group of [
        featuredResult.value.top_sellers?.items ?? [],
        featuredResult.value.specials?.items ?? []
      ]) {
        for (const item of group) {
          if (typeof item.id === 'number' && item.name) {
            featuredNames.set(item.id, item.name)
          }
        }
      }
    }

    if (steamSpyResult.status === 'fulfilled') {
      for (const entry of Object.values(steamSpyResult.value)) {
        const appId = Number(entry.appid)
        if (!Number.isFinite(appId) || appId <= 0) continue
        const name = entry.name?.trim() || featuredNames.get(appId) || null
        push(appId, name)
      }
    }

    // Attach names to chart entries when a secondary source already knows them.
    for (const entry of entries) {
      if (!entry.name && entry.appId) {
        entry.name = featuredNames.get(entry.appId) ?? null
      }
    }

    if (entries.length === 0) throw new Error('No Steam popularity data was returned.')
    return entries
  }

  private resolveGames(entries: PopularEntry[], limit: number): StoreGame[] {
    const latest = selectLatestCatalogGames(this.repository.listGames())
    const byAppId = new Map<number, StoreGame[]>()
    const byTitle = new Map<string, StoreGame[]>()

    for (const game of latest) {
      if (game.steamAppId) {
        const group = byAppId.get(game.steamAppId) ?? []
        group.push(game)
        byAppId.set(game.steamAppId, group)
      }
      for (const key of new Set([
        normalizeTitle(game.title),
        normalizeTitle(parseCatalogTitleVersion(game.title).baseTitle)
      ])) {
        if (!key) continue
        const group = byTitle.get(key) ?? []
        group.push(game)
        byTitle.set(key, group)
      }
    }

    const selected: StoreGame[] = []
    const usedGroups = new Set<string>()

    const rank = (game: StoreGame): number =>
      (game.coverUrl ? 0 : 10) +
      (game.metadataStatus === 'ready' ? 0 : game.metadataStatus === 'pending' ? 2 : 1)
    const best = (candidates: StoreGame[]): StoreGame | undefined =>
      candidates.length === 0
        ? undefined
        : [...candidates].sort((first, second) => rank(first) - rank(second))[0]

    const candidateFor = (entry: PopularEntry): StoreGame | null => {
      const normalizedName = entry.name ? normalizeTitle(entry.name) : ''
      const appCandidates = entry.appId ? (byAppId.get(entry.appId) ?? []) : []
      const titleCandidates = normalizedName ? (byTitle.get(normalizedName) ?? []) : []

      if (normalizedName) {
        const exact =
          appCandidates.find(
            (game) =>
              normalizeTitle(game.title) === normalizedName ||
              normalizeTitle(parseCatalogTitleVersion(game.title).baseTitle) === normalizedName
          ) ?? best(titleCandidates)
        if (exact) return exact
      }
      return best(appCandidates) ?? best(titleCandidates) ?? null
    }

    for (const entry of entries) {
      if (selected.length >= limit) break
      const game = candidateFor(entry)
      if (!game) continue
      const groupKey = parseCatalogTitleVersion(game.title).baseKey
      if (usedGroups.has(groupKey)) continue
      usedGroups.add(groupKey)
      selected.push(game)
    }

    // Fresh catalogs have no Steam app IDs yet. Fill the shelf with likely
    // catalog candidates so the front page is still useful while enrichment runs.
    if (selected.length < limit) {
      const remaining = latest
        .filter((game) => !usedGroups.has(parseCatalogTitleVersion(game.title).baseKey))
        .sort((first, second) => {
          const firstReady = first.metadataStatus === 'ready' ? 1 : 0
          const secondReady = second.metadataStatus === 'ready' ? 1 : 0
          if (firstReady !== secondReady) return secondReady - firstReady
          const firstAdded = Date.parse(first.catalogAddedAt ?? '') || 0
          const secondAdded = Date.parse(second.catalogAddedAt ?? '') || 0
          return secondAdded - firstAdded
        })

      for (const game of remaining) {
        if (selected.length >= limit) break
        const groupKey = parseCatalogTitleVersion(game.title).baseKey
        if (usedGroups.has(groupKey)) continue
        usedGroups.add(groupKey)
        selected.push(game)
      }
    }

    return selected
  }

  private writeCache(cache: PopularCache): void {
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true })
      writeFileSync(this.cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
    } catch {
      // Popularity cache failures should not break the Store.
    }
  }
}
