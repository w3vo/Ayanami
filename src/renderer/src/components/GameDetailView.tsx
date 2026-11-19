import { useEffect, useId, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import type { DriveStatus, Game, SaveBackup } from '@shared/types'
import { createPlaceholderCover } from '@shared/placeholderCover'
import type { ToastTone } from './Toast'
import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatLastPlayed,
  formatPlaytime,
  formatTime
} from '../lib/format'
import { getErrorMessage } from '../lib/errors'
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  CloudUploadIcon,
  FolderIcon,
  GoogleDriveIcon,
  InfoIcon,
  PlayIcon,
  RefreshIcon,
  RestoreIcon,
  ShieldIcon
} from './Icons'
import { Spinner } from './Spinner'

interface GameDetailViewProps {
  game: Game
  drive: DriveStatus
  isLaunching: boolean
  onBack: () => void
  onLaunch: (game: Game) => void
  onGameUpdated: (game: Game) => void
  onOpenSettings: () => void
  onToast: (message: string, tone?: ToastTone) => void
}

function driveBadge(drive: DriveStatus): { label: string; className: string; dot: string } {
  if (drive.connected) {
    return {
      label: 'Connected',
      className: 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300',
      dot: 'bg-emerald-400'
    }
  }
  if (drive.configured) {
    return {
      label: 'Not connected',
      className: 'border-amber-400/20 bg-amber-400/[0.07] text-amber-300/90',
      dot: 'bg-amber-400'
    }
  }
  return {
    label: 'Not set up',
    className: 'border-white/[0.07] bg-white/[0.03] text-slate-400',
    dot: 'bg-slate-500'
  }
}

function BackupSkeleton(): JSX.Element {
  return (
    <div className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] bg-white/[0.015]">
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-3.5 py-3.5">
          <div className="skeleton h-8 w-8 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-2.5 w-36 rounded-full" />
            <div className="skeleton h-2 w-52 rounded-full" />
          </div>
          <div className="skeleton h-7 w-16 rounded-md" />
        </div>
      ))}
    </div>
  )
}

