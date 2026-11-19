import { cleanCatalogTitle } from './steam'

const ONLINE_FIX_ORIGIN = 'https://online-fix.me'
const SEARCH_URL = `${ONLINE_FIX_ORIGIN}/index.php?do=search&subaction=search&story=`
const REQUEST_TIMEOUT_MS = 15_000
const REQUEST_SPACING_MS = 2_800
const MAX_RESULTS = 12

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

const ALLOWED_EXTRA_TOKENS = new Set([
  'all',
  'and',
  'bundle',
  'collection',
  'complete',
  'cut',
  'definitive',
  'deluxe',
  'directors',
  'dlc',
  'dlcs',
  'edition',
  'enhanced',
  'expanded',
  'final',
  'game',
  'gold',
  'goty',
  'of',
  'plus',
  'remake',
  'remastered',
  'the',
  'ultimate',
  'year'
])

export interface OnlineFixMatch {
  title: string
  url: string
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const highPriorityQueue: Array<() => Promise<void>> = []
const queue: Array<() => Promise<void>> = []
let pumping = false
let nextRequestAt = 0

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (highPriorityQueue.length > 0 || queue.length > 0) {
      const task = highPriorityQueue.shift() ?? queue.shift()
      if (!task) continue
      const wait = nextRequestAt - Date.now()
      if (wait > 0) await delay(wait)
      nextRequestAt = Date.now() + REQUEST_SPACING_MS
      await task()
    }
  } finally {
    pumping = false
  }
}

/**
 * Serializes searches so online-fix never sees bursts from Ayanami. Manual
 * refreshes jump ahead of the background "check all" queue but still respect
 * the same request spacing.
 */
function scheduleSearch<T>(task: () => Promise<T>, priority = false): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = async (): Promise<void> => {
      try {
        resolve(await task())
      } catch (error) {
        reject(error)
      }
    }
    if (priority) highPriorityQueue.push(run)
    else queue.push(run)
    void pump()
  })
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
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Folds a release title to a token sequence. "по сети" is the Russian phrase
 * online-fix appends to every result, and bracketed metadata is not part of the
 * game name.
 */
function normalizeTitle(value: string): string {
  const tokens = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/по\s+сети/g, ' ')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(
      /\b(?:free|download|downloads|pc|game|games|repack|preinstalled|pre-installed|installed|online|fix|multiplayer|co-?op|steam|version|update|updated)\b/g,
      ' '
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((token) => ROMAN_TOKENS[token] ?? token)

  if (tokens[0] === 'the') tokens.shift()
  return tokens.join(' ')
}

/**
 * Strictly accepts a result that starts with the requested title. Missing
 * tokens (Helldivers vs. Helldivers 2), different numbers (Resident Evil 5 vs.
 * Resident Evil 6), and unrelated subtitles are rejected.
 */
export function matchesOnlineFixTitle(query: string, candidate: string): boolean {
  const normalizedQuery = normalizeTitle(query)
  const normalizedCandidate = normalizeTitle(candidate)
  if (!normalizedQuery || !normalizedCandidate) return false
  if (normalizedCandidate === normalizedQuery) return true

  const queryTokens = normalizedQuery.split(' ')
  const candidateTokens = normalizedCandidate.split(' ')
  if (candidateTokens.length <= queryTokens.length) return false

  for (let index = 0; index < queryTokens.length; index += 1) {
    if (candidateTokens[index] !== queryTokens[index]) return false
  }

  const extraTokens = candidateTokens.slice(queryTokens.length)
  return extraTokens.every(
    (token) => !/^\d+$/.test(token) && ALLOWED_EXTRA_TOKENS.has(token)
  )
}

function parseSearchResults(html: string): Array<{ title: string; url: string }> {
  const start = html.indexOf('news news-search')
  if (start < 0) return []

  const aside = html.indexOf('<aside', start)
  const section = aside > start ? html.slice(start, aside) : html.slice(start)
  const results: Array<{ title: string; url: string }> = []
  const seen = new Set<string>()

  const pattern =
    /<a\s+[^>]*href="([^"]+)"[^>]*>\s*<h2[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h2>\s*<\/a>/gi
  for (const match of section.matchAll(pattern)) {
    if (results.length >= MAX_RESULTS) break
    const title = stripTags(match[2])
    if (!title) continue

    let url: string
    try {
      const parsed = new URL(decodeEntities(match[1]), ONLINE_FIX_ORIGIN)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue
      if (!/(?:^|\.)online-fix\.me$/i.test(parsed.hostname)) continue
      parsed.protocol = 'https:'
      url = parsed.toString()
    } catch {
      continue
    }

    const key = url.split('#')[0]
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ title, url: key })
  }

  return results
}

async function fetchSearchPage(title: string): Promise<string> {
  const response = await fetch(`${SEARCH_URL}${encodeURIComponent(title)}`, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `${ONLINE_FIX_ORIGIN}/`
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(`online-fix.me request failed with status ${response.status}`)
  }

  const buffer = await response.arrayBuffer()
  return new TextDecoder('windows-1251').decode(buffer)
}

async function runSearch(title: string): Promise<OnlineFixMatch | null> {
  const term = cleanCatalogTitle(title) || title.trim()
  if (!term) return null

  const html = await fetchSearchPage(term)
  for (const result of parseSearchResults(html)) {
    if (matchesOnlineFixTitle(term, result.title)) {
      return { title: result.title, url: result.url }
    }
  }
  return null
}

/**
 * Looks a title up on online-fix.me. Returns null when the site has no strict
 * match; network and parsing failures throw so callers never downgrade a game
 * to Offline Only because of a transient error.
 */
export function searchOnlineFix(
  title: string,
  priority = false
): Promise<OnlineFixMatch | null> {
  return scheduleSearch(async () => {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await runSearch(title)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('online-fix.me search failed')
        const retryable =
          /timeout|fetch failed|status 429|status 5\d\d/i.test(lastError.message)
        if (!retryable || attempt > 0) break
        await delay(2_000)
      }
    }

    throw lastError ?? new Error('online-fix.me search failed')
  }, priority)
}
