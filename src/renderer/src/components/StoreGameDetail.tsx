import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import {
  isOnlinePending,
  onlineStatusMeta,
  parseCatalogTitleVersion
} from '@shared/catalog'
import { hasRequirementTierData } from '@shared/specs'
import { createPlaceholderCover } from '@shared/placeholderCover'
import { createPlaceholderHero, createPlaceholderScreenshot } from '@shared/placeholderArtwork'
import type {
  BenchmarkLookupResult,
  CompatibilityResult,
  HardwareProfile,
  RequirementCheck,
  RequirementCheckStatus,
  RequirementKey,
  RequirementTier,
  StoreGame
} from '@shared/types'
import { getErrorMessage } from '../lib/errors'
import { formatBytes, formatCount, formatDateTime, formatMonthYear } from '../lib/format'
import type { ToastTone } from './Toast'
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CpuIcon,
  DownloadIcon,
  ExternalLinkIcon,
  HardDriveIcon,
  InfoIcon,
  MemoryIcon,
  MonitorIcon,
  PlayIcon,
  RefreshIcon
} from './Icons'
import { Spinner } from './Spinner'
import { OnlineStatusBadge } from './StoreBadges'

interface StoreGameDetailProps {
  game: StoreGame
  compatibility: CompatibilityResult
  hardware: HardwareProfile
  hardwareBusy: boolean
  olderVersions: StoreGame[]
  onOpenVersion: (game: StoreGame) => void
  onBack: () => void
  onRefreshHardware: () => void
  onToast: (message: string, tone?: ToastTone) => void
}

const CHECK_COLORS: Record<RequirementCheckStatus, string> = {
  pass: '#22c55e',
  warn: '#eab308',
  fail: '#ef4444',
  unknown: '#94a3b8'
}

function CheckStatusIcon({ status }: { status: RequirementCheckStatus }): JSX.Element {
  const color = CHECK_COLORS[status]
  const className = 'h-3.5 w-3.5 shrink-0'
  if (status === 'pass') return <CheckIcon className={className} style={{ color }} strokeWidth={2.3} />
  if (status === 'warn') return <AlertCircleIcon className={className} style={{ color }} />
  if (status === 'fail') return <CloseIcon className={className} style={{ color }} />
  return <InfoIcon className={className} style={{ color }} />
}

