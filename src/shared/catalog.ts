import type { OnlineStatus, StoreGame } from './types'

export interface OnlineStatusPresentation {
  label: string
  shortLabel: string
  color: string
  description: string
}

export const ONLINE_STATUS_META: Record<OnlineStatus, OnlineStatusPresentation> = {
  offline: {
    label: 'No online fix',
    shortLabel: 'No fix',
    color: '#64748b',
    description:
      'No online-fix.me listing and no co-op, multiplayer, or online keyword in the title.'
  },
  'online-fix': {
    label: 'Online-Fix Available',
    shortLabel: 'Online-fix',
    color: '#22c55e',
    description:
      'Ayanami found this title on online-fix.me, so online play is available with its online fix.'
  }
}

export const ONLINE_KEYWORD_META: OnlineStatusPresentation = {
  label: 'Online Play',
  shortLabel: 'Online',
  color: '#38bdf8',
  description:
    'This title mentions co-op, multiplayer, or online play in its title, so Ayanami lists it as online-capable even without an online-fix.me match.'
}

export const ONLINE_AVAILABLE_META: OnlineStatusPresentation = {
  label: 'Online available',
  shortLabel: 'Online',
  color: '#22c55e',
  description:
    'Titles with an online-fix.me match or co-op, multiplayer, or online keywords in their title.'
}

export const ONLINE_UNCHECKED_META: OnlineStatusPresentation = {
  label: 'Not checked',
  shortLabel: 'Not checked',
  color: '#879cb5',
  description:
    'Ayanami checks online-fix.me only when you open a title. This one has not been checked yet.'
}

export const ONLINE_CHECKING_META: OnlineStatusPresentation = {
  label: 'Checking online-fix…',
  shortLabel: 'Checking',
  color: '#879cb5',
  description: 'Ayanami is checking online-fix.me for this title now.'
}

const ONLINE_KEYWORD_PATTERN = /\b(?:co[- ]?op|multiplayer|online)\b/i

/** Online keyword detection is intentionally limited to the game title. */
export function hasOnlineKeywords(game: Pick<StoreGame, 'title'>): boolean {
  return ONLINE_KEYWORD_PATTERN.test(game.title)
}

export function isOnlineAvailable(
  game: Pick<StoreGame, 'onlineStatus' | 'onlineByKeyword'>
): boolean {
  return game.onlineByKeyword || game.onlineStatus === 'online-fix'
}

export function isOnlinePending(
  game: Pick<StoreGame, 'onlineCheckedAt' | 'onlineByKeyword'>
): boolean {
  return !game.onlineByKeyword && game.onlineCheckedAt === null
}

export function onlineStatusMeta(
  game: Pick<StoreGame, 'onlineStatus' | 'onlineCheckedAt' | 'onlineByKeyword'>,
  checking = false
): OnlineStatusPresentation {
  if (game.onlineStatus === 'online-fix') return ONLINE_STATUS_META['online-fix']
  if (game.onlineByKeyword) return ONLINE_KEYWORD_META
  if (checking) return ONLINE_CHECKING_META
  if (game.onlineCheckedAt === null) return ONLINE_UNCHECKED_META
  return ONLINE_STATUS_META.offline
}

export function isOnlineStatus(value: unknown): value is OnlineStatus {
  return value === 'offline' || value === 'online-fix'
}

/* Version grouping */

type VersionScheme = 'version' | 'build' | 'update' | 'patch'

export interface CatalogTitleVersion {
  /** Title with version, build, update, and release-marker suffixes removed. */
  baseTitle: string
  /** Case/punctuation-folded base title used to group catalog entries. */
  baseKey: string
  /** Display label such as "v1.17.2" or "Build 12464502". */
  versionLabel: string | null
  versionScheme: VersionScheme | null
  versionParts: number[]
  versionSuffix: string
}

const VERSION_TOKEN_SOURCE =
  String.raw`\b(?:(v|ver|version)\s*\.?\s*(\d[\w.:#-]*)|(build|update|patch)\s*#?\s*(\d[\w.:#-]*))`

const VERSION_TOKEN = new RegExp(VERSION_TOKEN_SOURCE, 'i')
const VERSION_TOKEN_GLOBAL = new RegExp(VERSION_TOKEN_SOURCE, 'gi')
const RELEASE_MARKER =
  /\b(?:online|lan|co-?op|multiplayer|repack|portable|fitgirl|dodi|all\s+dlcs?|emu(?:lator)?s?|yuzu|ryujinx|switch\s+emus?)\b/i
const RELEASE_MARKER_GLOBAL = new RegExp(RELEASE_MARKER.source, 'gi')
const FREE_DOWNLOAD = /\bfree\s+down(?:l)?oad\b/gi
const TRAILING_RELEASE =
  /\s*(?:[+&]\s*(?:co-?op|multiplayer|online|lan|vr\s+option|all\s+dlcs?))\s*$/i

function cleanVersionGroup(inner: string): string {
  const hadVersion = VERSION_TOKEN.test(inner)
  let cleaned = inner.replace(VERSION_TOKEN_GLOBAL, ' ')
  if (hadVersion) cleaned = cleaned.replace(/\b\d{2,}\b/g, ' ')
  cleaned = cleaned.replace(RELEASE_MARKER_GLOBAL, ' ')
  cleaned = cleaned.replace(/[+&]/g, ' ')
  return cleaned
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:/-]+|[\s,;:/-]+$/g, '')
    .trim()
}

function stripVersionGroups(
  value: string,
  pattern: RegExp,
  open: string,
  close: string
): string {
  return value.replace(pattern, (match, inner: string) => {
    const hasMarker =
      VERSION_TOKEN.test(inner) ||
      RELEASE_MARKER.test(inner) ||
      /\bfree\s+down(?:l)?oad\b/i.test(inner)
    if (!hasMarker) return match

    const cleaned = cleanVersionGroup(inner)
    return cleaned ? `${open}${cleaned}${close}` : ' '
  })
}

