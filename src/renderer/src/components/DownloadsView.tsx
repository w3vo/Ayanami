import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, JSX, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {
  DownloadPostprocessStatus,
  DownloadQueueItem,
  DownloadSettings,
  DownloadStatus,
  DownloadsSnapshot,
  ReleaseType
} from '@shared/types'
import { getErrorMessage } from '../lib/errors'
import { formatBytes, formatCount } from '../lib/format'
import { PageHeader } from './PageHeader'
import { Spinner } from './Spinner'
import type { ToastTone } from './Toast'
import {
  AlertCircleIcon,
  ArchiveIcon,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  DownloadsIcon,
  FolderIcon,
  InfoIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
  WifiIcon
} from './Icons'

interface DownloadsViewProps {
  onToast: (message: string, tone?: ToastTone) => void
}

const STATUS_META: Record<
  DownloadStatus,
  { label: string; tone: string; dot: string; bar: string }
> = {
  queued: {
    label: 'Queued',
    tone: 'text-slate-400',
    dot: 'bg-slate-500',
    bar: 'from-slate-500/60 to-slate-400/50'
  },
  downloading: {
    label: 'Downloading',
    tone: 'text-ayanami-highlight',
    dot: 'bg-ayanami-accent shadow-[0_0_8px_rgba(135,156,181,0.8)]',
    bar: 'from-[#a8c5e5] to-[#879cb5]'
  },
  paused: {
    label: 'Paused',
    tone: 'text-amber-300/85',
    dot: 'bg-amber-400',
    bar: 'from-amber-400/70 to-amber-300/60'
  },
  complete: {
    label: 'Complete',
    tone: 'text-emerald-300/85',
    dot: 'bg-emerald-400',
    bar: 'from-emerald-400/70 to-emerald-300/80'
  },
  error: {
    label: 'Error',
    tone: 'text-red-300/90',
    dot: 'bg-red-400',
    bar: 'from-red-400/70 to-red-300/60'
  }
}

const RELEASE_LABELS: Record<ReleaseType, string> = {
  preinstalled: 'Pre-installed',
  repack: 'Repack'
}

function formatSpeed(bytesPerSecond: number): string {
  return bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '—'
}

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function postprocessTone(status: DownloadPostprocessStatus): string {
  if (status === 'error') return 'text-red-300/90'
  if (status === 'ready') return 'text-emerald-300/85'
  if (status === 'extracting' || status === 'installing' || status === 'pending') {
    return 'text-ayanami-highlight'
  }
  return 'text-slate-500'
}

function isPostprocessBusy(status: DownloadPostprocessStatus): boolean {
  return status === 'pending' || status === 'extracting' || status === 'installing'
}

