import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import {
  ONLINE_AVAILABLE_META,
  ONLINE_STATUS_META,
  ONLINE_UNCHECKED_META,
  isOnlineAvailable,
  isOnlinePending,
  olderCatalogVersions,
  selectLatestCatalogGames
} from '@shared/catalog'
import { evaluateRequirements } from '@shared/specs'
import type {
  CatalogSnapshot,
  CompatibilityResult,
  CompatibilityTier,
  ImportCatalogResult,
  PopularGamesResult,
  StoreGame
} from '@shared/types'
import { getErrorMessage } from '../lib/errors'
import { formatCount } from '../lib/format'
import { PageHeader } from './PageHeader'
import { COMPATIBILITY_META } from './StoreBadges'
import { StoreGameCard } from './StoreGameCard'
import { StoreGameDetail } from './StoreGameDetail'
import type { ToastTone } from './Toast'
import {
  AlertCircleIcon,
  CheckIcon,
  CloseIcon,
  CpuIcon,
  HardDriveIcon,
  MemoryIcon,
  MonitorIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SlidersIcon,
  StoreIcon
} from './Icons'
import { Spinner } from './Spinner'

interface StoreViewProps {
  catalogRevision: number
  onCatalogChanged: () => void
  onOpenSettings: () => void
  onScrollTop: () => void
  onToast: (message: string, tone?: ToastTone) => void
}

type OnlineFilter = 'all' | 'online' | 'offline' | 'unchecked'
type SpecFilter = 'all' | CompatibilityTier
type SortMode = 'title' | 'release' | 'added' | 'compatibility'
type CatalogAction = 'import' | 'sample' | null

const PAGE_SIZE = 60

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'title', label: 'Title A–Z' },
  { value: 'release', label: 'Newest release' },
  { value: 'added', label: 'Recently added' },
  { value: 'compatibility', label: 'Best for your PC' }
]

const TIER_RANK: Record<CompatibilityTier, number> = {
  recommended: 3,
  minimum: 2,
  below: 1,
  unknown: 0
}

const SPEC_FILTERS: CompatibilityTier[] = ['recommended', 'minimum', 'below', 'unknown']

/** Folds punctuation, accents, and spacing so “nier automata” finds “NieR:Automata”. */
function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function matchesToken(token: string, candidate: string): boolean {
  if (candidate === token) return true
  if (candidate.startsWith(token) && token.length >= 2) return true
  if (token.length >= 4 && candidate.includes(token)) return true
  return false
}

/**
 * Returns a relevance score (lower is better) when every query token matches,
 * or null when the game should be filtered out. Titles rank ahead of metadata.
 */
function searchScore(game: StoreGame, normalizedQuery: string, queryTokens: string[]): number | null {
  const normalizedTitle = normalizeSearch(game.title)
  const titleTokens = normalizedTitle.split(' ').filter(Boolean)

  const titleMatches = queryTokens.every((token) =>
    titleTokens.some((candidate) => matchesToken(token, candidate))
  )

  if (titleMatches) {
    let score: number
    if (normalizedTitle === normalizedQuery) score = 0
    else if (normalizedTitle.startsWith(normalizedQuery)) score = 1
    else if (normalizedTitle.includes(normalizedQuery)) score = 2
    else score = 4 + Math.max(0, titleTokens.length - queryTokens.length) * 0.2
    return score
  }

  const metadataTokens = normalizeSearch(
    [game.developer ?? '', game.publisher ?? '', game.genres.join(' '), game.synopsis].join(' ')
  )
    .split(' ')
    .filter(Boolean)
  const metadataMatches = queryTokens.every((token) =>
    metadataTokens.some((candidate) => matchesToken(token, candidate))
  )
  return metadataMatches ? 20 : null
}

function importSummary(result: ImportCatalogResult): string {  const count = formatCount(result.importedCount, 'title')
  const base = result.replaced
    ? `Refreshed “${result.source.name}” — ${count}.`
    : `Added “${result.source.name}” with ${count}.`
  if (result.warnings.length === 0) return base
  return `${base} ${formatCount(result.warnings.length, 'warning')} to review.`
}