function stripCatalogTitle(title: string): string {
  let value = title.replace(FREE_DOWNLOAD, ' ')
  value = stripVersionGroups(value, /\(([^()]*)\)/g, '(', ')')
  value = stripVersionGroups(value, /\[([^\]]*)\]/g, '[', ']')
  value = value.replace(VERSION_TOKEN_GLOBAL, ' ')

  let previous = ''
  while (previous !== value) {
    previous = value
    value = value.replace(TRAILING_RELEASE, ' ')
  }
  value = value.replace(/\s*[+&]\s*$/g, ' ')

  return value
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;:])\s*$/g, '')
    .replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, '')
    .trim()
}

function normalizeVersionBase(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function parseVersionMatch(match: RegExpExecArray): {
  versionLabel: string
  versionScheme: VersionScheme
  versionParts: number[]
  versionSuffix: string
} {
  const scheme = (match[3]?.toLowerCase() ?? 'version') as VersionScheme
  const raw = (match[3] ? match[4] : match[2] ?? '').replace(/[.:#_-]+$/g, '')
  const label =
    scheme === 'version'
      ? `v${raw}`
      : `${scheme.charAt(0).toUpperCase()}${scheme.slice(1)} ${raw}`

  return {
    versionLabel: label,
    versionScheme: scheme,
    versionParts: (raw.match(/\d+/g) ?? []).map(Number),
    versionSuffix: raw.replace(/[^a-z]+/gi, '').toLowerCase()
  }
}

/**
 * Splits a catalog title into the release base and its version marker. Common
 * Hydra/SteamRip suffixes such as "+ Co-op" or "Build 123" are ignored so only
 * the newest entry for a title remains in Store results.
 */
export function parseCatalogTitleVersion(title: string): CatalogTitleVersion {
  const match = VERSION_TOKEN.exec(title)
  const version = match ? parseVersionMatch(match) : null
  const baseTitle = stripCatalogTitle(title) || title.trim()

  return {
    baseTitle,
    baseKey: normalizeVersionBase(baseTitle),
    versionLabel: version?.versionLabel ?? null,
    versionScheme: version?.versionScheme ?? null,
    versionParts: version?.versionParts ?? [],
    versionSuffix: version?.versionSuffix ?? ''
  }
}

function compareVersionNumbers(
  first: CatalogTitleVersion,
  second: CatalogTitleVersion
): number {
  if (
    !first.versionScheme ||
    !second.versionScheme ||
    first.versionScheme !== second.versionScheme
  ) {
    return 0
  }

  const length = Math.max(first.versionParts.length, second.versionParts.length)
  for (let index = 0; index < length; index += 1) {
    const firstPart = first.versionParts[index] ?? 0
    const secondPart = second.versionParts[index] ?? 0
    if (firstPart !== secondPart) return firstPart - secondPart
  }

  return first.versionSuffix.localeCompare(second.versionSuffix)
}

function compareCatalogRecency(first: StoreGame, second: StoreGame): number {
  const firstAdded = Date.parse(first.catalogAddedAt ?? '') || 0
  const secondAdded = Date.parse(second.catalogAddedAt ?? '') || 0
  if (firstAdded !== secondAdded) return firstAdded - secondAdded
  return first.id - second.id
}

function compareVersionedGames(
  first: StoreGame,
  firstVersion: CatalogTitleVersion,
  second: StoreGame,
  secondVersion: CatalogTitleVersion
): number {
  const versionOrder = compareVersionNumbers(firstVersion, secondVersion)
  if (versionOrder !== 0) return versionOrder
  return compareCatalogRecency(first, second)
}

/** Returns only the newest catalog entry for every versioned title group. */
export function selectLatestCatalogGames(games: StoreGame[]): StoreGame[] {
  if (games.length < 2) return games

  const parsed = games.map((game) => ({
    game,
    version: parseCatalogTitleVersion(game.title)
  }))
  const groups = new Map<string, typeof parsed>()
  for (const entry of parsed) {
    const group = groups.get(entry.version.baseKey)
    if (group) group.push(entry)
    else groups.set(entry.version.baseKey, [entry])
  }

  if (groups.size === games.length) return games

  const latestIds = new Set<number>()
  for (const group of groups.values()) {
    let latest = group[0]
    for (let index = 1; index < group.length; index += 1) {
      const candidate = group[index]
      if (
        compareVersionedGames(
          candidate.game,
          candidate.version,
          latest.game,
          latest.version
        ) > 0
      ) {
        latest = candidate
      }
    }
    latestIds.add(latest.game.id)
  }

  return games.filter((game) => latestIds.has(game.id))
}

/** Earlier releases in the same version group, newest first. */
export function olderCatalogVersions(game: StoreGame, games: StoreGame[]): StoreGame[] {
  const currentVersion = parseCatalogTitleVersion(game.title)
  const older: Array<{ game: StoreGame; version: CatalogTitleVersion }> = []

  for (const candidate of games) {
    if (candidate.id === game.id) continue
    const candidateVersion = parseCatalogTitleVersion(candidate.title)
    if (candidateVersion.baseKey !== currentVersion.baseKey) continue
    if (
      compareVersionedGames(candidate, candidateVersion, game, currentVersion) < 0
    ) {
      older.push({ game: candidate, version: candidateVersion })
    }
  }

  return older
    .sort((first, second) =>
      compareVersionedGames(
        second.game,
        second.version,
        first.game,
        first.version
      )
    )
    .map((entry) => entry.game)
}
