const DIRECT_FILE_PATTERN = /\.(?:rar|zip|7z|exe|iso|tar|gz|bz2|xz|bin|dmg|torrent)(?:[?#]|$)/i

/**
 * Hosts whose public file page is a normal page the user has to drive: a
 * countdown, a CAPTCHA, or a free-account login. These are deliberately not
 * automated.
 */
const MANUAL_HOSTS = new Set([
  '1fichier.com',
  'gofile.io',
  'megadb.net',
  'vikingfile.com',
  'vik1ngfile.site',
  'vik1ngfile.com',
  'datanodes.to'
])

/** Hosts verified to hand a real file to a plain HTTP client. */
const AUTOMATIC_HOSTS = new Set(['bzzhr.to', 'buzzheavier.com'])

function httpHost(uri: string): string | null {
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** True when the URI points straight at a file (or magnet), not a landing page. */
export function isDirectDownloadUri(uri: string): boolean {
  if (/^magnet:/i.test(uri)) return true

  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return DIRECT_FILE_PATTERN.test(parsed.pathname)
  } catch {
    return false
  }
}

/** True when the URI should be handed to the torrent engine. */
export function isTorrentUri(uri: string): boolean {
  return /^magnet:/i.test(uri) || /\.torrent(?:[?#]|$)/i.test(uri)
}

/**
 * Matches the apex host only, so a signed CDN subdomain (for example
 * `store-eu-par-2.gofile.io`) is not mistaken for the file page itself.
 */
export function isManualDownloadUri(uri: string): boolean {
  const host = httpHost(uri)
  return host !== null && MANUAL_HOSTS.has(host)
}

/** True for a provider Ayanami can transfer without showing a page. */
export function isAutomaticDownloadUri(uri: string): boolean {
  if (/^magnet:/i.test(uri)) return true
  const host = httpHost(uri)
  return host !== null && AUTOMATIC_HOSTS.has(host)
}

/**
 * Lower is preferred. Unknown hosts sort last on purpose: a stale or dead
 * mirror must never outrank a working manual page that the user can drive.
 */
export function downloadSourceRank(uri: string): number {
  if (isDirectDownloadUri(uri)) return 0
  if (isAutomaticDownloadUri(uri)) return 10
  if (isManualDownloadUri(uri)) return 20
  return 30
}

/**
 * Puts the simplest sources to automate first while keeping the catalog order
 * inside each capability tier. Duplicate URIs are removed.
 */
export function orderDownloadUris(
  primary: string | null | undefined,
  mirrors: readonly string[] = []
): string[] {
  const seen = new Set<string>()
  const ordered: { uri: string; index: number }[] = []

  for (const candidate of [primary, ...mirrors]) {
    if (typeof candidate !== 'string') continue
    const uri = candidate.trim()
    if (!uri || seen.has(uri)) continue
    seen.add(uri)
    ordered.push({ uri, index: ordered.length })
  }

  ordered.sort(
    (first, second) =>
      downloadSourceRank(first.uri) - downloadSourceRank(second.uri) ||
      first.index - second.index
  )
  return ordered.map((entry) => entry.uri)
}
