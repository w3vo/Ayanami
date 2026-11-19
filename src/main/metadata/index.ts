import { hasEnv } from '../env'
import type {
  GameSearchResult,
  MetadataSource,
  ProviderStatus,
  SearchResponse
} from '../../shared/types'
import { searchIgdb } from './igdb'
import { searchMockCatalog } from './mockCatalog'
import { searchSteamGridDB } from './steamgriddb'

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function mergeSources(
  first: MetadataSource[],
  second: MetadataSource[]
): MetadataSource[] {
  const sourceOrder: MetadataSource[] = ['steamgriddb', 'igdb', 'demo']
  const merged = new Set([...first, ...second])
  return sourceOrder.filter((source) => merged.has(source))
}

function mergeResults(
  first: GameSearchResult[],
  second: GameSearchResult[],
  query: string
): GameSearchResult[] {
  const merged = new Map<string, GameSearchResult>()

  for (const result of [...first, ...second]) {
    const key = normalizeTitle(result.title)
    const existing = merged.get(key)

    if (!existing) {
      merged.set(key, { ...result, sources: [...result.sources] })
      continue
    }

    existing.igdbId ??= result.igdbId
    existing.steamgriddbId ??= result.steamgriddbId
    existing.coverUrl ??= result.coverUrl
    existing.heroUrl ??= result.heroUrl
    existing.releaseYear ??= result.releaseYear
    if (existing.genres.length === 0) existing.genres = [...result.genres]
    existing.sources = mergeSources(existing.sources, result.sources)
  }

  const normalizedQuery = normalizeTitle(query)
  return [...merged.entries()]
    .map(([normalized, result], order) => {
      let score = 3
      if (normalized === normalizedQuery) score = 0
      else if (normalized.startsWith(normalizedQuery)) score = 1
      else if (normalized.includes(normalizedQuery)) score = 2
      return { result, score, order }
    })
    .sort((first, second) => first.score - second.score || first.order - second.order)
    .slice(0, 12)
    .map(({ result }, index) => ({
      ...result,
      key: `meta-${index}-${result.igdbId ?? result.steamgriddbId ?? normalizeTitle(result.title)}`
    }))
}

function emptySearchResponse(query: string): SearchResponse {
  return {
    query,
    results: [],
    demoMode: false,
    providers: {
      steamgriddb: hasEnv('STEAMGRIDDB_API_KEY') ? 'live' : 'unconfigured',
      igdb: hasEnv('IGDB_CLIENT_ID', 'IGDB_CLIENT_SECRET') ? 'live' : 'unconfigured'
    }
  }
}

export async function searchGames(rawQuery: string): Promise<SearchResponse> {
  const query = rawQuery.trim()
  if (!query) return emptySearchResponse(query)

  const steamgriddbKey = process.env.STEAMGRIDDB_API_KEY?.trim() ?? ''
  const igdbClientId = process.env.IGDB_CLIENT_ID?.trim() ?? ''
  const igdbClientSecret = process.env.IGDB_CLIENT_SECRET?.trim() ?? ''
  const igdbConfigured = Boolean(igdbClientId && igdbClientSecret)

  const steamgriddbRequest = steamgriddbKey
    ? searchSteamGridDB(query, steamgriddbKey)
    : null
  const igdbRequest = igdbConfigured
    ? searchIgdb(query, igdbClientId, igdbClientSecret)
    : null

  const [steamgriddbOutcome, igdbOutcome] = await Promise.allSettled([
    steamgriddbRequest,
    igdbRequest
  ])

  const providerStates: SearchResponse['providers'] = {
    steamgriddb: steamgriddbRequest
      ? steamgriddbOutcome.status === 'fulfilled'
        ? 'live'
        : 'error'
      : 'unconfigured',
    igdb: igdbRequest
      ? igdbOutcome.status === 'fulfilled'
        ? 'live'
        : 'error'
      : 'unconfigured'
  }

  const failedProviders: string[] = []
  if (steamgriddbOutcome.status === 'rejected') {
    failedProviders.push('SteamGridDB')
    console.warn('[metadata] SteamGridDB search failed:', steamgriddbOutcome.reason)
  }
  if (igdbOutcome.status === 'rejected') {
    failedProviders.push('IGDB')
    console.warn('[metadata] IGDB search failed:', igdbOutcome.reason)
  }

  const steamgriddbResults =
    steamgriddbOutcome.status === 'fulfilled' && steamgriddbOutcome.value
      ? steamgriddbOutcome.value
      : []
  const igdbResults =
    igdbOutcome.status === 'fulfilled' && igdbOutcome.value ? igdbOutcome.value : []
  const liveResults = mergeResults(steamgriddbResults, igdbResults, query)

  if (liveResults.length > 0) {
    return {
      query,
      results: liveResults,
      demoMode: false,
      providers: providerStates,
      notice:
        failedProviders.length > 0
          ? `${failedProviders.join(' and ')} could not be reached. Showing results from the other provider.`
          : undefined
    }
  }

  let notice: string
  if (!steamgriddbRequest && !igdbRequest) {
    notice =
      'No metadata API keys are configured. Showing built-in demo results — add keys to .env for live covers and metadata.'
  } else if (failedProviders.length > 0) {
    notice = `Live metadata is unavailable right now (${failedProviders.join(', ')}). Showing demo results instead.`
  } else {
    notice =
      'No live matches were found for that title. Showing a local placeholder entry you can still add.'
  }

  return {
    query,
    results: searchMockCatalog(query),
    demoMode: true,
    providers: providerStates,
    notice
  }
}

export function getProviderStatus(): ProviderStatus {
  return {
    steamgriddb: hasEnv('STEAMGRIDDB_API_KEY'),
    igdb: hasEnv('IGDB_CLIENT_ID', 'IGDB_CLIENT_SECRET'),
    googleDrive: hasEnv('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')
  }
}

export type { MetadataSource }