function RestoreDialog({
  game,
  backup,
  restoring,
  error,
  onClose,
  onConfirm
}: {
  game: Game
  backup: SaveBackup
  restoring: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}): JSX.Element {
  const titleId = useId()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !restoring) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, restoring])

  const blockedByRunningGame = game.isRunning
  const hasSaveFolder = Boolean(game.saveFolderPath)

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6">
      <div
        className="overlay-enter absolute inset-0 bg-[#05070b]/82 backdrop-blur-md"
        onClick={() => {
          if (!restoring) onClose()
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-card relative w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.09] bg-[#12151b] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.04)]"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ayanami-accent/40 to-transparent" />

        <div className="flex items-start gap-3.5 px-6 pb-5 pt-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ayanami-accent/25 bg-ayanami-accent/[0.09] text-ayanami-highlight">
            <RestoreIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-ayanami-accent/75">
              Restore backup
            </p>
            <h2
              id={titleId}
              className="mt-1.5 font-display text-[19px] font-semibold tracking-[-0.02em] text-white"
            >
              Roll back {game.title}?
            </h2>
            <p className="mt-1 text-[10.5px] leading-5 text-slate-500">
              {formatDateTime(backup.createdAt)} · {formatBytes(backup.sizeBytes)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={restoring}
            aria-label="Close restore dialog"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200 disabled:opacity-40"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 border-t border-white/[0.055] px-6 py-5">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <FolderIcon className="h-3.5 w-3.5" />
              Restore destination
            </div>
            <p className="mt-2 break-all font-mono text-[9.5px] leading-5 text-slate-400">
              {game.saveFolderPath ?? 'No save folder selected'}
            </p>
          </div>

          <p className="text-[10.5px] leading-5 text-slate-500">
            The archive will be extracted into this folder. Files with matching names are
            overwritten; other files are left alone.
          </p>

          {(blockedByRunningGame || !hasSaveFolder) && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/15 bg-amber-400/[0.045] px-3.5 py-3 text-[10.5px] leading-5 text-amber-100/75">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/80" />
              <p>
                {blockedByRunningGame
                  ? 'Close the game before restoring a backup so it cannot overwrite the restored files on exit.'
                  : 'Choose a save folder on this page before restoring a backup.'}
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-400/20 bg-red-400/[0.05] px-3.5 py-3 text-[10.5px] leading-5 text-red-200/85">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.055] bg-[#101319] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={restoring}
            className="h-9 rounded-lg px-3.5 text-[11px] font-medium text-slate-400 transition hover:text-slate-200 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={restoring || blockedByRunningGame || !hasSaveFolder}
            className="flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#9db2ca] to-[#879cb5] px-4 text-[11px] font-semibold text-[#0b0e18] shadow-[0_10px_26px_-12px_rgba(135,156,181,0.55)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {restoring ? <Spinner className="h-3.5 w-3.5" /> : <RestoreIcon className="h-3.5 w-3.5" />}
            {restoring ? 'Restoring…' : 'Restore backup'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function GameDetailView({
  game,
  drive,
  isLaunching,
  onBack,
  onLaunch,
  onGameUpdated,
  onOpenSettings,
  onToast
}: GameDetailViewProps): JSX.Element {
  const fallbackCover = useMemo(() => createPlaceholderCover(game.title), [game.title])
  const [coverFailed, setCoverFailed] = useState(false)
  const [heroFailed, setHeroFailed] = useState(false)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [scheduledFor, setScheduledFor] = useState<string | null>(null)
  const [backups, setBackups] = useState<SaveBackup[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [backupsError, setBackupsError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [restoreTarget, setRestoreTarget] = useState<SaveBackup | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const coverUrl = game.coverUrl && !coverFailed ? game.coverUrl : fallbackCover
  const backdropUrl =
    game.heroUrl && !heroFailed ? game.heroUrl : game.coverUrl && !coverFailed ? game.coverUrl : fallbackCover
  const driveState = driveBadge(drive)
  const hasSaveFolder = Boolean(game.saveFolderPath)
  const canSync = drive.connected && hasSaveFolder && !game.isRunning && !syncing

  useEffect(() => {
    setCoverFailed(false)
    setHeroFailed(false)
    setSettingsError(null)
    setSyncing(false)
    setSyncError(null)
    setScheduledFor(null)
    setBackups([])
    setBackupsError(null)
    setRestoreTarget(null)
    setRestoreError(null)
  }, [game.id])

  useEffect(() => {
    if (!drive.connected) {
      setBackups([])
      setBackupsError(null)
      setBackupsLoading(false)
      return
    }

    let active = true
    setBackupsLoading(true)
    setBackupsError(null)

    window.ayanami
      .listSaveBackups(game.id)
      .then((loaded) => {
        if (active) setBackups(loaded)
      })
      .catch((error: unknown) => {
        if (active) setBackupsError(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setBackupsLoading(false)
      })

    return () => {
      active = false
    }
  }, [drive.connected, game.id, reloadKey])

  useEffect(() => {
    return window.ayanami.onSaveSyncChanged((event) => {
      if (event.gameId !== game.id) return

      if (event.phase === 'scheduled') {
        setScheduledFor(event.scheduledFor ?? null)
        setSyncError(null)
        return
      }
      if (event.phase === 'syncing') {
        setSyncing(true)
        setScheduledFor(null)
        setSyncError(null)
        return
      }
      if (event.phase === 'synced') {
        setSyncing(false)
        setScheduledFor(null)
        if (event.game) onGameUpdated(event.game)
        if (event.backups) setBackups(event.backups)
        return
      }
      if (event.phase === 'canceled') {
        setScheduledFor(null)
        return
      }
      if (event.phase === 'error') {
        setSyncing(false)
        setScheduledFor(null)
        setSyncError(event.message ?? 'The cloud backup could not be completed.')
      }
    })
  }, [game.id, onGameUpdated])

  const handlePickSaveFolder = async (): Promise<void> => {
    setPickingFolder(true)
    setSettingsError(null)
    try {
      const chosen = await window.ayanami.pickSaveFolder()
      if (!chosen) return
      const updated = await window.ayanami.updateGame(game.id, {
        saveFolderPath: chosen,
        autoSyncEnabled: game.autoSyncEnabled
      })
      onGameUpdated(updated)
      onToast('Save folder updated.', 'success')
    } catch (error) {
      setSettingsError(getErrorMessage(error))
    } finally {
      setPickingFolder(false)
    }
  }

  const handleClearSaveFolder = async (): Promise<void> => {
    setSettingsBusy(true)
    setSettingsError(null)
    try {
      const updated = await window.ayanami.updateGame(game.id, {
        saveFolderPath: null,
        autoSyncEnabled: false
      })
      onGameUpdated(updated)
      setScheduledFor(null)
      onToast('Save folder removed. Cloud backups are unchanged.', 'info')
    } catch (error) {
      setSettingsError(getErrorMessage(error))
    } finally {
      setSettingsBusy(false)
    }
  }

  const handleToggleAutoSync = async (): Promise<void> => {
    if (!hasSaveFolder || settingsBusy) return
    setSettingsBusy(true)
    setSettingsError(null)
    try {
      const updated = await window.ayanami.updateGame(game.id, {
        saveFolderPath: game.saveFolderPath,
        autoSyncEnabled: !game.autoSyncEnabled
      })
      onGameUpdated(updated)
    } catch (error) {
      setSettingsError(getErrorMessage(error))
    } finally {
      setSettingsBusy(false)
    }
  }

  const handleSyncNow = async (): Promise<void> => {
    if (!canSync) return
    setSyncing(true)
    setSyncError(null)
    try {
      const result = await window.ayanami.syncGameSaves(game.id)
      setBackups(result.backups)
      onGameUpdated(result.game)
      setScheduledFor(null)
      onToast(`“${game.title}” was backed up to Google Drive.`, 'success')
    } catch (error) {
      setSyncError(getErrorMessage(error))
    } finally {
      setSyncing(false)
    }
  }

  const handleRestore = async (): Promise<void> => {
    if (!restoreTarget || restoring) return
    setRestoring(true)
    setRestoreError(null)
    try {
      const result = await window.ayanami.restoreSaveBackup(game.id, restoreTarget.id)
      onGameUpdated(result.game)
      setRestoreTarget(null)
      onToast(
        `Restored ${formatCount(result.restoredFiles, 'file')} into ${game.title}’s save folder.`,
        'success'
      )
    } catch (error) {
      setRestoreError(getErrorMessage(error))
    } finally {
      setRestoring(false)
    }
  }

  const syncHint = !drive.connected
    ? 'Connect Google Drive to upload or restore saves.'
    : !hasSaveFolder
      ? 'Choose this game’s save folder to enable cloud backups.'
      : game.isRunning
        ? 'Close the game before syncing so the backup captures a clean save state.'
        : 'Manual backups upload a fresh archive and keep the newest three versions.'

  return (
    <>
      <div className="step-enter">
        <button
          type="button"
          onClick={onBack}
          className="group inline-flex items-center gap-2 rounded-lg px-1 py-1 text-[11px] font-medium text-slate-500 transition hover:text-slate-200"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to library
        </button>

        <section className="relative mt-4 overflow-hidden rounded-[26px] border border-white/[0.07] bg-[#12161d] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.95)]">
          <div className="pointer-events-none absolute inset-0">
            <img
              src={backdropUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
              onError={() => setHeroFailed(true)}
              className="h-full w-full scale-105 object-cover opacity-30 blur-[1.5px]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0f1218] via-[#0f1218]/90 to-[#0f1218]/55" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0f1218] via-[#0f1218]/20 to-transparent" />
          </div>

          <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-end lg:p-8">
            <div className="relative w-[132px] shrink-0 overflow-hidden rounded-xl border border-white/[0.1] bg-[#0b0e13] shadow-[0_24px_55px_-20px_rgba(0,0,0,0.95)] sm:w-[158px]">
              <img
                src={coverUrl}
                alt={`${game.title} cover art`}
                draggable={false}
                onError={() => setCoverFailed(true)}
                className="aspect-[2/3] h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/[0.08]" />
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-ayanami-accent/75">
                  In your library
                </p>
                {game.isRunning && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/[0.08] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    </span>
                    Running
                  </span>
                )}
              </div>

              <h1 className="mt-3 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] text-white sm:text-[34px]">
                {game.title}
              </h1>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10.5px] font-medium text-slate-400">
                <span className="inline-flex items-center gap-1.5" title="Total playtime">
                  <ClockIcon className="h-3.5 w-3.5 text-slate-500" />
                  {formatPlaytime(game.totalPlaytimeSeconds)}
                </span>
                <span className="inline-flex items-center gap-1.5" title="Last played">
                  <CalendarIcon className="h-3.5 w-3.5 text-slate-500" />
                  {formatLastPlayed(game.lastPlayedAt)}
                </span>
                <span className="inline-flex items-center gap-1.5" title="Google Drive sync">
                  <CloudUploadIcon className="h-3.5 w-3.5 text-slate-500" />
                  {game.lastSyncedAt
                    ? `Synced ${formatDateTime(game.lastSyncedAt)}`
                    : 'Never synced'}
                </span>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={game.isRunning || isLaunching}
                  onClick={() => onLaunch(game)}
                  aria-busy={isLaunching}
                  className={`inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[12px] font-semibold tracking-[0.01em] transition-all duration-200 ${
                    game.isRunning
                      ? 'cursor-default border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300'
                      : 'bg-gradient-to-r from-[#a8c5e5] via-[#9db2ca] to-[#879cb5] text-[#0b0e18] shadow-[0_12px_30px_-14px_rgba(135,156,181,0.65)] hover:brightness-105 active:scale-[0.985] disabled:cursor-wait disabled:opacity-60'
                  }`}
                >
                  {isLaunching ? (
                    <Spinner className="h-4 w-4" />
                  ) : game.isRunning ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  ) : (
                    <PlayIcon className="h-4 w-4 translate-x-px" />
                  )}
                  {game.isRunning ? 'Running' : isLaunching ? 'Launching…' : 'Play'}
                </button>

                <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500">
                  <CheckIcon className="h-3 w-3 text-emerald-400/60" />
                  Launches locally · no wrapper
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_336px]">
          <section className="overflow-hidden rounded-2xl border border-ayanami-line/90 bg-[#141820]/80">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between lg:p-6">
              <div className="flex min-w-0 items-start gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ayanami-accent/25 bg-ayanami-accent/[0.09] text-ayanami-highlight">
                  <CloudUploadIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-ayanami-accent/70">
                    Cloud saves
                  </p>
                  <h2 className="mt-1.5 font-display text-[19px] font-semibold tracking-[-0.02em] text-white">
                    Save backups
                  </h2>
                  <p className="mt-1 text-[10.5px] leading-5 text-slate-500">{syncHint}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleSyncNow()}
                disabled={!canSync}
                className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-transparent bg-gradient-to-r from-[#a8c5e5] via-[#9db2ca] to-[#879cb5] px-4 text-[11.5px] font-semibold text-[#0b0e18] shadow-[0_12px_30px_-14px_rgba(135,156,181,0.65)] transition hover:brightness-105 active:scale-[0.985] disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-none disabled:bg-white/[0.035] disabled:text-slate-500 disabled:shadow-none"
              >
                {syncing ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <CloudUploadIcon className="h-4 w-4" />
                )}
                {syncing ? 'Syncing…' : 'Sync Now'}
              </button>
            </div>

            <div className="space-y-4 border-t border-white/[0.055] p-5 lg:p-6">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-slate-400">
                    <FolderIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[11px] font-semibold text-slate-200">Save folder</p>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[2px] text-[8.5px] font-medium ${
                          hasSaveFolder
                            ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300/90'
                            : 'border-white/[0.07] bg-white/[0.03] text-slate-500'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            hasSaveFolder ? 'bg-emerald-400' : 'bg-slate-500'
                          }`}
                        />
                        {hasSaveFolder ? 'Linked' : 'Not set'}
                      </span>
                    </div>
                    <p
                      className={`mt-2 break-all font-mono text-[9.5px] leading-5 ${
                        hasSaveFolder ? 'text-slate-400' : 'text-slate-600'
                      }`}
                      title={game.saveFolderPath ?? undefined}
                    >
                      {game.saveFolderPath ??
                        'Choose the folder where this game stores its save files.'}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {hasSaveFolder && (
                      <button
                        type="button"
                        onClick={() => void handleClearSaveFolder()}
                        disabled={settingsBusy || pickingFolder}
                        className="h-8 rounded-lg px-2.5 text-[9.5px] font-medium text-slate-500 transition hover:text-slate-300 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handlePickSaveFolder()}
                      disabled={pickingFolder || settingsBusy}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-[9.5px] font-semibold text-slate-200 transition hover:border-ayanami-accent/25 hover:bg-ayanami-accent/[0.08] disabled:opacity-60"
                    >
                      {pickingFolder ? (
                        <Spinner className="h-3 w-3" />
                      ) : (
                        <FolderIcon className="h-3.5 w-3.5" />
                      )}
                      {hasSaveFolder ? 'Change' : 'Choose folder'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-slate-400">
                    <RefreshIcon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold text-slate-200">Automatic backups</p>
                    <p className="mt-0.5 text-[9.5px] leading-5 text-slate-500">
                      Zip and upload 2 minutes after the game closes.
                      {game.autoSyncEnabled && !drive.connected
                        ? ' Connect Google Drive for this to run.'
                        : ''}
                    </p>
                    {scheduledFor && (
                      <p className="mt-1 inline-flex items-center gap-1.5 text-[9.5px] font-medium text-ayanami-highlight">
                        <span className="h-1.5 w-1.5 rounded-full bg-ayanami-accent" />
                        Queued for {formatTime(scheduledFor)}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={game.autoSyncEnabled}
                  aria-label="Automatically back up saves after the game closes"
                  onClick={() => void handleToggleAutoSync()}
                  disabled={!hasSaveFolder || settingsBusy}
                  className={`relative h-[22px] w-[38px] shrink-0 rounded-full border p-[3px] transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
                    game.autoSyncEnabled
                      ? 'border-ayanami-accent/40 bg-ayanami-accent/70'
                      : 'border-white/[0.09] bg-white/[0.05]'
                  }`}
                >
                  <span
                    className={`block h-4 w-4 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition-transform duration-200 ${
                      game.autoSyncEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {settingsError && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-3.5 py-3 text-[10.5px] leading-5 text-red-200/85">
                  <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                  <p>{settingsError}</p>
                </div>
              )}

              {syncError && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-3.5 py-3 text-[10.5px] leading-5 text-red-200/85">
                  <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                  <p>{syncError}</p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                      Version history
                    </p>
                    <p className="mt-1 text-[9.5px] text-slate-600">
                      Latest + 2 previous backups
                    </p>
                  </div>
                  {drive.connected && (
                    <button
                      type="button"
                      onClick={() => setReloadKey((key) => key + 1)}
                      disabled={backupsLoading}
                      aria-label="Refresh backup list"
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.06] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-300 disabled:opacity-40"
                    >
                      <RefreshIcon
                        className={`h-3.5 w-3.5 ${backupsLoading ? 'animate-spin' : ''}`}
                      />
                    </button>
                  )}
                </div>

                <div className="mt-3">
                  {!drive.connected ? (
                    <div className="rounded-xl border border-dashed border-white/[0.07] bg-[#0c0f14]/50 px-5 py-8 text-center">
                      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-slate-500">
                        <GoogleDriveIcon className="h-5 w-5" />
                      </span>
                      <p className="mt-3 text-[12px] font-medium text-slate-300">
                        Connect Google Drive to see versions
                      </p>
                      <p className="mx-auto mt-1 max-w-sm text-[10px] leading-5 text-slate-600">
                        Sign in once in Settings, then Ayanami can upload and restore this
                        game’s saves.
                      </p>
                      <button
                        type="button"
                        onClick={onOpenSettings}
                        className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg border border-ayanami-accent/25 bg-ayanami-accent/[0.08] px-3 text-[10px] font-semibold text-ayanami-highlight transition hover:bg-ayanami-accent/[0.13]"
                      >
                        Open Settings
                      </button>
                    </div>
                  ) : backupsLoading ? (
                    <BackupSkeleton />
                  ) : backupsError ? (
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-3.5 py-3 text-[10.5px] leading-5 text-red-200/85">
                      <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                      <div className="flex-1">
                        <p>{backupsError}</p>
                        <button
                          type="button"
                          onClick={() => setReloadKey((key) => key + 1)}
                          className="mt-1.5 text-[9.5px] font-semibold text-red-200/80 underline decoration-red-300/30 underline-offset-2 hover:text-white"
                        >
                          Try again
                        </button>
                      </div>
                    </div>
                  ) : backups.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/[0.07] bg-[#0c0f14]/50 px-5 py-8 text-center">
                      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025] text-slate-500">
                        <ArchiveIcon className="h-5 w-5" />
                      </span>
                      <p className="mt-3 text-[12px] font-medium text-slate-300">
                        No cloud backups yet
                      </p>
                      <p className="mx-auto mt-1 max-w-sm text-[10px] leading-5 text-slate-600">
                        {hasSaveFolder
                          ? 'Use Sync Now to upload the first archive. The newest three versions are kept automatically.'
                          : 'Choose a save folder above, then use Sync Now to upload the first archive.'}
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.015]">
                      {backups.map((backup, index) => {
                        const label =
                          index === 0
                            ? 'Latest backup'
                            : index === 1
                              ? 'Previous backup'
                              : index === 2
                                ? 'Older backup'
                                : `Backup ${index + 1}`
                        return (
                          <div
                            key={backup.id}
                            className={`flex items-center gap-3 px-3.5 py-3.5 ${
                              index === 0 ? 'bg-ayanami-accent/[0.035]' : ''
                            }`}
                          >
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[10px] font-semibold ${
                                index === 0
                                  ? 'border-ayanami-accent/25 bg-ayanami-accent/[0.09] text-ayanami-highlight'
                                  : 'border-white/[0.06] bg-white/[0.02] text-slate-500'
                              }`}
                            >
                              {index === 0 ? (
                                <ArchiveIcon className="h-4 w-4" />
                              ) : (
                                String(index + 1).padStart(2, '0')
                              )}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[11px] font-semibold text-slate-200">{label}</p>
                                {index === 0 && (
                                  <span className="rounded-full border border-ayanami-accent/20 bg-ayanami-accent/[0.07] px-1.5 py-[1px] text-[8px] font-semibold uppercase tracking-[0.1em] text-ayanami-highlight/90">
                                    Newest
                                  </span>
                                )}
                                <span className="text-[9px] text-slate-600">
                                  {formatBytes(backup.sizeBytes)}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-[9.5px] text-slate-500">
                                {formatDateTime(backup.createdAt)}
                                <span className="mx-1.5 text-slate-700">·</span>
                                <span className="font-mono text-slate-600">{backup.name}</span>
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setRestoreError(null)
                                setRestoreTarget(backup)
                              }}
                              disabled={!hasSaveFolder || game.isRunning}
                              title={
                                !hasSaveFolder
                                  ? 'Choose a save folder before restoring'
                                  : game.isRunning
                                    ? 'Close the game before restoring'
                                    : `Restore the backup from ${formatDateTime(backup.createdAt)}`
                              }
                              className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-white/[0.07] bg-white/[0.035] px-2.5 text-[9.5px] font-medium text-slate-300 transition hover:border-ayanami-accent/25 hover:bg-ayanami-accent/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                            >
                              <RestoreIcon className="h-3 w-3" />
                              Restore
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <p className="mt-3 flex items-start gap-1.5 text-[9px] leading-4 text-slate-600">
                  <InfoIcon className="mt-[1px] h-3 w-3 shrink-0" />
                  Backups are stored in{' '}
                  <span className="break-all font-mono text-slate-500">
                    Ayanami_Saves/{game.title}
                  </span>{' '}
                  on Google Drive.
                </p>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-ayanami-line/90 bg-[#141820]/80 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.025]">
                  <GoogleDriveIcon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-slate-200">Google Drive</p>
                  <p className="mt-0.5 text-[9px] text-slate-600">Cloud save storage</p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[8.5px] font-medium ${driveState.className}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${driveState.dot}`} />
                  {driveState.label}
                </span>
              </div>

              {drive.connected ? (
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  {drive.accountAvatarUrl ? (
                    <img
                      src={drive.accountAvatarUrl}
                      alt=""
                      aria-hidden="true"
                      referrerPolicy="no-referrer"
                      className="h-8 w-8 rounded-full border border-white/[0.08] object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ayanami-accent/25 bg-ayanami-accent/[0.1] text-[11px] font-semibold text-ayanami-highlight">
                      {(drive.accountName ?? drive.accountEmail ?? 'G').charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[10.5px] font-medium text-slate-200">
                      {drive.accountName ?? drive.accountEmail ?? 'Google account'}
                    </p>
                    <p className="truncate text-[9px] text-slate-500">
                      {drive.accountEmail ?? 'Signed in'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-[10px] leading-5 text-slate-500">
                  {drive.configured
                    ? 'Sign in with Google in Settings to back up this game’s saves.'
                    : 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart Ayanami.'}
                </p>
              )}

              {drive.connected && drive.connectedAt && (
                <p className="mt-2.5 text-[9px] text-slate-600">
                  Connected {formatDateTime(drive.connectedAt)}
                </p>
              )}

              <button
                type="button"
                onClick={onOpenSettings}
                className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-[10px] font-semibold text-slate-300 transition hover:border-ayanami-accent/25 hover:bg-ayanami-accent/[0.07] hover:text-white"
              >
                {drive.connected ? 'Manage connection' : 'Open Settings'}
              </button>
            </section>

            <section className="rounded-2xl border border-ayanami-line/90 bg-[#141820]/80 p-5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Game files
              </p>
              <div className="mt-3.5 space-y-3">
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-slate-600">
                    Executable
                  </p>
                  <p
                    className="mt-1 break-all font-mono text-[9px] leading-4 text-slate-500"
                    title={game.exePath}
                  >
                    {game.exePath}
                  </p>
                </div>
                <div className="h-px bg-white/[0.05]" />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[9.5px] text-slate-500">Total playtime</span>
                  <span className="text-[9.5px] font-medium text-slate-300">
                    {formatPlaytime(game.totalPlaytimeSeconds)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[9.5px] text-slate-500">Last played</span>
                  <span className="text-[9.5px] font-medium text-slate-300">
                    {formatLastPlayed(game.lastPlayedAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[9.5px] text-slate-500">Last backup</span>
                  <span className="text-[9.5px] font-medium text-slate-300">
                    {game.lastSyncedAt ? formatDateTime(game.lastSyncedAt) : 'Never'}
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-ayanami-accent/15 bg-gradient-to-br from-ayanami-accent/[0.07] via-transparent to-transparent p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-ayanami-accent/20 bg-ayanami-accent/[0.08] text-ayanami-highlight">
                <ShieldIcon className="h-4 w-4" />
              </span>
              <p className="mt-3 text-[11px] font-semibold text-slate-200">
                Three-version safety net
              </p>
              <p className="mt-1.5 text-[9.5px] leading-5 text-slate-500">
                Each upload keeps the newest archive plus two previous ones. Older archives
                are pruned automatically on Google Drive.
              </p>
            </section>
          </aside>
        </div>
      </div>

      {restoreTarget && (
        <RestoreDialog
          game={game}
          backup={restoreTarget}
          restoring={restoring}
          error={restoreError}
          onClose={() => {
            if (!restoring) {
              setRestoreTarget(null)
              setRestoreError(null)
            }
          }}
          onConfirm={() => void handleRestore()}
        />
      )}
    </>
  )
}
