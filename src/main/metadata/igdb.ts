import type { GameSearchResult } from '../../shared/types'

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const IGDB_API_URL = 'https://api.igdb.com/v4/games'
const REQUEST_TIMEOUT_MS = 12_000

interface IgdbImage {
  id?: number
  image_id?: string
  url?: string
}

interface IgdbGame {
  id: number
  name: string
  cover?: IgdbImage
  artworks?: IgdbImage[]
  first_release_date?: number
  genres?: Array<{ id: number; name: string }>
}

interface TokenState {
  credentials: string
  accessToken: string
  expiresAt: number
}

let tokenState: TokenState | null = null
let tokenPromise: Promise<TokenState> | null = null

function credentialsKey(clientId: string, clientSecret: string): string {
  return `${clientId}:${clientSecret}`
}

async function requestToken(clientId: string, clientSecret: string): Promise<TokenState> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials'
  })

  const response = await fetch(`${TWITCH_TOKEN_URL}?${params.toString()}`, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(`IGDB authentication failed with status ${response.status}`)
  }

  const payload = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }

  if (!payload.access_token || !payload.expires_in) {
    throw new Error('IGDB authentication returned an invalid token')
  }

  return {
    credentials: credentialsKey(clientId, clientSecret),
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in - 60) * 1000
  }
}

async function getToken(clientId: string, clientSecret: string): Promise<TokenState> {
  const credentials = credentialsKey(clientId, clientSecret)
  if (tokenState?.credentials === credentials && tokenState.expiresAt > Date.now()) {
    return tokenState
  }

  if (!tokenPromise) {
    tokenPromise = requestToken(clientId, clientSecret)
      .then((state) => {
        tokenState = state
        return state
      })
      .finally(() => {
        tokenPromise = null
      })
  }

  return tokenPromise
}

function igdbImageUrl(image: IgdbImage | undefined, size: string): string | null {
  if (!image) return null
  if (image.image_id) {
    return `https://images.igdb.com/igdb/image/upload/${size}/${image.image_id}.jpg`
  }
  if (image.url) {
    return image.url.startsWith('//') ? `https:${image.url}` : image.url
  }
  return null
}

function sanitizeQuery(query: string): string {
  return query.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function requestGames(
  query: string,
  clientId: string,
  token: string
): Promise<IgdbGame[]> {
  const body = [
    `search "${sanitizeQuery(query)}";`,
    'fields name,cover.image_id,cover.url,artworks.image_id,artworks.url,first_release_date,genres.name;',
    'limit 10;'
  ].join(' ')

  const response = await fetch(IGDB_API_URL, {
    method: 'POST',
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
      Accept: 'application/json'
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (response.status === 401) {
    tokenState = null
    throw new Error('IGDB rejected the access token')
  }

  if (!response.ok) {
    throw new Error(`IGDB request failed with status ${response.status}`)
  }

  return (await response.json()) as IgdbGame[]
}

export async function searchIgdb(
  query: string,
  clientId: string,
  clientSecret: string
): Promise<GameSearchResult[]> {
  let gameData: IgdbGame[]

  try {
    const token = await getToken(clientId, clientSecret)
    gameData = await requestGames(query, clientId, token.accessToken)
  } catch (error) {
    if (error instanceof Error && error.message.includes('rejected the access token')) {
      const token = await getToken(clientId, clientSecret)
      gameData = await requestGames(query, clientId, token.accessToken)
    } else {
      throw error
    }
  }

  return gameData.slice(0, 10).map((game) => ({
    key: `igdb-${game.id}`,
    title: game.name,
    igdbId: game.id,
    steamgriddbId: null,
    coverUrl: igdbImageUrl(game.cover, 't_cover_big'),
    heroUrl: igdbImageUrl(game.artworks?.[0], 't_1080p'),
    releaseYear: game.first_release_date
      ? new Date(game.first_release_date * 1000).getUTCFullYear()
      : null,
    genres: (game.genres ?? []).map((genre) => genre.name).slice(0, 3),
    sources: ['igdb']
  }))
}
