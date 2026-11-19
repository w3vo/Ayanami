import type { GameSearchResult } from '../../shared/types'

const API_BASE = 'https://www.steamgriddb.com/api/v2'
const REQUEST_TIMEOUT_MS = 12_000

interface SgdbSearchItem {
  id: number
  name: string
  release_date?: number
}

interface SgdbGrid {
  id: number
  url: string
  width: number
  height: number
  style?: string
  nsfw?: boolean
  epilepsy?: boolean
}

interface SgdbResponse<T> {
  success: boolean
  data?: T
  errors?: unknown[]
}

const coverCache = new Map<number, string | null>()

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json'
  }
}

async function sgdbGet<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(`SteamGridDB request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as SgdbResponse<T>
  if (!payload.success || payload.data === undefined) {
    throw new Error('SteamGridDB returned an unsuccessful response')
  }

  return payload.data
}

async function getCoverForGame(id: number, apiKey: string): Promise<string | null> {
  if (coverCache.has(id)) return coverCache.get(id) ?? null
  if (coverCache.size > 200) coverCache.clear()

  try {
    const grids = await sgdbGet<SgdbGrid[]>(`/grids/game/${id}`, apiKey)
    const usable = grids
      .filter(
        (grid) =>
          Boolean(grid.url) &&
          !grid.nsfw &&
          !grid.epilepsy &&
          grid.height >= grid.width &&
          grid.width >= 300
      )
      .sort((first, second) => second.width * second.height - first.width * first.height)

    const coverUrl = usable[0]?.url ?? null
    coverCache.set(id, coverUrl)
    return coverUrl
  } catch {
    // A missing cover should never prevent the game from being selectable.
    coverCache.set(id, null)
    return null
  }
}

export async function searchSteamGridDB(
  query: string,
  apiKey: string
): Promise<GameSearchResult[]> {
  const games = await sgdbGet<SgdbSearchItem[]>(
    `/search/autocomplete/${encodeURIComponent(query)}`,
    apiKey
  )

  const selectedGames = games.slice(0, 8)
  const covers = await Promise.all(
    selectedGames.map((game) => getCoverForGame(game.id, apiKey))
  )

  return selectedGames.map((game, index) => ({
    key: `sgdb-${game.id}`,
    title: game.name,
    igdbId: null,
    steamgriddbId: game.id,
    coverUrl: covers[index] ?? null,
    heroUrl: null,
    releaseYear: game.release_date
      ? new Date(game.release_date * 1000).getUTCFullYear()
      : null,
    genres: [],
    sources: ['steamgriddb']
  }))
}