function FilterChip({
  active,
  onClick,
  children,
  dotColor,
  title
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  dotColor?: string
  title?: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[9px] font-medium transition ${
        active
          ? 'border-ayanami-accent/40 bg-ayanami-accent/[0.1] text-ayanami-highlight'
          : 'border-white/[0.06] bg-white/[0.02] text-slate-500 hover:border-white/[0.11] hover:text-slate-300'
      }`}
    >
      {dotColor && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
      )}
      {children}
    </button>
  )
}

function ChipCount({ value, active }: { value: number; active: boolean }): JSX.Element {
  return (
    <span className={`tabular-nums ${active ? 'text-ayanami-highlight/70' : 'text-slate-600'}`}>
      {value}
    </span>
  )
}

function HardwareFact({
  icon,
  label,
  value
}: {
  icon: ReactNode
  label: string
  value: string
}): JSX.Element {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={`${label}: ${value}`}>
      <span className="shrink-0 text-slate-600">{icon}</span>
      <span className="text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-600">
        {label}
      </span>
      <span className="max-w-[170px] truncate text-[9.5px] text-slate-400">{value}</span>
    </span>
  )
}

function StoreSkeleton(): JSX.Element {
  return (
    <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-2xl border border-ayanami-line/80 bg-ayanami-card"
        >
          <div className="skeleton aspect-[2/3]" />
          <div className="space-y-2.5 p-3.5">
            <div className="skeleton h-3.5 w-4/5 rounded-full" />
            <div className="skeleton h-2.5 w-1/2 rounded-full" />
          </div>
          <div className="border-t border-white/[0.05] px-3.5 py-2.5">
            <div className="skeleton h-2.5 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyStore({
  hasSources,
  busy,
  onImport,
  onLoadSample,
  onOpenSettings
}: {
  hasSources: boolean
  busy: CatalogAction
  onImport: () => void
  onLoadSample: () => void
  onOpenSettings: () => void
}): JSX.Element {
  return (
    <section className="relative mt-9 overflow-hidden rounded-[26px] border border-dashed border-[#2b313c] bg-[#11141a]/55 px-6 py-14 text-center">
      <div className="pointer-events-none absolute left-1/2 top-4 h-64 w-96 -translate-x-1/2 rounded-full bg-ayanami-accent/[0.07] blur-3xl" />
      <div className="relative">
        <div className="relative mx-auto mb-7 flex h-24 w-44 items-end justify-center">
          <div className="absolute bottom-0 left-3 h-20 w-14 -rotate-[13deg] rounded-lg border border-white/[0.07] bg-gradient-to-b from-[#1a2029] to-[#0d1016] shadow-xl" />
          <div className="absolute bottom-0 right-3 h-20 w-14 rotate-[13deg] rounded-lg border border-white/[0.07] bg-gradient-to-b from-[#181d25] to-[#0c0f15] shadow-xl" />
          <div className="relative flex h-24 w-16 items-center justify-center rounded-xl border border-ayanami-accent/25 bg-gradient-to-br from-[#202832] via-[#171b22] to-[#0e1118] shadow-[0_20px_45px_-18px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.06)]">
            <StoreIcon className="h-6 w-6 text-ayanami-accent" />
          </div>
        </div>

        <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-white">
          {hasSources ? 'This catalog has no titles' : 'Your store shelves are empty'}
        </h2>
        <p className="mx-auto mt-2.5 max-w-md text-[12.5px] leading-6 text-slate-400">
          {hasSources
            ? 'The imported manifest is present, but it does not currently expose any games. Refresh the source or import a different manifest.'
            : 'Ayanami does not ship with a storefront. Import a local sources.json manifest — or start with the sample catalog — and the Store fills itself.'}
        </p>

        <div className="mt-7 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={onImport}
            disabled={busy !== null}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-[#a8c5e5] via-[#9db2ca] to-[#879cb5] px-4 text-[11.5px] font-semibold text-[#0b0e18] shadow-[0_12px_30px_-14px_rgba(135,156,181,0.65)] transition hover:brightness-105 active:scale-[0.985] disabled:cursor-wait disabled:opacity-70"
          >
            {busy === 'import' ? <Spinner className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
            {busy === 'import' ? 'Importing…' : 'Import manifest'}
          </button>
          <button
            type="button"
            onClick={onLoadSample}
            disabled={busy !== null}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-[11.5px] font-medium text-slate-300 transition hover:border-ayanami-accent/30 hover:bg-ayanami-accent/[0.06] hover:text-white disabled:cursor-wait disabled:opacity-60"
          >
            {busy === 'sample' ? <Spinner className="h-4 w-4" /> : <StoreIcon className="h-4 w-4" />}
            {busy === 'sample' ? 'Loading sample…' : 'Load sample catalog'}
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[9px] text-slate-600">
          <code className="rounded-md border border-white/[0.06] bg-[#0b0e13] px-2 py-1 font-mono text-[8.5px] text-slate-500">
            sources.json
          </code>
          <span>·</span>
          <span>Stored locally</span>
          <span>·</span>
          <span>No storefront account</span>
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-5 inline-flex items-center gap-1.5 text-[9.5px] font-medium text-slate-500 transition hover:text-ayanami-highlight"
        >
          <SlidersIcon className="h-3 w-3" />
          Manage catalog sources in Settings
        </button>
      </div>
    </section>
  )
}

export function StoreView({
  catalogRevision,
  onCatalogChanged,
  onOpenSettings,
  onScrollTop,
  onToast
}: StoreViewProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [catalogBusy, setCatalogBusy] = useState<CatalogAction>(null)
  const [hardwareBusy, setHardwareBusy] = useState(false)
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [onlineFilter, setOnlineFilter] = useState<OnlineFilter>('all')
  const [specFilter, setSpecFilter] = useState<SpecFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('title')
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE)
  const [popular, setPopular] = useState<PopularGamesResult | null>(null)
  const [popularLoading, setPopularLoading] = useState(true)
  const [popularFailed, setPopularFailed] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)

    window.ayanami
      .listCatalog()
      .then((catalog) => {
        if (!active) return
        setSnapshot(catalog)
      })
      .catch((error) => {
        if (!active) return
        setLoadError(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [catalogRevision, reloadToken])

  useEffect(() => {
    let active = true
    setPopularLoading(true)
    setPopularFailed(false)

    window.ayanami
      .getPopularGames()
      .then((result) => {
        if (!active) return
        setPopular(result)
      })
      .catch(() => {
        if (!active) return
        setPopular(null)
        setPopularFailed(true)
      })
      .finally(() => {
        if (active) setPopularLoading(false)
      })

    return () => {
      active = false
    }
  }, [catalogRevision, reloadToken])

  const games = snapshot?.games ?? []
  const sources = snapshot?.sources ?? []
  const latestGames = useMemo(() => selectLatestCatalogGames(games), [games])
  const collapsedVersionCount = games.length - latestGames.length

  const popularGames = useMemo(() => {
    const byId = new Map(games.map((game) => [game.id, game]))
    const resolved = (popular?.games ?? [])
      .map((game) => byId.get(game.id))
      .filter((game): game is StoreGame => Boolean(game))
    if (resolved.length > 0) return resolved.slice(0, 20)
    return latestGames.slice(0, 20)
  }, [games, popular, latestGames])

  useEffect(() => {
    onScrollTop()
  }, [selectedGameId, onScrollTop])

  useEffect(() => {
    if (selectedGameId === null || !snapshot) return
    if (!snapshot.games.some((game) => game.id === selectedGameId)) {
      setSelectedGameId(null)
    }
  }, [snapshot, selectedGameId])

  const compatibilityById = useMemo(() => {
    const map = new Map<number, CompatibilityResult>()
    if (!snapshot) return map
    for (const game of snapshot.games) {
      map.set(game.id, evaluateRequirements(game.requirements, snapshot.hardware))
    }
    return map
  }, [snapshot])

  const onlineCounts = useMemo(() => {
    let online = 0
    let offline = 0
    let unchecked = 0
    for (const game of latestGames) {
      if (isOnlineAvailable(game)) online += 1
      else if (isOnlinePending(game)) unchecked += 1
      else offline += 1
    }
    return { online, offline, unchecked }
  }, [latestGames])

  const specCounts = useMemo(() => {
    const counts: Record<CompatibilityTier, number> = {
      recommended: 0,
      minimum: 0,
      below: 0,
      unknown: 0
    }
    for (const game of latestGames) {
      const tier = compatibilityById.get(game.id)?.tier ?? 'unknown'
      counts[tier] += 1
    }
    return counts
  }, [latestGames, compatibilityById])

  const recommendedCount = specCounts.recommended

  const normalizedQuery = normalizeSearch(query)
  const queryTokens = useMemo(
    () => normalizedQuery.split(' ').filter(Boolean),
    [normalizedQuery]
  )
  const hasFilters =
    normalizedQuery.length > 0 || onlineFilter !== 'all' || specFilter !== 'all'

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE)
  }, [normalizedQuery, onlineFilter, specFilter, sortMode, latestGames.length])

  const visibleGames = useMemo(() => {
    if (!snapshot) return []
    const filtered: Array<{ game: StoreGame; relevance: number }> = []

    for (const game of latestGames) {
      if (onlineFilter === 'unchecked') {
        if (!isOnlinePending(game)) continue
      } else if (onlineFilter === 'online') {
        if (!isOnlineAvailable(game)) continue
      } else if (onlineFilter === 'offline') {
        if (isOnlineAvailable(game) || isOnlinePending(game)) continue
      }
      if (specFilter !== 'all') {
        const tier = compatibilityById.get(game.id)?.tier ?? 'unknown'
        if (tier !== specFilter) continue
      }

      const relevance =
        queryTokens.length > 0 ? searchScore(game, normalizedQuery, queryTokens) : 0
      if (relevance === null) continue
      filtered.push({ game, relevance })
    }

    filtered.sort((firstEntry, secondEntry) => {
      const first = firstEntry.game
      const second = secondEntry.game

      if (queryTokens.length > 0 && firstEntry.relevance !== secondEntry.relevance) {
        return firstEntry.relevance - secondEntry.relevance
      }

      if (sortMode === 'release') {
        return (
          (second.releaseYear ?? 0) - (first.releaseYear ?? 0) ||
          first.title.localeCompare(second.title)
        )
      }
      if (sortMode === 'added') {
        const firstAdded = Date.parse(first.catalogAddedAt ?? '') || 0
        const secondAdded = Date.parse(second.catalogAddedAt ?? '') || 0
        return secondAdded - firstAdded || first.title.localeCompare(second.title)
      }
      if (sortMode === 'compatibility') {
        const firstTier = compatibilityById.get(first.id)?.tier ?? 'unknown'
        const secondTier = compatibilityById.get(second.id)?.tier ?? 'unknown'
        return (
          TIER_RANK[secondTier] - TIER_RANK[firstTier] ||
          first.title.localeCompare(second.title)
        )
      }
      return first.title.localeCompare(second.title)
    })

    return filtered.map((entry) => entry.game)
  }, [snapshot, latestGames, onlineFilter, specFilter, normalizedQuery, queryTokens, sortMode, compatibilityById])

  const isFrontPage = !hasFilters
  const displayGames = isFrontPage ? popularGames : visibleGames
  const frontPagePending =
    isFrontPage && popularLoading && popular === null && !popularFailed
  const frontPageLabel =
    popular?.source === 'catalog' || popularFailed ? 'Catalog highlights' : 'Popular on Steam'
  const renderedGames = displayGames.slice(0, visibleLimit)

  useEffect(() => {
    return window.ayanami.onCatalogGameUpdated((updatedGame) => {
      setSnapshot((current) => {
        if (!current) return current
        const index = current.games.findIndex((game) => game.id === updatedGame.id)
        if (index === -1) return current
        const nextGames = current.games.slice()
        nextGames[index] = updatedGame
        return { ...current, games: nextGames }
      })
    })
  }, [])

  const pendingEnrichmentKey = renderedGames
    .filter((game) => game.metadataStatus === 'pending')
    .map((game) => game.id)
    .join(',')

  useEffect(() => {
    if (!pendingEnrichmentKey) return
    const gameIds = pendingEnrichmentKey.split(',').map(Number)
    void window.ayanami.enrichCatalogGames(gameIds).catch(() => undefined)
  }, [pendingEnrichmentKey])

  const handleImport = useCallback(async (): Promise<void> => {
    if (catalogBusy) return
    setCatalogBusy('import')
    try {
      const result = await window.ayanami.importCatalogSource()
      if (!result) return
      onCatalogChanged()
      onToast(importSummary(result), 'success')
    } catch (error) {
      onToast(`Couldn’t import that manifest. ${getErrorMessage(error)}`, 'error')
    } finally {
      setCatalogBusy(null)
    }
  }, [catalogBusy, onCatalogChanged, onToast])

  const handleLoadSample = useCallback(async (): Promise<void> => {
    if (catalogBusy) return
    setCatalogBusy('sample')
    try {
      const result = await window.ayanami.loadSampleCatalog()
      onCatalogChanged()
      onToast(importSummary(result), 'success')
    } catch (error) {
      onToast(`Couldn’t load the sample catalog. ${getErrorMessage(error)}`, 'error')
    } finally {
      setCatalogBusy(null)
    }
  }, [catalogBusy, onCatalogChanged, onToast])

  const handleRefreshHardware = useCallback(async (): Promise<void> => {
    if (hardwareBusy) return
    setHardwareBusy(true)
    try {
      const hardware = await window.ayanami.getHardwareProfile(true)
      setSnapshot((previous) => (previous ? { ...previous, hardware } : previous))
      onToast('Hardware profile refreshed.', 'success')
    } catch (error) {
      onToast(`Couldn’t refresh this PC’s hardware. ${getErrorMessage(error)}`, 'error')
    } finally {
      setHardwareBusy(false)
    }
  }, [hardwareBusy, onToast])

  const clearFilters = useCallback((): void => {
    setQuery('')
    setOnlineFilter('all')
    setSpecFilter('all')
  }, [])

  const selectedGame = selectedGameId === null
    ? null
    : games.find((game) => game.id === selectedGameId) ?? null
  const selectedVersions = selectedGame ? olderCatalogVersions(selectedGame, games) : []

  if (selectedGame && snapshot) {
    const compatibility =
      compatibilityById.get(selectedGame.id) ??
      evaluateRequirements(selectedGame.requirements, snapshot.hardware)

    return (
      <StoreGameDetail
        game={selectedGame}
        compatibility={compatibility}
        hardware={snapshot.hardware}
        hardwareBusy={hardwareBusy}
        olderVersions={selectedVersions}
        onOpenVersion={(version) => setSelectedGameId(version.id)}
        onBack={() => setSelectedGameId(null)}
        onRefreshHardware={() => void handleRefreshHardware()}
        onToast={onToast}
      />
    )
  }

  const allSpecsUnknown = latestGames.length > 0 && specCounts.unknown === latestGames.length
  const description =
    latestGames.length > 0
      ? isFrontPage
        ? `The ${Math.min(20, latestGames.length)} most popular Steam games in your catalog, with artwork and descriptions loaded up front. Search or use a filter to browse all ${formatCount(
            latestGames.length,
            'title'
          )}.`
        : `${formatCount(latestGames.length, 'title')} from ${formatCount(
            sources.length,
            'catalog source'
          )}. ${
            allSpecsUnknown
              ? 'This catalog does not include hardware requirements, so compatibility is unknown.'
              : 'Every spec is checked against this PC before you commit.'
          }${
            collapsedVersionCount > 0
              ? ` ${collapsedVersionCount.toLocaleString('en-US')} older catalog ${
                  collapsedVersionCount === 1 ? 'entry' : 'entries'
                } grouped under the latest version.`
              : ''
          }`
      : 'A quiet storefront for the catalog sources you bring with you.'

  return (
    <>
      <PageHeader
        eyebrow="Discover"
        title="Store"
        description={description}
        aside={
          <div className="flex items-center gap-2">
            {snapshot && (
              <span className="hidden items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] px-3.5 py-2 text-[10px] font-medium text-slate-400 sm:inline-flex">
                <StoreIcon className="h-3.5 w-3.5 text-ayanami-accent/80" />
                {formatCount(latestGames.length, 'title')}
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={catalogBusy !== null}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-[#a8c5e5] via-[#9db2ca] to-[#879cb5] px-4 text-[11.5px] font-semibold text-[#0b0e18] shadow-[0_14px_35px_-14px_rgba(135,156,181,0.6)] transition hover:brightness-105 active:scale-[0.985] disabled:cursor-wait disabled:opacity-70"
            >
              {catalogBusy === 'import' ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <PlusIcon className="h-4 w-4" />
              )}
              Import
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Manage catalog sources"
              title="Manage catalog sources"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-slate-400 transition hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-slate-200"
            >
              <SlidersIcon className="h-4 w-4" />
            </button>
          </div>
        }
      />

      {loadError && (
        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-red-400/15 bg-red-400/[0.035] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <div>
              <p className="text-[10.5px] font-medium text-red-100/85">
                {snapshot ? 'The catalog could not be refreshed' : 'The catalog could not be loaded'}
              </p>
              <p className="mt-0.5 text-[9.5px] leading-4 text-red-100/60">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-[9.5px] font-medium text-slate-200 transition hover:bg-white/[0.07] sm:self-auto"
          >
            <RefreshIcon className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {!snapshot && loading ? (
        <StoreSkeleton />
      ) : !snapshot ? (
        <div className="mt-9 flex flex-col items-center rounded-2xl border border-dashed border-[#2b313c] bg-[#11141a]/55 px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-500">
            <StoreIcon className="h-5 w-5" />
          </span>
          <h2 className="mt-4 font-display text-lg font-semibold text-white">Store unavailable</h2>
          <p className="mt-2 max-w-md text-[11px] leading-5 text-slate-500">
            Ayanami could not read its local catalog. Nothing has been changed.
          </p>
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 text-[10px] font-medium text-slate-200 transition hover:bg-white/[0.07]"
          >
            <RefreshIcon className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      ) : games.length === 0 ? (
        <EmptyStore
          hasSources={sources.length > 0}
          busy={catalogBusy}
          onImport={() => void handleImport()}
          onLoadSample={() => void handleLoadSample()}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2.5 rounded-xl border border-white/[0.055] bg-[#12151b]/70 px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-[8.5px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              <MonitorIcon className="h-3.5 w-3.5 text-ayanami-accent/70" />
              Your PC
            </span>
            <span className="hidden h-4 w-px bg-white/[0.07] sm:block" />
            <HardwareFact
              icon={<CpuIcon className="h-3.5 w-3.5" />}
              label="CPU"
              value={snapshot.hardware.cpu}
            />
            <HardwareFact
              icon={<MonitorIcon className="h-3.5 w-3.5" />}
              label="GPU"
              value={snapshot.hardware.gpu}
            />
            <HardwareFact
              icon={<MemoryIcon className="h-3.5 w-3.5" />}
              label="RAM"
              value={
                snapshot.hardware.memoryGb > 0
                  ? `${Math.round(snapshot.hardware.memoryGb * 10) / 10} GB`
                  : 'Not detected'
              }
            />
            <HardwareFact
              icon={<HardDriveIcon className="h-3.5 w-3.5" />}
              label={snapshot.hardware.storageDrive ? `${snapshot.hardware.storageDrive} free` : 'Free'}
              value={
                snapshot.hardware.freeStorageGb !== null
                  ? `${Math.round(snapshot.hardware.freeStorageGb)} GB`
                  : 'Not detected'
              }
            />
            <button
              type="button"
              onClick={() => void handleRefreshHardware()}
              disabled={hardwareBusy}
              aria-label="Refresh detected hardware"
              title="Refresh detected hardware"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.06] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-300 disabled:opacity-40"
            >
              <RefreshIcon className={`h-3.5 w-3.5 ${hardwareBusy ? 'animate-spin' : ''}`} />
            </button>
            <span className="ml-auto hidden text-[9px] tabular-nums text-slate-600 xl:inline">
              {allSpecsUnknown
                ? 'No hardware requirements listed'
                : `${recommendedCount.toLocaleString('en-US')} of ${latestGames.length.toLocaleString('en-US')} clear recommended${
                    specCounts.unknown > 0
                      ? ` · ${formatCount(specCounts.unknown, 'title')} without specs`
                      : ''
                  }`}
            </span>
          </div>

          <div className="mt-4 rounded-2xl border border-white/[0.055] bg-[#12151b]/60 p-3">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <label className="relative block flex-1">
                <span className="sr-only">Search the store catalog</span>
                <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search titles, studios, genres…"
                  className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#0d1016] pl-10 pr-9 text-[11px] text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-ayanami-accent/40 focus:ring-2 focus:ring-ayanami-accent/[0.08]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-600 transition hover:bg-white/[0.05] hover:text-slate-300"
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                )}
              </label>

              <div className="flex items-center gap-2">
                {!isFrontPage && (
                  <select
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value as SortMode)}
                    aria-label="Sort store titles"
                    className="h-10 rounded-xl border border-white/[0.07] bg-[#0d1016] px-3 text-[10px] font-medium text-slate-300 outline-none transition focus:border-ayanami-accent/40"
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
                {isFrontPage && (
                  <span className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-ayanami-accent/20 bg-ayanami-accent/[0.06] px-3 text-[9.5px] font-medium text-ayanami-highlight">
                    <CheckIcon className="h-3 w-3" />
                    Most played
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setReloadToken((token) => token + 1)}
                  disabled={loading}
                  aria-label="Reload catalog"
                  title="Reload catalog"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-300 disabled:opacity-40"
                >
                  <RefreshIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-white/[0.045] pt-2.5">
              <FilterChip
                active={onlineFilter === 'all'}
                onClick={() => setOnlineFilter('all')}
              >
                All titles
                <ChipCount value={latestGames.length} active={onlineFilter === 'all'} />
              </FilterChip>
              <FilterChip
                active={onlineFilter === 'online'}
                onClick={() => setOnlineFilter('online')}
                dotColor={ONLINE_AVAILABLE_META.color}
                title={ONLINE_AVAILABLE_META.description}
              >
                {ONLINE_AVAILABLE_META.label}
                <ChipCount value={onlineCounts.online} active={onlineFilter === 'online'} />
              </FilterChip>
              <FilterChip
                active={onlineFilter === 'offline'}
                onClick={() => setOnlineFilter('offline')}
                dotColor={ONLINE_STATUS_META.offline.color}
                title={ONLINE_STATUS_META.offline.description}
              >
                {ONLINE_STATUS_META.offline.label}
                <ChipCount value={onlineCounts.offline} active={onlineFilter === 'offline'} />
              </FilterChip>
              {onlineCounts.unchecked > 0 && (
                <FilterChip
                  active={onlineFilter === 'unchecked'}
                  onClick={() => setOnlineFilter('unchecked')}
                  dotColor={ONLINE_UNCHECKED_META.color}
                  title={ONLINE_UNCHECKED_META.description}
                >
                  {ONLINE_UNCHECKED_META.shortLabel}
                  <ChipCount
                    value={onlineCounts.unchecked}
                    active={onlineFilter === 'unchecked'}
                  />
                </FilterChip>
              )}

              <span className="mx-1 hidden h-4 w-px bg-white/[0.07] sm:block" />

              <FilterChip active={specFilter === 'all'} onClick={() => setSpecFilter('all')}>
                All specs
                <ChipCount value={latestGames.length} active={specFilter === 'all'} />
              </FilterChip>
              {SPEC_FILTERS.filter(
                (tier) => tier !== 'unknown' || specCounts.unknown > 0
              ).map((tier) => {
                const meta = COMPATIBILITY_META[tier]
                return (
                  <FilterChip
                    key={tier}
                    active={specFilter === tier}
                    onClick={() => setSpecFilter(tier)}
                    dotColor={meta.color}
                    title={meta.description}
                  >
                    {meta.shortLabel}
                    <ChipCount
                      value={specCounts[tier]}
                      active={specFilter === tier}
                    />
                  </FilterChip>
                )
              })}

              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-medium text-slate-600 transition hover:text-slate-300"
                >
                  <CloseIcon className="h-2.5 w-2.5" />
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="mb-4 mt-7 flex items-center justify-between">
            <p className="text-[9px] font-semibold uppercase tracking-[0.26em] text-slate-500">
              {hasFilters ? 'Matching titles' : frontPageLabel}
            </p>
            <p className="text-[10px] tabular-nums text-slate-600">
              {hasFilters
                ? `${visibleGames.length.toLocaleString('en-US')} of ${latestGames.length.toLocaleString('en-US')}`
                : frontPagePending
                  ? 'Refreshing popularity…'
                  : `${formatCount(popularGames.length, 'title')} · most played`}
            </p>
          </div>

          {frontPagePending ? (
            <StoreSkeleton />
          ) : displayGames.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#2b313c] bg-[#11141a]/45 px-6 py-14 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-500">
                <SearchIcon className="h-5 w-5" />
              </span>
              <h2 className="mt-4 font-display text-lg font-semibold text-white">
                No titles match those filters
              </h2>
              <p className="mt-2 max-w-sm text-[11px] leading-5 text-slate-500">
                Try a different search term, or clear the online and compatibility filters.
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 text-[10px] font-medium text-slate-200 transition hover:bg-white/[0.07]"
              >
                <CloseIcon className="h-3.5 w-3.5" />
                Clear filters
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {renderedGames.map((game) => (
                  <StoreGameCard
                    key={game.id}
                    game={game}
                    onOpen={(selected: StoreGame) => setSelectedGameId(selected.id)}
                  />
                ))}
              </div>

              {!isFrontPage && displayGames.length > visibleLimit && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((limit) => limit + PAGE_SIZE)}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 text-[10.5px] font-medium text-slate-300 transition hover:border-ayanami-accent/30 hover:bg-ayanami-accent/[0.06] hover:text-white"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Show {Math.min(PAGE_SIZE, displayGames.length - visibleLimit)} more
                    <span className="text-slate-600">
                      · {formatCount(displayGames.length - visibleLimit, 'title')} remaining
                    </span>
                  </button>
                </div>
              )}
            </>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.045] pt-4 text-[9px] text-slate-600">
            <span>
              Showing {renderedGames.length} of{' '}
              {hasFilters
                ? `${visibleGames.length} matching`
                : isFrontPage
                  ? formatCount(popularGames.length, 'title')
                  : formatCount(latestGames.length, 'title')}{' '}
              · {formatCount(sources.length, 'catalog source')}
              {collapsedVersionCount > 0
                ? ` · ${collapsedVersionCount.toLocaleString('en-US')} older ${
                    collapsedVersionCount === 1 ? 'entry' : 'entries'
                  } grouped`
                : ''}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Recommended
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-400" />
              Minimum
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-red-400" />
              Below minimum
            </span>
          </div>
        </>
      )}
    </>
  )
}