function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'accent' }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8.5px] font-medium ${
        tone === 'accent'
          ? 'border-ayanami-accent/25 bg-ayanami-accent/[0.08] text-ayanami-highlight'
          : 'border-white/[0.06] bg-white/[0.025] text-slate-500'
      }`}
    >
      {children}
    </span>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  tone = 'default',
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'danger' | 'accent'
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition disabled:cursor-wait disabled:opacity-40 ${
        tone === 'danger'
          ? 'border-red-400/15 text-red-300/70 hover:border-red-400/30 hover:bg-red-400/[0.08] hover:text-red-200'
          : tone === 'accent'
            ? 'border-ayanami-accent/20 bg-ayanami-accent/[0.07] text-ayanami-highlight hover:border-ayanami-accent/35 hover:bg-ayanami-accent/[0.12]'
            : 'border-white/[0.06] text-slate-500 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function StatCard({
  label,
  value,
  detail,
  icon
}: {
  label: string
  value: string
  detail: string
  icon: ReactNode
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-ayanami-line/80 bg-[#12151b]/80 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[8.5px] font-semibold uppercase tracking-[0.22em] text-slate-600">
          {label}
        </p>
        <span className="text-slate-600">{icon}</span>
      </div>
      <p className="mt-2.5 font-display text-[21px] font-semibold tabular-nums tracking-[-0.02em] text-slate-100">
        {value}
      </p>
      <p className="mt-1 text-[9px] text-slate-600">{detail}</p>
    </div>
  )
}

function DownloadCard({
  item,
  busy,
  onPause,
  onResume,
  onRemove,
  onOpenFolder,
  onRetryPostprocess
}: {
  item: DownloadQueueItem
  busy: boolean
  onPause: () => void
  onResume: () => void
  onRemove: () => void
  onOpenFolder: () => void
  onRetryPostprocess: () => void
}): JSX.Element {
  const status = STATUS_META[item.status]
  const percent = Math.max(0, Math.min(100, item.progress))
  const total = item.totalBytes
  const transferLine =
    total && total > 0
      ? `${formatBytes(item.downloadedBytes)} of ${formatBytes(total)}`
      : item.downloadedBytes > 0
        ? `${formatBytes(item.downloadedBytes)} downloaded`
        : 'Waiting for size…'
  const postprocessVisible =
    item.status === 'complete' && item.postprocessStatus !== 'idle'

  return (
    <article className="group rounded-2xl border border-ayanami-line/80 bg-gradient-to-b from-[#141820] to-[#11141a] p-4 transition hover:border-[#313846] sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${
            item.status === 'error'
              ? 'border-red-400/20 bg-red-400/[0.07] text-red-300/80'
              : item.status === 'complete'
                ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300/80'
                : 'border-ayanami-accent/20 bg-ayanami-accent/[0.07] text-ayanami-accent'
          }`}
        >
          {item.downloadType === 'torrent' ? (
            <WifiIcon className="h-5 w-5" />
          ) : (
            <DownloadIcon className="h-5 w-5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="max-w-full truncate text-[12.5px] font-semibold text-slate-100">
              {item.title}
            </h3>
            <Badge>{item.downloadType === 'torrent' ? 'Torrent' : 'HTTP'}</Badge>
            <Badge tone={item.releaseType === 'repack' ? 'accent' : 'default'}>
              {item.releaseType === 'repack' ? (
                <PlayIcon className="h-2.5 w-2.5" />
              ) : (
                <ArchiveIcon className="h-2.5 w-2.5" />
              )}
              {RELEASE_LABELS[item.releaseType]}
            </Badge>
          </div>
          <p className="mt-1 truncate text-[9px] text-slate-600" title={item.filePath ?? item.savePath}>
            {item.filePath ?? item.savePath}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[9px] font-semibold ${status.tone}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>

          <div className="flex items-center gap-1.5">
            {(item.status === 'downloading' || item.status === 'queued') && (
              <IconButton label="Pause download" onClick={onPause} disabled={busy}>
                <PauseIcon className="h-3.5 w-3.5" />
              </IconButton>
            )}
            {(item.status === 'paused' || item.status === 'error') && (
              <IconButton label="Resume download" onClick={onResume} disabled={busy} tone="accent">
                <PlayIcon className="h-3.5 w-3.5" />
              </IconButton>
            )}
            {item.status === 'complete' && (
              <IconButton label="Open download folder" onClick={onOpenFolder} disabled={busy}>
                <FolderIcon className="h-3.5 w-3.5" />
              </IconButton>
            )}
            {item.status === 'error' && (
              <IconButton label="Open download folder" onClick={onOpenFolder} disabled={busy}>
                <FolderIcon className="h-3.5 w-3.5" />
              </IconButton>
            )}
            {item.status === 'complete' && item.postprocessStatus === 'error' && (
              <IconButton
                label="Retry extraction or installer"
                onClick={onRetryPostprocess}
                disabled={busy}
              >
                <RefreshIcon className="h-3.5 w-3.5" />
              </IconButton>
            )}
            <IconButton label="Remove download" onClick={onRemove} disabled={busy} tone="danger">
              <TrashIcon className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ${status.bar} ${
              item.status === 'downloading' ? 'progress-shimmer' : ''
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="w-10 text-right text-[9.5px] font-medium tabular-nums text-slate-400">
          {percent.toFixed(item.status === 'downloading' ? 1 : 0)}%
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[9px] sm:grid-cols-4">
        <div>
          <p className="text-[8px] uppercase tracking-[0.16em] text-slate-600">Transferred</p>
          <p className="mt-0.5 truncate tabular-nums text-slate-400">{transferLine}</p>
        </div>
        <div>
          <p className="text-[8px] uppercase tracking-[0.16em] text-slate-600">Download</p>
          <p className="mt-0.5 tabular-nums text-ayanami-highlight/80">
            {formatSpeed(item.downloadSpeed)}
          </p>
        </div>
        <div>
          <p className="text-[8px] uppercase tracking-[0.16em] text-slate-600">Upload</p>
          <p className="mt-0.5 tabular-nums text-slate-400">{formatSpeed(item.uploadSpeed)}</p>
        </div>
        <div>
          <p className="text-[8px] uppercase tracking-[0.16em] text-slate-600">ETA</p>
          <p className="mt-0.5 tabular-nums text-slate-400">
            {item.status === 'downloading' ? formatEta(item.etaSeconds) : '—'}
          </p>
        </div>
      </div>

      {postprocessVisible && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/[0.055] bg-white/[0.018] px-3 py-2.5">
          {isPostprocessBusy(item.postprocessStatus) ? (
            <Spinner className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ayanami-accent" />
          ) : item.postprocessStatus === 'error' ? (
            <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
          ) : (
            <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300/80" />
          )}
          <p className={`text-[9.5px] leading-5 ${postprocessTone(item.postprocessStatus)}`}>
            {item.postprocessMessage ?? 'Post-processing…'}
          </p>
        </div>
      )}

      {item.status === 'error' && item.errorMessage && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-400/15 bg-red-400/[0.04] px-3 py-2.5">
          <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
          <p className="text-[9.5px] leading-5 text-red-200/80">{item.errorMessage}</p>
        </div>
      )}
    </article>
  )
}

