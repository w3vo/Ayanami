import { createPlaceholderCover } from '../../shared/placeholderCover'
import type { GameSearchResult } from '../../shared/types'

interface DemoEntry {
  title: string
  releaseYear: number
  genres: string[]
}

const DEMO_CATALOG: DemoEntry[] = [
  { title: 'Elden Ring', releaseYear: 2022, genres: ['Action RPG', 'Open World'] },
  { title: 'Hades II', releaseYear: 2024, genres: ['Roguelike', 'Action'] },
  { title: 'Baldur’s Gate 3', releaseYear: 2023, genres: ['RPG', 'Turn-Based'] },
  { title: 'Cyberpunk 2077', releaseYear: 2020, genres: ['Action RPG', 'Open World'] },
  { title: 'Hollow Knight: Silksong', releaseYear: 2025, genres: ['Metroidvania', 'Action'] },
  { title: 'Red Dead Redemption 2', releaseYear: 2018, genres: ['Action Adventure', 'Open World'] },
  { title: 'Stardew Valley', releaseYear: 2016, genres: ['Farming Sim', 'Indie'] },
  { title: 'The Witcher 3: Wild Hunt', releaseYear: 2015, genres: ['RPG', 'Fantasy'] },
  { title: 'Disco Elysium', releaseYear: 2019, genres: ['RPG', 'Narrative'] },
  { title: 'Sekiro: Shadows Die Twice', releaseYear: 2019, genres: ['Action', 'Soulslike'] }
]

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function searchMockCatalog(query: string): GameSearchResult[] {
  const normalizedQuery = normalize(query)
  const tokens = normalizedQuery.split(' ').filter(Boolean)

  let matches = DEMO_CATALOG.filter((entry) => {
    const title = normalize(entry.title)
    return tokens.every((token) => title.includes(token))
  })

  if (matches.length === 0) {
    const typedTitle = query.trim()
    return [
      {
        key: `demo-custom-${normalize(typedTitle)}`,
        title: typedTitle,
        igdbId: null,
        steamgriddbId: null,
        coverUrl: createPlaceholderCover(typedTitle, 'CUSTOM ENTRY · NO METADATA'),
        heroUrl: null,
        releaseYear: null,
        genres: ['Manual entry'],
        sources: ['demo']
      }
    ]
  }

  const queryTitle = normalizedQuery
  matches = [...matches].sort((first, second) => {
    const firstStarts = normalize(first.title).startsWith(queryTitle) ? 0 : 1
    const secondStarts = normalize(second.title).startsWith(queryTitle) ? 0 : 1
    return firstStarts - secondStarts
  })

  return matches.slice(0, 8).map((entry) => ({
    key: `demo-${normalize(entry.title).replace(/ /g, '-')}`,
    title: entry.title,
    igdbId: null,
    steamgriddbId: null,
    coverUrl: createPlaceholderCover(entry.title, 'DEMO METADATA · AYANAMI'),
    heroUrl: null,
    releaseYear: entry.releaseYear,
    genres: entry.genres,
    sources: ['demo']
  }))
}