function formatGigabytes(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} GB`
}

function formatScore(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

function mirrorHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Open mirror'
  }
}

function RequirementRow({
  label,
  icon,
  check
}: {
  label: string
  icon: ReactNode
  check: RequirementCheck | null
}): JSX.Element {
  const status = check?.status ?? 'unknown'
  return (
    <div className="flex items-start gap-2.5 py-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.055] bg-white/[0.02] text-slate-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {label}
          </p>
          <CheckStatusIcon status={status} />
        </div>
        <p className="mt-1 text-[10px] leading-4 text-slate-300">
          {check?.required ?? 'Not specified'}
        </p>
        {check && (
          <p
            className="mt-0.5 truncate text-[8.5px] leading-4 text-slate-600"
            title={check.detected}
          >
            Yours: {check.detected}
          </p>
        )}
        {check?.detail && (
          <p className="mt-0.5 text-[8.5px] leading-4 text-slate-700">{check.detail}</p>
        )}
      </div>
    </div>
  )
}

const REQUIREMENT_ROWS: Array<{ key: RequirementKey; label: string; icon: ReactNode }> = [
  { key: 'cpu', label: 'Processor', icon: <CpuIcon className="h-3.5 w-3.5" /> },
  { key: 'gpu', label: 'Graphics', icon: <MonitorIcon className="h-3.5 w-3.5" /> },
  { key: 'ram', label: 'Memory', icon: <MemoryIcon className="h-3.5 w-3.5" /> },
  { key: 'storage', label: 'Storage', icon: <HardDriveIcon className="h-3.5 w-3.5" /> }
]

function RequirementTierCard({
  title,
  tier,
  checks
}: {
  title: string
  tier: RequirementTier
  checks: RequirementCheck[]
}): JSX.Element {
  const checksByKey = new Map(checks.map((check) => [check.key, check]))
  const benchmarkLabel = [
    tier.cpuBenchmark !== null
      ? `CPU Mark ${formatScore(tier.cpuBenchmark)}${
          tier.cpuBenchmarkModel ? ` · ${tier.cpuBenchmarkModel}` : ''
        }`
      : null,
    tier.gpuBenchmark !== null
      ? `G3D Mark ${formatScore(tier.gpuBenchmark)}${
          tier.gpuBenchmarkModel ? ` · ${tier.gpuBenchmarkModel}` : ''
        }`
      : null
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ')
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015]">
      <div className="border-b border-white/[0.05] px-3.5 py-3">
        <p className="text-[10.5px] font-semibold text-slate-200">{title}</p>
        <p className="mt-0.5 text-[8.5px] text-slate-600">
          {benchmarkLabel ||
            (tier.cpuGeneric || tier.gpuGeneric
              ? 'Generic requirement assumed satisfied'
              : 'PassMark not available')}
        </p>
      </div>
      <div className="divide-y divide-white/[0.045] px-3.5">
        {REQUIREMENT_ROWS.map((row) => (
          <RequirementRow
            key={row.key}
            label={row.label}
            icon={row.icon}
            check={checksByKey.get(row.key) ?? null}
          />
        ))}
      </div>
    </div>
  )
}

function HardwareRow({
  icon,
  label,
  value,
  detail
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string | null
}): JSX.Element {
  return (
    <div className="flex items-start gap-2.5 py-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.055] bg-white/[0.02] text-slate-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {label}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-slate-300" title={value}>
          {value}
        </p>
        {detail && <p className="mt-0.5 text-[8.5px] text-slate-600">{detail}</p>}
      </div>
    </div>
  )
}

function VersionCard({
  version,
  onOpen
}: {
  version: StoreGame
  onOpen: (game: StoreGame) => void
}): JSX.Element {
  const fallbackCover = useMemo(
    () => createPlaceholderCover(version.title, 'STORE CATALOG · AYANAMI'),
    [version.title]
  )
  const [coverFailed, setCoverFailed] = useState(false)
  const versionInfo = parseCatalogTitleVersion(version.title)
  const metaParts = [
    version.releaseYear ? String(version.releaseYear) : null,
    version.catalogAddedAt ? `Added ${formatMonthYear(version.catalogAddedAt)}` : null,
    version.download.sizeBytes ? formatBytes(version.download.sizeBytes) : null
  ].filter((value): value is string => Boolean(value))

  return (
    <button
      type="button"
      onClick={() => onOpen(version)}
      className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] p-3 text-left transition hover:border-ayanami-accent/30 hover:bg-ayanami-accent/[0.045]"
    >
      <div className="relative h-[72px] w-12 shrink-0 overflow-hidden rounded-md border border-white/[0.08] bg-[#0b0e13]">
        <img
          src={version.coverUrl && !coverFailed ? version.coverUrl : fallbackCover}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setCoverFailed(true)}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="inline-flex items-center rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 text-[8.5px] font-semibold text-slate-300">
          {versionInfo.versionLabel ?? 'Unversioned release'}
        </p>
        <p className="mt-1.5 truncate text-[11px] font-medium text-slate-200" title={version.title}>
          {version.title}
        </p>
        <p className="mt-0.5 truncate text-[8.5px] text-slate-600">
          {metaParts.length > 0 ? metaParts.join(' · ') : 'Manifest release'}
        </p>
      </div>
      <ArrowRightIcon className="h-4 w-4 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-ayanami-highlight" />
    </button>
  )
}

export function StoreGameDetail({
  game,
  compatibility,
  hardware,
  hardwareBusy,
  olderVersions,
  onOpenVersion,
  onBack,
  onRefreshHardware,
  onToast
}: StoreGameDetailProps): JSX.Element {
  const fallbackCover = useMemo(
    () => createPlaceholderCover(game.title, 'STORE CATALOG · AYANAMI'),
    [game.title]
  )
  const fallbackHero = useMemo(
    () => createPlaceholderHero(game.title),
    [game.title]
  )
  const placeholderScreenshots = useMemo(
    () => [0, 1, 2].map((index) => createPlaceholderScreenshot(game.title, index)),
    [game.title]
  )

  const [coverFailed, setCoverFailed] = useState(false)
  const [heroFailed, setHeroFailed] = useState(false)
  const [failedScreenshots, setFailedScreenshots] = useState<Set<number>>(new Set())
  const [activeScreenshot, setActiveScreenshot] = useState(0)
  const [activeTab, setActiveTab] = useState<'overview' | 'versions'>('overview')
  const [queueBusy, setQueueBusy] = useState(false)
  const [queued, setQueued] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [sourceBusy, setSourceBusy] = useState(false)
  const [metadataBusy, setMetadataBusy] = useState(false)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [onlineBusy, setOnlineBusy] = useState(false)
  const [onlineError, setOnlineError] = useState<string | null>(null)
  const [videoState, setVideoState] = useState<BenchmarkLookupResult | null>(null)
  const [videoLoading, setVideoLoading] = useState(true)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const videoRequestId = useRef(0)
  const onlineRequestId = useRef(0)

  useEffect(() => {
    setCoverFailed(false)
    setHeroFailed(false)
    setFailedScreenshots(new Set())
    setActiveScreenshot(0)
    setActiveTab('overview')
  }, [game.id, game.coverUrl, game.heroUrl, game.screenshots.length])

  useEffect(() => {
    setQueueBusy(false)
    setQueued(false)
    setQueueError(null)
    setSourceBusy(false)
    setMetadataBusy(false)
    setMetadataError(null)
    setOnlineError(null)
  }, [game.id])

  useEffect(() => {
    if (game.metadataStatus !== 'pending') return
    void window.ayanami.enrichCatalogGames([game.id]).catch(() => undefined)
  }, [game.id, game.metadataStatus])

  useEffect(() => {
    const requestId = onlineRequestId.current + 1
    onlineRequestId.current = requestId
    setOnlineBusy(true)
    setOnlineError(null)

    void window.ayanami
      .checkOnlineStatus(game.id)
      .catch((error) => {
        if (onlineRequestId.current === requestId) {
          setOnlineError(getErrorMessage(error))
        }
      })
      .finally(() => {
        if (onlineRequestId.current === requestId) setOnlineBusy(false)
      })

    return () => {
      onlineRequestId.current += 1
    }
  }, [game.id])

  const screenshots = game.screenshots.length > 0 ? game.screenshots : placeholderScreenshots
  const safeActiveScreenshot = Math.min(activeScreenshot, screenshots.length - 1)
  const activeScreenshotUrl = failedScreenshots.has(safeActiveScreenshot)
    ? placeholderScreenshots[safeActiveScreenshot % placeholderScreenshots.length]
    : screenshots[safeActiveScreenshot]

  const coverUrl = game.coverUrl && !coverFailed ? game.coverUrl : fallbackCover
  const heroUrl = game.heroUrl && !heroFailed ? game.heroUrl : fallbackHero

  const loadBenchmarkVideo = useCallback(
    async (force: boolean): Promise<void> => {
      const requestId = videoRequestId.current + 1
      videoRequestId.current = requestId
      setVideoLoading(true)
      setVideoPlaying(false)
      const query = `${hardware.gpu} ${game.title} benchmark`
      try {
        const result = await window.ayanami.getBenchmarkVideo(game.id, force)
        if (videoRequestId.current !== requestId) return
        setVideoState(result)
      } catch (error) {
        if (videoRequestId.current !== requestId) return
        setVideoState({
          status: 'error',
          query,
          searchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
          message: getErrorMessage(error)
        })
      } finally {
        if (videoRequestId.current === requestId) setVideoLoading(false)
      }
    },
    [game.id, game.title, hardware.gpu]
  )

  useEffect(() => {
    void loadBenchmarkVideo(false)
    return () => {
      videoRequestId.current += 1
    }
  }, [loadBenchmarkVideo])

  const onlinePending = isOnlinePending(game)
  const onlineMeta = onlineStatusMeta(game, onlineBusy)
  const synopsisFallback =
    game.metadataStatus === 'pending'
      ? 'Fetching cover art, description, and system requirements from Steam…'
      : game.metadataStatus === 'error'
        ? 'Steam metadata could not be reached right now. Ayanami will retry later and shows the imported manifest details meanwhile.'
        : game.metadataStatus === 'missing'
          ? 'Steam did not return a match for this release, so imported manifest details and locally generated artwork are shown.'
          : 'This catalog entry does not include a synopsis yet.'

  const downloadMeta = [
    game.download.type === 'torrent'
      ? 'BitTorrent'
      : game.download.type === 'http'
        ? 'Direct HTTP'
        : null,
    game.download.releaseType === 'repack'
      ? 'Repack installer'
      : game.download.releaseType === 'preinstalled'
        ? 'Pre-installed archive'
        : null,
    game.download.sizeBytes ? formatBytes(game.download.sizeBytes) : null,
    game.download.mirrors.length > 0 ? formatCount(game.download.mirrors.length, 'mirror') : null
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ')

  const mirrors = game.download.mirrors
  const hasMinimumRequirements = hasRequirementTierData(game.requirements.minimum)
  const hasRecommendedRequirements = hasRequirementTierData(game.requirements.recommended)
  const hasRequirements = hasMinimumRequirements || hasRecommendedRequirements
  const canDownload = Boolean(game.download.url)

  const handleQueue = async (): Promise<void> => {
    if (!canDownload || queueBusy || queued) return
    setQueueBusy(true)
    setQueueError(null)
    try {
      const result = await window.ayanami.queueStoreDownload(game.id)
      if (result.manualPage) {
        onToast(
          `Opened the download page for “${game.title}”. Finish the host's steps there; the file is added to Downloads automatically.`,
          'info'
        )
        return
      }
      setQueued(true)
      const title = result.item?.title ?? game.title
      onToast(
        result.alreadyQueued
          ? `“${title}” is already in the download queue.`
          : `“${title}” was added to Downloads.`,
        result.alreadyQueued ? 'info' : 'success'
      )
    } catch (error) {
      setQueueError(getErrorMessage(error))
    } finally {
      setQueueBusy(false)
    }
  }

  const handleOpenSourcePage = async (): Promise<void> => {
    if (!canDownload || sourceBusy) return
    setSourceBusy(true)
    setQueueError(null)
    try {
      await window.ayanami.openSourcePage(game.id)
    } catch (error) {
      setQueueError(getErrorMessage(error))
    } finally {
      setSourceBusy(false)
    }
  }

  const handleMetadataRefresh = async (): Promise<void> => {
    if (metadataBusy) return
    setMetadataBusy(true)
    setMetadataError(null)
    try {
      await window.ayanami.enrichCatalogGames([game.id], true)
      onToast(`Retrying Steam metadata for “${game.title}”…`, 'info')
    } catch (error) {
      setMetadataError(getErrorMessage(error))
    } finally {
      setMetadataBusy(false)
    }
  }

  const handleOnlineRefresh = async (): Promise<void> => {
    if (onlineBusy) return
    const requestId = onlineRequestId.current + 1
    onlineRequestId.current = requestId
    setOnlineBusy(true)
    setOnlineError(null)
    try {
      const updated = await window.ayanami.checkOnlineStatus(game.id, true)
      if (onlineRequestId.current !== requestId) return
      onToast(
        updated.onlineStatus === 'online-fix'
          ? `“${game.title}” is listed on online-fix.me.`
          : updated.onlineByKeyword
            ? `“${game.title}” has no online-fix.me listing, but its title marks it as online-capable.`
            : `“${game.title}” has no online-fix.me listing and no online keyword in its title.`,
        updated.onlineStatus === 'online-fix' ? 'success' : 'info'
      )
    } catch (error) {
      if (onlineRequestId.current === requestId) {
        setOnlineError(getErrorMessage(error))
      }
    } finally {
      if (onlineRequestId.current === requestId) setOnlineBusy(false)
    }
  }

  const hardwareStaleNote = hardware.fromCache
    ? `Cached · ${formatDateTime(hardware.detectedAt)}`
    : `Detected ${formatDateTime(hardware.detectedAt)}`

  return (
    <div className="step-enter">
      <button
        type="button"
        onClick={onBack}
        className="group inline-flex items-center gap-2 rounded-lg px-1 py-1 text-[11px] font-medium text-slate-500 transition hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
        Back to store
      </button>

      <section className="relative mt-4 overflow-hidden rounded-[26px] border border-white/[0.07] bg-[#12161d] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.95)]">
        <div className="pointer-events-none absolute inset-0">
          <img
            src={heroUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            onError={() => setHeroFailed(true)}
            className="h-full w-full scale-105 object-cover opacity-55 blur-[0.5px]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0c0f14] via-[#0c0f14]/88 to-[#0c0f14]/45" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0c0f14] via-[#0c0f14]/25 to-transparent" />
        </div>

        <div className="relative flex min-h-[360px] flex-col justify-end gap-5 p-5 sm:flex-row sm:items-end sm:p-7 lg:p-8">
          <div className="relative hidden w-[128px] shrink-0 overflow-hidden rounded-xl border border-white/[0.1] bg-[#0b0e13] shadow-[0_24px_55px_-20px_rgba(0,0,0,0.95)] sm:block lg:w-[146px]">
            <img
              src={coverUrl}
              alt={`${game.title} cover art`}
              draggable={false}
              onError={() => setCoverFailed(true)}
              className="aspect-[2/3] h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/[0.08]" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <OnlineStatusBadge game={game} checking={onlineBusy} size="lg" />
              {game.releaseYear && (
                <span className="rounded-full border border-white/[0.08] bg-[#080b10]/55 px-3 py-1.5 text-[9.5px] font-medium text-slate-400 backdrop-blur-md">
                  {game.releaseYear}
                </span>
              )}
              {game.metadataStatus === 'pending' && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-ayanami-accent/25 bg-ayanami-accent/[0.08] px-3 py-1.5 text-[9.5px] font-medium text-ayanami-highlight backdrop-blur-md">
                  <Spinner className="h-3 w-3" />
                  Loading Steam details
                </span>
              )}
            </div>

            <h1 className="mt-4 font-display text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-[38px] lg:text-[44px]">
              {game.title}
            </h1>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] font-medium text-slate-400">
              {game.developer && <span>{game.developer}</span>}
              {game.publisher && game.publisher !== game.developer && (
                <>
                  <span className="text-slate-700">·</span>
                  <span>{game.publisher}</span>
                </>
              )}
              {game.genres.length > 0 && (
                <>
                  <span className="text-slate-700">·</span>
                  <span>{game.genres.slice(0, 3).join(' / ')}</span>
                </>
              )}
              {game.storageGb && (
                <>
                  <span className="text-slate-700">·</span>
                  <span>{Math.round(game.storageGb)} GB install</span>
                </>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleQueue()}
                disabled={!canDownload || queueBusy || queued}
                aria-busy={queueBusy}
                className={`inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[12px] font-semibold tracking-[0.01em] transition-all duration-200 ${
                  queued
                    ? 'cursor-default border border-emerald-400/25 bg-emerald-400/[0.09] text-emerald-300'
                    : canDownload
                      ? 'bg-gradient-to-r from-[#a8c5e5] via-[#9db2ca] to-[#879cb5] text-[#0b0e18] shadow-[0_12px_30px_-14px_rgba(135,156,181,0.65)] hover:brightness-105 active:scale-[0.985] disabled:cursor-wait disabled:opacity-70'
                      : 'cursor-not-allowed border border-white/[0.06] bg-white/[0.035] text-slate-500'
                }`}
              >
                {queueBusy ? (
                  <Spinner className="h-4 w-4" />
                ) : queued ? (
                  <CheckIcon className="h-4 w-4" strokeWidth={2.4} />
                ) : (
                  <DownloadIcon className="h-4 w-4" />
                )}
                {queueBusy ? 'Queueing…' : queued ? 'In download queue' : canDownload ? 'Download' : 'No download link'}
              </button>

              {game.download.type === 'http' && game.download.url && (
                <button
                  type="button"
                  onClick={() => void handleOpenSourcePage()}
                  disabled={sourceBusy}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-[10px] font-medium text-slate-300 transition hover:border-ayanami-accent/30 hover:bg-ayanami-accent/[0.06] hover:text-white disabled:cursor-wait disabled:opacity-60"
                >
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                  {sourceBusy ? 'Opening…' : 'Open source page'}
                </button>
              )}

              {game.steamAppId && (
                <a
                  href={`https://store.steampowered.com/app/${game.steamAppId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-[10px] font-medium text-slate-300 transition hover:border-ayanami-accent/30 hover:bg-ayanami-accent/[0.06] hover:text-white"
                >
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                  Steam page
                </a>
              )}

              {downloadMeta && (
                <span className="text-[9.5px] font-medium text-slate-500">{downloadMeta}</span>
              )}
            </div>

            {queued && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[9px] font-medium text-emerald-300/85">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Queued locally. Track progress in Downloads.
              </p>
            )}

            {queueError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.05] px-3 py-2.5 text-[9.5px] leading-4 text-red-200/85">
                <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
                <p>{queueError}</p>
              </div>
            )}

            <p className="mt-4 text-[9px] text-slate-600">
              From <span className="text-slate-500">{game.sourceName}</span>
              <span className="mx-1.5 text-slate-700">·</span>
              {game.steamAppId
                ? 'Cover art, description, screenshots, and requirements from Steam.'
                : game.metadataStatus === 'pending'
                  ? 'Fetching cover art and details from Steam…'
                  : 'Manifest artwork is used when available; otherwise Ayanami generates local art.'}
            </p>
          </div>
        </div>
      </section>

      <div className="mt-5 flex items-center gap-1.5 border-b border-white/[0.06] pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          aria-pressed={activeTab === 'overview'}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[9.5px] font-medium transition ${
            activeTab === 'overview'
              ? 'bg-ayanami-accent/[0.12] text-ayanami-highlight'
              : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('versions')}
          aria-pressed={activeTab === 'versions'}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[9.5px] font-medium transition ${
            activeTab === 'versions'
              ? 'bg-ayanami-accent/[0.12] text-ayanami-highlight'
              : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
          }`}
        >
          Previous versions
          <span
            className={`rounded-full px-1.5 py-0.5 text-[8px] tabular-nums ${
              activeTab === 'versions'
                ? 'bg-ayanami-accent/15 text-ayanami-highlight/80'
                : 'bg-white/[0.05] text-slate-600'
            }`}
          >
            {olderVersions.length}
          </span>
        </button>
      </div>

      {activeTab === 'versions' ? (
        <section className="mt-5 rounded-2xl border border-ayanami-line/90 bg-[#141820]/80 p-5 lg:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-ayanami-accent/70">
                Previous versions
              </p>
              <p className="mt-1 text-[10px] leading-5 text-slate-500">
                {olderVersions.length > 0
                  ? 'Older catalog entries for this title, newest first. Open one to inspect its own metadata and requirements.'
                  : 'This catalog currently lists only the release you are viewing.'}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-white/[0.06] bg-white/[0.025] px-2.5 py-1 text-[8.5px] text-slate-500">
              {formatCount(olderVersions.length, 'version')}
            </span>
          </div>

          {olderVersions.length === 0 ? (
            <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-[#2b313c] bg-[#11141a]/45 px-4 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-500">
                <ClockIcon className="h-4 w-4" />
              </span>
              <p className="mt-3 text-[11px] font-semibold text-slate-200">
                No previous versions found
              </p>
              <p className="mt-1 max-w-sm text-[9.5px] leading-4 text-slate-500">
                Ayanami groups releases that differ only by version, build, or update marker.
                There are no older grouped entries for this title.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {olderVersions.map((version) => (
                <VersionCard key={version.id} version={version} onOpen={onOpenVersion} />
              ))}
            </div>
          )}
        </section>
      ) : (
      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-ayanami-line/90 bg-[#141820]/80 p-5 lg:p-6">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-ayanami-accent/70">
                About this game
              </p>
              <button
                type="button"
                onClick={() => void handleMetadataRefresh()}
                disabled={metadataBusy || game.metadataStatus === 'pending'}
                title="Retry Steam metadata"
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.06] px-2.5 text-[8.5px] font-medium text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-300 disabled:opacity-40"
              >
                <RefreshIcon
                  className={`h-3 w-3 ${
                    metadataBusy || game.metadataStatus === 'pending' ? 'animate-spin' : ''
                  }`}
                />
                {game.metadataStatus === 'pending'
                  ? 'Fetching…'
                  : metadataBusy
                    ? 'Retrying…'
                    : 'Refresh Steam'}
              </button>
            </div>
            <p className="mt-3 whitespace-pre-line text-[12px] leading-6 text-slate-400">
              {game.synopsis || synopsisFallback}
            </p>

            {metadataError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.05] px-3 py-2.5 text-[9px] leading-4 text-red-200/85">
                <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
                <p>{metadataError}</p>
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/[0.055] pt-4 sm:grid-cols-4">
              <div>
                <p className="text-[8.5px] uppercase tracking-[0.16em] text-slate-600">Developer</p>
                <p className="mt-1 truncate text-[10px] font-medium text-slate-300" title={game.developer ?? undefined}>
                  {game.developer ?? 'Not listed'}
                </p>
              </div>
              <div>
                <p className="text-[8.5px] uppercase tracking-[0.16em] text-slate-600">Publisher</p>
                <p className="mt-1 truncate text-[10px] font-medium text-slate-300" title={game.publisher ?? undefined}>
                  {game.publisher ?? 'Not listed'}
                </p>
              </div>
              <div>
                <p className="text-[8.5px] uppercase tracking-[0.16em] text-slate-600">
                  {game.releaseYear ? 'Released' : game.catalogAddedAt ? 'Added' : 'Released'}
                </p>
                <p className="mt-1 text-[10px] font-medium text-slate-300">
                  {game.releaseYear ??
                    (game.catalogAddedAt ? formatMonthYear(game.catalogAddedAt) : 'Not listed')}
                </p>
              </div>
              <div>
                <p className="text-[8.5px] uppercase tracking-[0.16em] text-slate-600">Source</p>
                <p className="mt-1 truncate text-[10px] font-medium text-slate-300" title={game.sourceName}>
                  {game.sourceName}
                </p>
              </div>
            </div>
          </section>

          {mirrors.length > 0 && (
            <section className="rounded-2xl border border-ayanami-line/90 bg-[#141820]/80 p-5 lg:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-ayanami-accent/70">
                    Download mirrors
                  </p>
                  <p className="mt-1 text-[9.5px] leading-4 text-slate-500">
                    Mirrors open in your browser. Use Downloads to add a direct file link or a
                    .torrent file.
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-white/[0.06] bg-white/[0.025] px-2.5 py-1 text-[8.5px] text-slate-500">
                  {formatCount(mirrors.length, 'mirror')}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {mirrors.map((mirror) => (
                  <a
                    key={mirror}
                    href={mirror}
                    target="_blank"
                    rel="noreferrer"
                    title={mirror}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 text-[9.5px] font-medium text-slate-300 transition hover:border-ayanami-accent/30 hover:bg-ayanami-accent/[0.06] hover:text-white"
                  >
                    <ExternalLinkIcon className="h-3 w-3 text-slate-500" />
                    {mirrorHost(mirror)}
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-ayanami-line/90 bg-[#141820]/80 p-5 lg:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-ayanami-accent/70">
                  Screenshots
                </p>
                <p className="mt-1 text-[9.5px] text-slate-500">
                  {game.screenshots.length > 0
                    ? `${formatCount(game.screenshots.length, 'image')}${
                        game.steamAppId ? ' · Steam store' : ''
                      }`
                    : game.metadataStatus === 'pending'
                      ? 'Fetching screenshots from Steam…'
                      : 'Generated previews for this catalog entry'}
                </p>
              </div>
              <span className="rounded-full border border-white/[0.06] bg-white/[0.025] px-2.5 py-1 text-[8.5px] text-slate-500">
                {safeActiveScreenshot + 1} / {screenshots.length}
              </span>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.07] bg-[#0b0e13]">
              <img
                src={activeScreenshotUrl}
                alt={`${game.title} screenshot ${safeActiveScreenshot + 1}`}
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={() =>
                  setFailedScreenshots((previous) => {
                    const next = new Set(previous)
                    next.add(safeActiveScreenshot)
                    return next
                  })
                }
                className="aspect-video w-full object-cover"
              />
            </div>

            {screenshots.length > 1 && (
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                {screenshots.map((screenshot, index) => {
                  const thumbnail = failedScreenshots.has(index)
                    ? placeholderScreenshots[index % placeholderScreenshots.length]
                    : screenshot
                  return (
                    <button
                      key={`${game.id}-screenshot-${index}`}
                      type="button"
                      onClick={() => setActiveScreenshot(index)}
                      aria-label={`Show screenshot ${index + 1}`}
                      aria-pressed={index === safeActiveScreenshot}
                      className={`overflow-hidden rounded-lg border bg-[#0b0e13] transition ${
                        index === safeActiveScreenshot
                          ? 'border-ayanami-accent/50 shadow-[0_0_0_1px_rgba(135,156,181,0.25)]'
                          : 'border-white/[0.06] opacity-65 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={thumbnail}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="aspect-video w-full object-cover"
                      />
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-ayanami-line/90 bg-[#141820]/80 p-5 lg:p-6">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-ayanami-accent/70">
                System requirements
              </p>
              <p className="mt-1 text-[10px] leading-5 text-slate-500">
                {hasRequirements
                  ? game.steamAppId
                    ? 'From the Steam store listing. CPU and GPU targets are scored with PassMark, then compared with this PC and its largest drive.'
                    : 'CPU and GPU targets are scored with PassMark, then compared with this PC and its largest drive.'
                  : game.metadataStatus === 'pending'
                    ? 'Fetching system requirements from Steam…'
                    : 'This catalog entry does not include hardware requirements, so compatibility is unknown.'}
              </p>
            </div>

            <div className={`mt-4 grid gap-3 ${hasRecommendedRequirements ? 'lg:grid-cols-2' : ''}`}>
              <RequirementTierCard
                title="Minimum"
                tier={game.requirements.minimum}
                checks={compatibility.minimum.checks}
              />
              {hasRecommendedRequirements && (
                <RequirementTierCard
                  title="Recommended"
                  tier={game.requirements.recommended}
                  checks={compatibility.recommended.checks}
                />
              )}
            </div>

            {hasRequirements && (
              <p className="mt-3 flex items-start gap-1.5 text-[8.5px] leading-4 text-slate-600">
                <InfoIcon className="mt-[1px] h-3 w-3 shrink-0" />
                CPU and GPU comparisons use bundled PassMark CPU Mark and G3D Mark scores. When
                Steam lists alternatives, the strongest listed model sets a consistent, conservative
                bar. Generic legacy specs such as “DirectX compatible” or “3.8 GHz” are assumed
                satisfied, while a specific model missing from the database is reported as unknown.
                Storage is checked against your largest drive.
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-ayanami-line/90 bg-[#141820]/80 p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  GPU benchmark
                </p>
                <p className="mt-1 text-[8.5px] text-slate-600">
                  {hardware.gpu} · YouTube
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadBenchmarkVideo(true)}
                disabled={videoLoading}
                aria-label="Find another benchmark video"
                title="Find another benchmark video"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.06] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-300 disabled:opacity-40"
              >
                <RefreshIcon className={`h-3.5 w-3.5 ${videoLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="mt-3">
              {videoLoading ? (
                <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-white/[0.06] bg-[#0b0e13]">
                  <div className="skeleton absolute inset-0 opacity-40" />
                  <span className="relative flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#080b10]/75 px-3 py-1.5 text-[9px] font-medium text-slate-300 backdrop-blur-md">
                    <Spinner className="h-3 w-3" />
                    Searching YouTube…
                  </span>
                </div>
              ) : videoState?.status === 'found' ? (
                <>
                  {videoPlaying ? (
                    <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-black">
                      <iframe
                        src={videoState.video.embedUrl}
                        title={`${game.title} benchmark on ${hardware.gpu}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                        className="aspect-video w-full"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setVideoPlaying(true)}
                      aria-label={`Play ${videoState.video.title}`}
                      className="group relative block w-full overflow-hidden rounded-xl border border-white/[0.07] bg-[#0b0e13] text-left"
                    >
                      <img
                        src={videoState.video.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="aspect-video w-full object-cover opacity-85 transition duration-300 group-hover:scale-[1.02] group-hover:opacity-100"
                      />
                      <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                      <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-[#0b0e18]/80 text-ayanami-highlight shadow-[0_12px_30px_-10px_rgba(0,0,0,0.9)] backdrop-blur-md transition group-hover:scale-105 group-hover:bg-[#0b0e18]">
                        <PlayIcon className="ml-0.5 h-5 w-5" />
                      </span>
                    </button>
                  )}

                  <p
                    className="mt-2.5 line-clamp-2 text-[10px] font-medium leading-4 text-slate-300"
                    title={videoState.video.title}
                  >
                    {videoState.video.title}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[8.5px] text-slate-600">
                    <span className="truncate">{videoState.video.channel ?? 'YouTube'}</span>
                    <a
                      href={videoState.video.watchUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 font-medium text-slate-500 transition hover:text-ayanami-highlight"
                    >
                      Watch on YouTube
                      <ExternalLinkIcon className="h-2.5 w-2.5" />
                    </a>
                  </div>
                  <p className="mt-1.5 truncate text-[8px] text-slate-700" title={videoState.video.query}>
                    Search: {videoState.video.query}
                  </p>
                </>
              ) : videoState?.status === 'error' ? (
                <div className="rounded-xl border border-red-400/15 bg-red-400/[0.035] px-3.5 py-3">
                  <p className="flex items-start gap-2 text-[9.5px] leading-4 text-red-100/75">
                    <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
                    {videoState.message}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void loadBenchmarkVideo(true)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 text-[9px] font-medium text-slate-200 transition hover:bg-white/[0.07]"
                    >
                      <RefreshIcon className="h-3 w-3" />
                      Retry
                    </button>
                    <a
                      href={videoState.searchUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[9px] font-medium text-slate-500 transition hover:text-ayanami-highlight"
                    >
                      Search YouTube
                      <ExternalLinkIcon className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5 py-4">
                  <p className="text-[9.5px] leading-4 text-slate-500">
                    No benchmark video matched this GPU and game yet.
                  </p>
                  <a
                    href={
                      videoState?.status === 'empty'
                        ? videoState.searchUrl
                        : `https://www.youtube.com/results?search_query=${encodeURIComponent(
                            `${hardware.gpu} ${game.title} benchmark`
                          )}`
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[9px] font-medium text-slate-400 transition hover:text-ayanami-highlight"
                  >
                    Search YouTube
                    <ExternalLinkIcon className="h-2.5 w-2.5" />
                  </a>
                </div>
              )}
            </div>

            <p className="mt-3 border-t border-white/[0.05] pt-3 text-[8.5px] leading-4 text-slate-600">
              Benchmark clips come from YouTube and play through youtube-nocookie.com.
            </p>
          </section>

          <section className="rounded-2xl border border-ayanami-line/90 bg-[#141820]/80 p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Your PC
                </p>
                <p className="mt-1 text-[8.5px] text-slate-600">{hardwareStaleNote}</p>
              </div>
              <button
                type="button"
                onClick={onRefreshHardware}
                disabled={hardwareBusy}
                aria-label="Refresh detected hardware"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.06] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-300 disabled:opacity-40"
              >
                <RefreshIcon className={`h-3.5 w-3.5 ${hardwareBusy ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="mt-2 divide-y divide-white/[0.045]">
              <HardwareRow
                icon={<CpuIcon className="h-3.5 w-3.5" />}
                label="CPU"
                value={hardware.cpu}
                detail={
                  [
                    hardware.cpuCores ? `${hardware.cpuCores} cores` : null,
                    hardware.cpuThreads ? `${hardware.cpuThreads} threads` : null,
                    hardware.cpuSpeedGhz ? `${hardware.cpuSpeedGhz} GHz` : null,
                    hardware.cpuBenchmark !== null
                      ? `CPU Mark ${formatScore(hardware.cpuBenchmark)}`
                      : null
                  ]
                    .filter(Boolean)
                    .join(' · ') || null
                }
              />
              <HardwareRow
                icon={<MonitorIcon className="h-3.5 w-3.5" />}
                label="GPU"
                value={hardware.gpu}
                detail={
                  [
                    hardware.gpuVramGb
                      ? `${formatGigabytes(hardware.gpuVramGb)} VRAM`
                      : null,
                    hardware.gpuBenchmark !== null
                      ? `G3D Mark ${formatScore(hardware.gpuBenchmark)}`
                      : null,
                    !hardware.gpuVramGb && hardware.gpuVendor ? hardware.gpuVendor : null
                  ]
                    .filter(Boolean)
                    .join(' · ') || null
                }
              />
              <HardwareRow
                icon={<MemoryIcon className="h-3.5 w-3.5" />}
                label="Memory"
                value={hardware.memoryGb > 0 ? `${formatGigabytes(hardware.memoryGb)} installed` : 'Not detected'}
                detail={null}
              />
              <HardwareRow
                icon={<HardDriveIcon className="h-3.5 w-3.5" />}
                label="Storage"
                value={
                  hardware.freeStorageGb !== null
                    ? `${formatGigabytes(hardware.freeStorageGb)} free${
                        hardware.storageDrive ? ` on ${hardware.storageDrive}` : ''
                      }`
                    : 'Not detected'
                }
                detail={
                  hardware.totalStorageGb !== null
                    ? `${formatGigabytes(hardware.totalStorageGb)} total${
                        hardware.storageDrive
                          ? ` · largest drive (${hardware.storageDrive})`
                          : ' · largest drive'
                      }`
                    : hardware.storageDrive
                      ? `Largest drive (${hardware.storageDrive})`
                      : null
                }
              />
            </div>

            <p className="mt-2 border-t border-white/[0.05] pt-3 text-[8.5px] leading-4 text-slate-600">
              Hardware is read locally by Ayanami. Nothing is uploaded or shared.
            </p>
          </section>

          <section className="rounded-2xl border border-ayanami-line/90 bg-[#141820]/80 p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Online status
              </p>
              <div className="flex items-center gap-1.5">
                {game.onlineMatchUrl && (
                  <a
                    href={game.onlineMatchUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open the online-fix.me listing"
                    title="Open the online-fix.me listing"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.06] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-300"
                  >
                    <ExternalLinkIcon className="h-3.5 w-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void handleOnlineRefresh()}
                  disabled={onlineBusy}
                  aria-label="Check online-fix.me now"
                  title="Check online-fix.me now"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.06] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-300 disabled:opacity-40"
                >
                  <RefreshIcon className={`h-3.5 w-3.5 ${onlineBusy ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
            <div className="mt-3">
              <OnlineStatusBadge
                game={game}
                checking={onlineBusy}
                size="md"
              />
            </div>
            <p className="mt-3 text-[10px] leading-5 text-slate-500">{onlineMeta.description}</p>

            {onlineError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.05] px-3 py-2.5 text-[9px] leading-4 text-red-200/85">
                <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
                <p>{onlineError}</p>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-3 text-[8.5px] text-slate-600">
              <span>
                {onlineBusy
                  ? 'Checking online-fix.me…'
                  : onlinePending
                    ? 'Not checked yet'
                    : `Checked ${formatDateTime(game.onlineCheckedAt)}`}
              </span>
              {game.onlineMatchUrl && (
                <a
                  href={game.onlineMatchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-slate-500 transition hover:text-ayanami-highlight"
                >
                  View listing
                </a>
              )}
            </div>
            <p className="mt-2 text-[8.5px] leading-4 text-slate-600">
              Ayanami checks online-fix.me only when a title is opened. Co-op, Multiplayer, or
              Online in the title also marks a title as online-capable. Network failures never
              create a false offline result.
            </p>
          </section>
        </aside>
      </div>
      )}
    </div>
  )
}