function FolderRow({
  label,
  description,
  path,
  busy,
  onChange
}: {
  label: string
  description: string
  path: string
  busy: boolean
  onChange: () => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/[0.055] bg-[#0d1016]/70 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {label}
        </p>
        <p className="mt-1 truncate text-[10px] text-slate-300" title={path}>
          {path}
        </p>
        <p className="mt-0.5 text-[8.5px] text-slate-600">{description}</p>
      </div>
      <button
        type="button"
        onClick={onChange}
        disabled={busy}
        className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[9.5px] font-medium text-slate-300 transition hover:border-ayanami-accent/30 hover:bg-ayanami-accent/[0.06] hover:text-white disabled:cursor-wait disabled:opacity-50 sm:self-auto"
      >
        {busy ? <Spinner className="h-3 w-3" /> : <FolderIcon className="h-3 w-3" />}
        Change
      </button>
    </div>
  )
}

function AddDownloadModal({
  settings,
  onClose,
  onToast
}: {
  settings: DownloadSettings
  onClose: () => void
  onToast: (message: string, tone?: ToastTone) => void
}): JSX.Element {
  const [uri, setUri] = useState('')
  const [torrentPath, setTorrentPath] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [releaseType, setReleaseType] = useState<ReleaseType>('preinstalled')
  const [busy, setBusy] = useState(false)
  const [pickerBusy, setPickerBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const torrentName = torrentPath ? (torrentPath.split(/[\\/]/).pop() ?? torrentPath) : null

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onClose])

  const handlePickTorrent = async (): Promise<void> => {
    if (busy || pickerBusy) return
    setPickerBusy(true)
    setError(null)
    try {
      const selected = await window.ayanami.pickTorrentFile()
      if (!selected) return
      setTorrentPath(selected)
      setUri('')
    } catch (pickError) {
      setError(getErrorMessage(pickError))
    } finally {
      setPickerBusy(false)
    }
  }

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return

    const trimmedUri = uri.trim()
    if (!trimmedUri && !torrentPath) {
      setError('Paste a magnet link or direct download URL, or choose a .torrent file.')
      return
    }
    if (!torrentPath && !/^(magnet:|https?:\/\/)/i.test(trimmedUri)) {
      setError('Only magnet links, http(s) download URLs, and local .torrent files are supported.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await window.ayanami.addDownload({
        ...(torrentPath ? { torrentPath } : { uri: trimmedUri }),
        releaseType,
        ...(title.trim() ? { title: title.trim() } : {})
      })
      if (!result.item) {
        onToast('The download page opened in Ayanami.', 'info')
        onClose()
        return
      }
      onToast(
        result.alreadyQueued
          ? `“${result.item.title}” is already in the download queue.`
          : `“${result.item.title}” was added to Downloads.`,
        result.alreadyQueued ? 'info' : 'success'
      )
      onClose()
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="overlay-enter absolute inset-0 bg-[#05070b]/80 backdrop-blur-md"
        onClick={() => {
          if (!busy) onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-download-title"
        className="modal-card relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#12151b] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.04)]"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ayanami-accent/40 to-transparent" />
        <div className="flex items-start gap-4 px-6 pb-4 pt-6">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-ayanami-accent/75">
              New transfer
            </p>
            <h2
              id="add-download-title"
              className="mt-2 font-display text-[22px] font-semibold tracking-[-0.025em] text-white"
            >
              Add a download
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              Magnet links, direct file URLs, and local .torrent files join the same queue.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close add download dialog"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200 disabled:opacity-40"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {error && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-3.5 py-3 text-[10.5px] leading-5 text-red-200/85">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <p>{error}</p>
            </div>
          )}

          <label className="block">
            <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Link or magnet
            </span>
            <textarea
              value={uri}
              onChange={(event) => {
                setUri(event.target.value)
                if (event.target.value.trim()) setTorrentPath(null)
              }}
              rows={3}
              autoFocus
              spellCheck={false}
              placeholder="magnet:?xt=urn:btih:…  or  https://example.com/game.zip"
              className="w-full resize-none rounded-xl border border-white/[0.07] bg-[#0d1016] px-3.5 py-3 font-mono text-[10.5px] leading-5 text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-ayanami-accent/40 focus:ring-2 focus:ring-ayanami-accent/[0.08]"
            />
          </label>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handlePickTorrent()}
              disabled={busy || pickerBusy}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[9.5px] font-medium text-slate-300 transition hover:border-ayanami-accent/30 hover:bg-ayanami-accent/[0.06] hover:text-white disabled:cursor-wait disabled:opacity-50"
            >
              {pickerBusy ? <Spinner className="h-3 w-3" /> : <ArchiveIcon className="h-3 w-3" />}
              {torrentPath ? 'Choose another .torrent' : 'Choose .torrent file'}
            </button>
            {torrentPath && (
              <>
                <span
                  className="min-w-0 flex-1 truncate text-[9.5px] text-slate-400"
                  title={torrentPath}
                >
                  {torrentName}
                </span>
                <button
                  type="button"
                  onClick={() => setTorrentPath(null)}
                  disabled={busy}
                  aria-label="Remove selected torrent file"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.06] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200 disabled:opacity-40"
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              </>
            )}
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Title <span className="font-normal normal-case tracking-normal text-slate-600">(optional)</span>
            </span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={240}
              placeholder="Detected from the link when left empty"
              className="h-10 w-full rounded-xl border border-white/[0.07] bg-[#0d1016] px-3.5 text-[11px] text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-ayanami-accent/40 focus:ring-2 focus:ring-ayanami-accent/[0.08]"
            />
          </label>

          <div className="mt-4">
            <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Release type
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    value: 'preinstalled' as ReleaseType,
                    label: 'Pre-installed',
                    detail: 'Extract .zip / .rar into your Games folder and delete the archive.'
                  },
                  {
                    value: 'repack' as ReleaseType,
                    label: 'Repack',
                    detail: 'Open the setup .exe automatically when the download finishes.'
                  }
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setReleaseType(option.value)}
                  aria-pressed={releaseType === option.value}
                  className={`rounded-xl border p-3 text-left transition ${
                    releaseType === option.value
                      ? 'border-ayanami-accent/35 bg-ayanami-accent/[0.08]'
                      : 'border-white/[0.06] bg-white/[0.018] hover:border-white/[0.12]'
                  }`}
                >
                  <span className="flex items-center gap-2 text-[10.5px] font-semibold text-slate-200">
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                        releaseType === option.value
                          ? 'border-ayanami-accent bg-ayanami-accent text-[#0b0e18]'
                          : 'border-white/[0.14] text-transparent'
                      }`}
                    >
                      <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                    {option.label}
                  </span>
                  <span className="mt-1.5 block pl-6 text-[9px] leading-4 text-slate-500">
                    {option.detail}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.055] bg-white/[0.018] px-3.5 py-3">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <p className="text-[9px] leading-5 text-slate-500">
              Files are saved to <span className="text-slate-400">{settings.downloadDirectory}</span>.
              Pre-installed archives are unpacked into{' '}
              <span className="text-slate-400">{settings.gamesDirectory}</span> after download.
            </p>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2.5 border-t border-white/[0.055] pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-[10.5px] font-medium text-slate-300 transition hover:bg-white/[0.06] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#a8c5e5] via-[#9db2ca] to-[#879cb5] px-4 text-[10.5px] font-semibold text-[#0b0e18] shadow-[0_12px_30px_-14px_rgba(135,156,181,0.65)] transition hover:brightness-105 active:scale-[0.985] disabled:cursor-wait disabled:opacity-70"
            >
              {busy ? <Spinner className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
              {busy ? 'Adding…' : 'Start download'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

function DownloadSkeleton(): JSX.Element {
  return (
    <div className="mt-5 space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-ayanami-line/80 bg-[#12151b] p-4 sm:p-5"
        >
          <div className="flex items-center gap-3">
            <div className="skeleton h-11 w-11 rounded-xl" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-2/5 rounded-full" />
              <div className="skeleton h-2.5 w-3/5 rounded-full" />
            </div>
          </div>
          <div className="skeleton mt-4 h-1.5 w-full rounded-full" />
          <div className="mt-4 grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((__, cell) => (
              <div key={cell} className="space-y-1.5">
                <div className="skeleton h-2 w-12 rounded-full" />
                <div className="skeleton h-2.5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function DownloadsView({ onToast }: DownloadsViewProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<DownloadsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [settingsBusy, setSettingsBusy] = useState<'downloads' | 'games' | null>(null)

  useEffect(() => {
    let active = true
    window.ayanami
      .listDownloads()
      .then((result) => {
        if (!active) return
        setSnapshot(result)
        setLoadError(null)
      })
      .catch((error) => {
        if (!active) return
        setLoadError(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    const unsubscribe = window.ayanami.onDownloadUpdated((update) => {
      setSnapshot((current) => {
        if (!current) return current
        const nextItem = update.item
        const items = nextItem
          ? current.items.some((item) => item.id === nextItem.id)
            ? current.items.map((item) => (item.id === nextItem.id ? nextItem : item))
            : [nextItem, ...current.items]
          : current.items.filter((item) => item.id !== update.id)
        return { ...current, items: items.sort((first, second) => second.id - first.id) }
      })
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const items = snapshot?.items ?? []
  const settings = snapshot?.settings ?? null

  const stats = useMemo(() => {
    let downloadSpeed = 0
    let uploadSpeed = 0
    let activeCount = 0
    let queuedCount = 0
    let completeCount = 0
    for (const item of items) {
      downloadSpeed += item.downloadSpeed
      uploadSpeed += item.uploadSpeed
      if (item.status === 'downloading') activeCount += 1
      if (item.status === 'queued') queuedCount += 1
      if (item.status === 'complete') completeCount += 1
    }
    return { downloadSpeed, uploadSpeed, activeCount, queuedCount, completeCount }
  }, [items])

  const runAction = useCallback(
    async (id: number, action: () => Promise<unknown>, successMessage?: string): Promise<void> => {
      setBusyIds((previous) => new Set(previous).add(id))
      try {
        await action()
        if (successMessage) onToast(successMessage, 'success')
      } catch (error) {
        onToast(getErrorMessage(error), 'error')
      } finally {
        setBusyIds((previous) => {
          const next = new Set(previous)
          next.delete(id)
          return next
        })
      }
    },
    [onToast]
  )

  const handlePause = useCallback(
    (item: DownloadQueueItem): void => {
      void runAction(item.id, () => window.ayanami.pauseDownload(item.id))
    },
    [runAction]
  )

  const handleResume = useCallback(
    (item: DownloadQueueItem): void => {
      void runAction(item.id, () => window.ayanami.resumeDownload(item.id))
    },
    [runAction]
  )

  const handleRemove = useCallback(
    (item: DownloadQueueItem): void => {
      const confirmed = window.confirm(
        `Remove “${item.title}” from Downloads?${item.status === 'complete' ? ' The downloaded files stay on disk.' : ' Incomplete files will be deleted.'}`
      )
      if (!confirmed) return
      void runAction(item.id, () => window.ayanami.removeDownload(item.id))
    },
    [runAction]
  )

  const handleOpenFolder = useCallback(
    (item: DownloadQueueItem): void => {
      void runAction(item.id, () => window.ayanami.openDownloadFolder(item.id))
    },
    [runAction]
  )

  const handleRetryPostprocess = useCallback(
    (item: DownloadQueueItem): void => {
      void runAction(
        item.id,
        () => window.ayanami.retryDownloadPostprocess(item.id),
        'Retrying post-processing…'
      )
    },
    [runAction]
  )

  const handlePickFolder = useCallback(
    async (kind: 'downloads' | 'games'): Promise<void> => {
      if (settingsBusy) return
      setSettingsBusy(kind)
      try {
        const selected = await window.ayanami.pickDownloadFolder(kind)
        if (!selected) return
        const updated = await window.ayanami.updateDownloadSettings(
          kind === 'games' ? { gamesDirectory: selected } : { downloadDirectory: selected }
        )
        setSnapshot((current) => (current ? { ...current, settings: updated } : current))
        onToast(kind === 'games' ? 'Games folder updated.' : 'Downloads folder updated.', 'success')
      } catch (error) {
        onToast(getErrorMessage(error), 'error')
      } finally {
        setSettingsBusy(null)
      }
    },
    [onToast, settingsBusy]
  )

  return (
    <>
      <PageHeader
        eyebrow="Transfers"
        title="Downloads"
        description="A quiet queue for torrents, direct links, and everything that comes after."
        aside={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-[#a8c5e5] via-[#9db2ca] to-[#879cb5] px-4 text-[11.5px] font-semibold text-[#0b0e18] shadow-[0_14px_35px_-14px_rgba(135,156,181,0.6)] transition hover:brightness-105 active:scale-[0.985]"
          >
            <PlusIcon className="h-4 w-4" />
            Add download
          </button>
        }
      />

      {loadError && !snapshot && (
        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-400/15 bg-red-400/[0.035] px-4 py-3.5">
          <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <div>
            <p className="text-[10.5px] font-medium text-red-100/85">Downloads could not be loaded</p>
            <p className="mt-0.5 text-[9.5px] leading-4 text-red-100/60">{loadError}</p>
          </div>
        </div>
      )}

      <div className="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Active"
          value={String(stats.activeCount)}
          detail={
            stats.queuedCount > 0 ? `${formatCount(stats.queuedCount, 'transfer')} queued` : 'Two transfers run at once'
          }
          icon={<DownloadsIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Download"
          value={formatSpeed(stats.downloadSpeed)}
          detail="Combined across active transfers"
          icon={<DownloadIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Upload"
          value={formatSpeed(stats.uploadSpeed)}
          detail="Torrent seeding and peer traffic"
          icon={<WifiIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Completed"
          value={String(stats.completeCount)}
          detail={
            stats.completeCount > 0 ? 'Files ready or post-processed' : 'Finished transfers land here'
          }
          icon={<CheckIcon className="h-4 w-4" />}
        />
      </div>

      {settings && (
        <section className="mt-4 rounded-2xl border border-ayanami-line/80 bg-[#12151b]/70 p-3">
          <div className="mb-2.5 flex items-center gap-2 px-0.5">
            <FolderIcon className="h-3.5 w-3.5 text-ayanami-accent/70" />
            <p className="text-[8.5px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Folders
            </p>
            <span className="ml-auto text-[8.5px] text-slate-600">
              Post-download rules apply automatically
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            <FolderRow
              label="Downloads"
              description="Archives, installers, and torrent payloads are saved here."
              path={settings.downloadDirectory}
              busy={settingsBusy === 'downloads'}
              onChange={() => void handlePickFolder('downloads')}
            />
            <FolderRow
              label="Games"
              description="Pre-installed archives are extracted into this folder."
              path={settings.gamesDirectory}
              busy={settingsBusy === 'games'}
              onChange={() => void handlePickFolder('games')}
            />
          </div>
        </section>
      )}

      <div className="mb-4 mt-7 flex items-center justify-between">
        <p className="text-[9px] font-semibold uppercase tracking-[0.26em] text-slate-500">
          Queue
        </p>
        <p className="text-[10px] tabular-nums text-slate-600">
          {items.length > 0 ? formatCount(items.length, 'transfer') : 'Empty'}
        </p>
      </div>

      {loading && !snapshot ? (
        <DownloadSkeleton />
      ) : items.length === 0 ? (
        <section className="relative overflow-hidden rounded-[26px] border border-dashed border-[#2b313c] bg-[#11141a]/55 px-6 py-14 text-center">
          <div className="pointer-events-none absolute left-1/2 top-4 h-64 w-96 -translate-x-1/2 rounded-full bg-ayanami-accent/[0.07] blur-3xl" />
          <div className="relative">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-ayanami-accent/20 bg-ayanami-accent/[0.07] text-ayanami-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <DownloadsIcon className="h-6 w-6" />
            </span>
            <h2 className="mt-5 font-display text-xl font-semibold tracking-[-0.02em] text-white">
              No transfers yet
            </h2>
            <p className="mx-auto mt-2.5 max-w-md text-[11.5px] leading-6 text-slate-400">
              Paste a magnet link or a direct download URL. Ayanami keeps the queue moving,
              unpacks pre-installed archives, and opens repack installers when they finish.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-[#a8c5e5] via-[#9db2ca] to-[#879cb5] px-4 text-[11.5px] font-semibold text-[#0b0e18] shadow-[0_12px_30px_-14px_rgba(135,156,181,0.65)] transition hover:brightness-105 active:scale-[0.985]"
              >
                <PlusIcon className="h-4 w-4" />
                Add your first download
              </button>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[9px] text-slate-600">
              <Badge>Torrent + magnet</Badge>
              <Badge>4-part HTTP</Badge>
              <Badge>Auto-extract</Badge>
              <Badge>Installer launch</Badge>
            </div>
          </div>
        </section>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <DownloadCard
              key={item.id}
              item={item}
              busy={busyIds.has(item.id)}
              onPause={() => handlePause(item)}
              onResume={() => handleResume(item)}
              onRemove={() => handleRemove(item)}
              onOpenFolder={() => handleOpenFolder(item)}
              onRetryPostprocess={() => handleRetryPostprocess(item)}
            />
          ))}
        </div>
      )}

      {addOpen && settings && (
        <AddDownloadModal
          settings={settings}
          onClose={() => setAddOpen(false)}
          onToast={onToast}
        />
      )}
    </>
  )
}
