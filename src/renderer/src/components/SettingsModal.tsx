import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AppInfo, CatalogSource, DriveStatus, ProviderStatus } from '@shared/types'
import { getErrorMessage } from '../lib/errors'
import { formatCount, formatDateTime } from '../lib/format'
import type { ToastTone } from './Toast'
import {
  AlertCircleIcon,
  CheckIcon,
  CloseIcon,
  FolderIcon,
  GoogleDriveIcon,
  InfoIcon,
  PlusIcon,
  RefreshIcon,
  ShieldIcon,
  StoreIcon,
  TrashIcon
} from './Icons'
import { Spinner } from './Spinner'

interface SettingsModalProps {
  drive: DriveStatus
  providers: ProviderStatus | null
  appInfo: AppInfo | null
  onClose: () => void
  onDriveChanged: (drive: DriveStatus) => void
  onCatalogChanged: () => void
  onToast: (message: string, tone?: ToastTone) => void
}

type Tone = 'green' | 'amber' | 'gray'

const TONE_CLASSES: Record<Tone, string> = {
  green: 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300/90',
  amber: 'border-amber-400/20 bg-amber-400/[0.07] text-amber-300/90',
  gray: 'border-white/[0.07] bg-white/[0.03] text-slate-400'
}

const DOT_CLASSES: Record<Tone, string> = {
  green: 'bg-emerald-400',
  amber: 'bg-amber-400',
  gray: 'bg-slate-500'
}

function StatusPill({ label, tone }: { label: string; tone: Tone }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-medium ${TONE_CLASSES[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone]}`} />
      {label}
    </span>
  )
}

function IntegrationRow({
  mark,
  title,
  description,
  status
}: {
  mark: ReactNode
  title: string
  description: string
  status: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-[10px] font-semibold text-slate-400">
        {mark}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-medium text-slate-200">{title}</p>
        <p className="mt-0.5 text-[9.5px] text-slate-600">{description}</p>
      </div>
      {status}
    </div>
  )
}

function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-3.5 py-3 text-[10.5px] leading-5 text-red-200/85">
      <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
      <p>{message}</p>
    </div>
  )
}

function NoticeBanner({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.05] px-3.5 py-3 text-[10.5px] leading-5 text-emerald-100/80">
      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300/80" />
      <p>{message}</p>
    </div>
  )
}

export function SettingsModal({
  drive,
  providers,
  appInfo,
  onClose,
  onDriveChanged,
  onCatalogChanged,
  onToast
}: SettingsModalProps): JSX.Element {
  const titleId = useId()
  const mountedRef = useRef(true)
  const [driveBusy, setDriveBusy] = useState<'connect' | 'disconnect' | null>(null)
  const [driveError, setDriveError] = useState<string | null>(null)
  const [driveNotice, setDriveNotice] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [catalogSources, setCatalogSources] = useState<CatalogSource[] | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null)
  const [catalogBusy, setCatalogBusy] = useState<string | null>(null)
  const [confirmRemoveSourceId, setConfirmRemoveSourceId] = useState<number | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadCatalogSources = useCallback(async (showSpinner = true): Promise<void> => {
    if (showSpinner) setCatalogLoading(true)
    setCatalogError(null)
    try {
      const sources = await window.ayanami.listCatalogSources()
      if (mountedRef.current) setCatalogSources(sources)
    } catch (error) {
      if (mountedRef.current) setCatalogError(getErrorMessage(error))
    } finally {
      if (showSpinner && mountedRef.current) setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCatalogSources(true)
  }, [loadCatalogSources])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!drive.connected) {
      setConfirmDisconnect(false)
      if (driveBusy === 'disconnect') setDriveBusy(null)
    }
  }, [drive.connected, driveBusy])

  const steamgriddbStatus: { label: string; tone: Tone } =
    providers === null
      ? { label: 'Checking…', tone: 'gray' }
      : providers.steamgriddb
        ? { label: 'Configured', tone: 'green' }
        : { label: 'Not configured', tone: 'gray' }

  const igdbStatus: { label: string; tone: Tone } =
    providers === null
      ? { label: 'Checking…', tone: 'gray' }
      : providers.igdb
        ? { label: 'Configured', tone: 'green' }
        : { label: 'Not configured', tone: 'gray' }

  const driveStatus: { label: string; tone: Tone } = drive.connected
    ? { label: 'Connected', tone: 'green' }
    : drive.configured
      ? { label: 'Not connected', tone: 'amber' }
      : { label: 'Not set up', tone: 'gray' }

  const handleConnect = async (): Promise<void> => {
    setDriveBusy('connect')
    setDriveError(null)
    setDriveNotice(null)

    try {
      const status = await window.ayanami.connectDrive()
      onDriveChanged(status)
      if (mountedRef.current) {
        setDriveNotice(
          status.accountEmail
            ? `Connected as ${status.accountEmail}. Cloud saves are ready.`
            : 'Google Drive is connected. Cloud saves are ready.'
        )
      }
      onToast('Google Drive connected.', 'success')
    } catch (error) {
      if (mountedRef.current) setDriveError(getErrorMessage(error))
    } finally {
      if (mountedRef.current) setDriveBusy(null)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    setDriveBusy('disconnect')
    setDriveError(null)
    setDriveNotice(null)

    try {
      const status = await window.ayanami.disconnectDrive()
      onDriveChanged(status)
      if (mountedRef.current) {
        setConfirmDisconnect(false)
        setDriveNotice('Google Drive was disconnected. Local saves are untouched.')
      }
      onToast('Google Drive disconnected.', 'info')
    } catch (error) {
      if (mountedRef.current) setDriveError(getErrorMessage(error))
    } finally {
      if (mountedRef.current) setDriveBusy(null)
    }
  }

  const handleCatalogImport = async (): Promise<void> => {
    if (catalogBusy !== null) return
    setCatalogBusy('import')
    setCatalogError(null)
    setCatalogNotice(null)

    try {
      const result = await window.ayanami.importCatalogSource()
      if (!result) return
      await loadCatalogSources(false)
      onCatalogChanged()
      if (mountedRef.current) {
        const base = `Imported ${formatCount(result.importedCount, 'title')} from “${result.source.name}”.`
        setCatalogNotice(
          result.warnings.length > 0
            ? `${base} ${formatCount(result.warnings.length, 'warning')} to review.`
            : base
        )
      }
      onToast('Catalog imported.', 'success')
    } catch (error) {
      if (mountedRef.current) setCatalogError(getErrorMessage(error))
      onToast('Couldn’t import that catalog.', 'error')
    } finally {
      if (mountedRef.current) setCatalogBusy(null)
    }
  }

  const handleCatalogSample = async (): Promise<void> => {
    if (catalogBusy !== null) return
    setCatalogBusy('sample')
    setCatalogError(null)
    setCatalogNotice(null)

    try {
      const result = await window.ayanami.loadSampleCatalog()
      await loadCatalogSources(false)
      onCatalogChanged()
      if (mountedRef.current) {
        setCatalogNotice(
          `Sample catalog loaded — ${formatCount(result.importedCount, 'title')} ready to browse.`
        )
      }
      onToast('Sample catalog loaded.', 'success')
    } catch (error) {
      if (mountedRef.current) setCatalogError(getErrorMessage(error))
      onToast('Couldn’t load the sample catalog.', 'error')
    } finally {
      if (mountedRef.current) setCatalogBusy(null)
    }
  }

  const handleCatalogRefresh = async (source: CatalogSource): Promise<void> => {
    if (catalogBusy !== null) return
    setCatalogBusy(`refresh:${source.id}`)
    setCatalogError(null)
    setCatalogNotice(null)

    try {
      const result = await window.ayanami.refreshCatalogSource(source.id)
      await loadCatalogSources(false)
      onCatalogChanged()
      if (mountedRef.current) {
        setCatalogNotice(
          `Refreshed “${source.name}” — ${formatCount(result.importedCount, 'title')}.`
        )
      }
      onToast('Catalog source refreshed.', 'success')
    } catch (error) {
      if (mountedRef.current) setCatalogError(getErrorMessage(error))
    } finally {
      if (mountedRef.current) setCatalogBusy(null)
    }
  }

  const handleCatalogRemove = async (source: CatalogSource): Promise<void> => {
    if (catalogBusy !== null) return
    setCatalogBusy(`remove:${source.id}`)
    setCatalogError(null)
    setCatalogNotice(null)

    try {
      const sources = await window.ayanami.removeCatalogSource(source.id)
      if (mountedRef.current) {
        setCatalogSources(sources)
        setConfirmRemoveSourceId(null)
        setCatalogNotice(
          `Removed “${source.name}” from the Store. The manifest file was not deleted.`
        )
      }
      onCatalogChanged()
      onToast('Catalog source removed.', 'info')
    } catch (error) {
      if (mountedRef.current) setCatalogError(getErrorMessage(error))
    } finally {
      if (mountedRef.current) setCatalogBusy(null)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="overlay-enter absolute inset-0 bg-[#05070b]/80 backdrop-blur-md"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-card relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#12151b] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.04)]"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ayanami-accent/40 to-transparent" />

        <div className="flex items-start gap-4 px-6 pb-5 pt-6">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-ayanami-accent/75">
              Preferences
            </p>
            <h2
              id={titleId}
              className="mt-2 font-display text-[22px] font-semibold tracking-[-0.025em] text-white"
            >
              Settings
            </h2>
            <p className="mt-1 text-[11px] text-slate-500">
              Integrations, local data, and the parts of Ayanami that leave this PC.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="app-scroll min-h-0 flex-1 space-y-6 overflow-y-auto border-t border-white/[0.055] px-6 py-6">
          <section>
            <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Integrations
            </p>
            <div className="mt-3 divide-y divide-white/[0.055] rounded-xl border border-white/[0.06] bg-white/[0.018] px-3.5">
              <IntegrationRow
                mark="SG"
                title="SteamGridDB"
                description="Cover art and grid artwork"
                status={
                  <StatusPill label={steamgriddbStatus.label} tone={steamgriddbStatus.tone} />
                }
              />
              <IntegrationRow
                mark="IG"
                title="IGDB"
                description="Titles, genres, and release dates"
                status={<StatusPill label={igdbStatus.label} tone={igdbStatus.tone} />}
              />
              <IntegrationRow
                mark={<GoogleDriveIcon className="h-[17px] w-[17px]" />}
                title="Google Drive"
                description="Cloud save backups and version history"
                status={<StatusPill label={driveStatus.label} tone={driveStatus.tone} />}
              />
            </div>
          </section>

          <section>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Catalog sources
                </p>
                <p className="mt-1 text-[9px] leading-4 text-slate-600">
                  The Store browses only the manifests you import — Ayanami or Hydra/SteamRip
                  JSON. Visible titles automatically pull matching Steam cover art, descriptions,
                  and system requirements. Files stay on this PC.
                </p>
              </div>
              {catalogSources !== null && catalogSources.length > 0 && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleCatalogImport()}
                    disabled={catalogBusy !== null || catalogLoading}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-ayanami-accent/25 bg-ayanami-accent/[0.08] px-2.5 text-[9px] font-semibold text-ayanami-accent transition hover:border-ayanami-accent/40 hover:bg-ayanami-accent/[0.12] hover:text-white disabled:cursor-wait disabled:opacity-50"
                  >
                    {catalogBusy === 'import' ? (
                      <Spinner className="h-3 w-3" />
                    ) : (
                      <PlusIcon className="h-3 w-3" />
                    )}
                    Import
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCatalogSample()}
                    disabled={catalogBusy !== null || catalogLoading}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 text-[9px] font-medium text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-200 disabled:cursor-wait disabled:opacity-50"
                  >
                    {catalogBusy === 'sample' ? (
                      <Spinner className="h-3 w-3" />
                    ) : (
                      <StoreIcon className="h-3 w-3" />
                    )}
                    Sample
                  </button>
                </div>
              )}
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.018]">
              {catalogLoading ? (
                <div className="flex items-center gap-2.5 px-4 py-5 text-[10px] text-slate-500">
                  <Spinner className="h-3.5 w-3.5" />
                  Reading catalog sources…
                </div>
              ) : catalogSources === null ? (
                <div className="flex flex-col items-start gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2.5">
                    <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                    <div>
                      <p className="text-[10px] font-medium text-red-100/85">
                        Catalog sources couldn’t be read
                      </p>
                      <p className="mt-0.5 text-[9px] leading-4 text-red-100/60">{catalogError}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadCatalogSources(true)}
                    className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-[9px] font-medium text-slate-200 transition hover:bg-white/[0.07]"
                  >
                    <RefreshIcon className="h-3 w-3" />
                    Retry
                  </button>
                </div>
              ) : catalogSources.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg border border-ayanami-accent/20 bg-ayanami-accent/[0.07] text-ayanami-accent">
                    <StoreIcon className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-[11px] font-medium text-slate-300">
                    No catalog sources yet
                  </p>
                  <p className="mx-auto mt-1 max-w-[300px] text-[9px] leading-4 text-slate-600">
                    Import a <span className="font-mono text-slate-500">sources.json</span>{' '}
                    manifest, an Ayanami catalog, or a Hydra/SteamRip source — or load the bundled
                    sample to explore the Store.
                  </p>
                  <div className="mt-3 flex flex-col items-center justify-center gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => void handleCatalogImport()}
                      disabled={catalogBusy !== null}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#9db2ca] to-[#879cb5] px-3 text-[9.5px] font-semibold text-[#0b0e18] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-60"
                    >
                      {catalogBusy === 'import' ? (
                        <Spinner className="h-3 w-3" />
                      ) : (
                        <PlusIcon className="h-3 w-3" />
                      )}
                      Import source
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCatalogSample()}
                      disabled={catalogBusy !== null}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-[9.5px] font-medium text-slate-300 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-wait disabled:opacity-60"
                    >
                      {catalogBusy === 'sample' ? (
                        <Spinner className="h-3 w-3" />
                      ) : (
                        <StoreIcon className="h-3 w-3" />
                      )}
                      Load sample
                    </button>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.045]">
                  {catalogSources.map((source) => {
                    const isRefreshing = catalogBusy === `refresh:${source.id}`
                    const isRemoving = catalogBusy === `remove:${source.id}`
                    const confirming = confirmRemoveSourceId === source.id
                    return (
                      <div key={source.id} className="px-3.5 py-3">
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-slate-500">
                            <StoreIcon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate text-[11px] font-medium text-slate-200">
                                {source.name}
                              </p>
                              {source.isSample && (
                                <span className="rounded-full border border-ayanami-accent/20 bg-ayanami-accent/[0.07] px-1.5 py-0.5 text-[8px] font-medium text-ayanami-highlight/90">
                                  Sample
                                </span>
                              )}
                              {source.manifestVersion !== null && (
                                <span className="text-[8px] text-slate-600">
                                  v{source.manifestVersion}
                                </span>
                              )}
                            </div>
                            <p
                              className="mt-1 line-clamp-2 break-all font-mono text-[8.5px] leading-4 text-slate-600"
                              title={source.path}
                            >
                              {source.path}
                            </p>
                            <p className="mt-1 text-[8.5px] text-slate-600">
                              {formatCount(source.gameCount, 'title')} · Updated{' '}
                              {formatDateTime(source.updatedAt)}
                            </p>

                            {confirming ? (
                              <div className="mt-2 rounded-lg border border-red-400/15 bg-red-400/[0.04] p-2.5">
                                <p className="text-[9px] leading-4 text-red-100/75">
                                  Remove “{source.name}” from the Store? The manifest file itself
                                  is not deleted.
                                </p>
                                <div className="mt-2 flex justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setConfirmRemoveSourceId(null)}
                                    disabled={isRemoving}
                                    className="h-7 rounded-lg px-2 text-[9px] font-medium text-slate-400 transition hover:text-slate-200 disabled:opacity-40"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleCatalogRemove(source)}
                                    disabled={isRemoving}
                                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-400/[0.08] px-2.5 text-[9px] font-semibold text-red-200 transition hover:bg-red-400/[0.13] disabled:cursor-wait disabled:opacity-50"
                                  >
                                    {isRemoving ? (
                                      <Spinner className="h-3 w-3" />
                                    ) : (
                                      <TrashIcon className="h-3 w-3" />
                                    )}
                                    {isRemoving ? 'Removing…' : 'Remove'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-2 flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void handleCatalogRefresh(source)}
                                  disabled={catalogBusy !== null}
                                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 text-[9px] font-medium text-slate-400 transition hover:border-ayanami-accent/25 hover:bg-ayanami-accent/[0.05] hover:text-slate-200 disabled:cursor-wait disabled:opacity-40"
                                >
                                  <RefreshIcon
                                    className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
                                  />
                                  {isRefreshing ? 'Refreshing…' : 'Refresh'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmRemoveSourceId(source.id)}
                                  disabled={catalogBusy !== null}
                                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 text-[9px] font-medium text-slate-500 transition hover:border-red-400/20 hover:bg-red-400/[0.05] hover:text-red-200 disabled:opacity-40"
                                >
                                  <TrashIcon className="h-3 w-3" />
                                  Remove
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {catalogNotice && (
              <div className="mt-2.5">
                <NoticeBanner message={catalogNotice} />
              </div>
            )}
            {catalogError && catalogSources !== null && (
              <div className="mt-2.5">
                <ErrorBanner message={catalogError} />
              </div>
            )}
            <p className="mt-2.5 text-[9px] leading-4 text-slate-600">
              Supports Ayanami manifests with a{' '}
              <span className="font-mono text-slate-500">games</span> array and Hydra-style sources
              with a <span className="font-mono text-slate-500">downloads</span> array. Removing a
              source only clears it from Ayanami’s catalog database; it never deletes the manifest
              from disk.
            </p>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Cloud saves
              </p>
              <StatusPill label={driveStatus.label} tone={driveStatus.tone} />
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.018]">
              <div className="flex items-start gap-3.5 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.025]">
                  <GoogleDriveIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-slate-100">
                    {drive.connected
                      ? 'Google Drive is connected'
                      : drive.configured
                        ? 'Connect Google Drive'
                        : 'Google Drive isn’t configured'}
                  </p>
                  <p className="mt-1 text-[10px] leading-5 text-slate-500">
                    {drive.connected
                      ? 'Save archives upload to your own Drive. Ayanami keeps three versions per game.'
                      : drive.configured
                        ? 'A browser window will open for Google sign-in. Keep the Google Drive permission checked; Ayanami can only see files it creates.'
                        : 'Cloud saves need a Google OAuth client. Add the credentials below and restart Ayanami.'}
                  </p>
                </div>
              </div>

              <div className="space-y-3 border-t border-white/[0.055] px-4 py-4">
                {drive.connected ? (
                  <>
                    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#0d1016]/70 p-3">
                      {drive.accountAvatarUrl ? (
                        <img
                          src={drive.accountAvatarUrl}
                          alt=""
                          aria-hidden="true"
                          referrerPolicy="no-referrer"
                          className="h-9 w-9 rounded-full border border-white/[0.08] object-cover"
                        />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-ayanami-accent/25 bg-ayanami-accent/[0.1] text-[12px] font-semibold text-ayanami-highlight">
                          {(drive.accountName ?? drive.accountEmail ?? 'G')
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium text-slate-200">
                          {drive.accountName ?? 'Google account'}
                        </p>
                        <p className="truncate text-[9.5px] text-slate-500">
                          {drive.accountEmail ?? 'Signed in to Google Drive'}
                        </p>
                      </div>
                      {drive.connectedAt && (
                        <span className="shrink-0 text-right text-[8.5px] leading-4 text-slate-600">
                          Since
                          <br />
                          {formatDateTime(drive.connectedAt)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-start gap-2 text-[9px] leading-4 text-slate-600">
                      <ShieldIcon className="mt-[1px] h-3 w-3 shrink-0 text-ayanami-accent/60" />
                      Ayanami uses the drive.file scope, so it can only access backups it
                      created.
                    </div>

                    {confirmDisconnect ? (
                      <div className="flex flex-col gap-2 rounded-xl border border-red-400/15 bg-red-400/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-[10px] leading-5 text-red-100/75">
                          Disconnect Google Drive? Cloud backups stay on Drive, but automatic
                          and manual sync will stop.
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmDisconnect(false)}
                            disabled={driveBusy === 'disconnect'}
                            className="h-8 rounded-lg px-2.5 text-[10px] font-medium text-slate-400 transition hover:text-slate-200 disabled:opacity-40"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDisconnect()}
                            disabled={driveBusy === 'disconnect'}
                            className="flex h-8 items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-400/[0.08] px-3 text-[10px] font-semibold text-red-200 transition hover:bg-red-400/[0.13] disabled:opacity-50"
                          >
                            {driveBusy === 'disconnect' ? (
                              <Spinner className="h-3 w-3" />
                            ) : (
                              <TrashIcon className="h-3 w-3" />
                            )}
                            {driveBusy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnect(true)}
                        disabled={driveBusy !== null}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 text-[10px] font-medium text-slate-400 transition hover:border-red-400/20 hover:bg-red-400/[0.05] hover:text-red-200 disabled:opacity-40"
                      >
                        <TrashIcon className="h-3 w-3" />
                        Disconnect
                      </button>
                    )}
                  </>
                ) : drive.configured ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleConnect()}
                      disabled={driveBusy === 'connect'}
                      className="flex h-10 w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#a8c5e5] via-[#9db2ca] to-[#879cb5] px-4 text-[11.5px] font-semibold text-[#0b0e18] shadow-[0_12px_30px_-14px_rgba(135,156,181,0.65)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-wait disabled:opacity-75"
                    >
                      {driveBusy === 'connect' ? (
                        <Spinner className="h-4 w-4" />
                      ) : (
                        <GoogleDriveIcon className="h-4 w-4" />
                      )}
                      {driveBusy === 'connect' ? 'Waiting for Google…' : 'Sign in with Google'}
                    </button>
                    {driveBusy === 'connect' && (
                      <p className="text-center text-[9.5px] leading-5 text-slate-500">
                        Finish signing in in your browser, then return to Ayanami.
                      </p>
                    )}
                    <div className="flex items-start gap-2 text-[9px] leading-4 text-slate-600">
                      <ShieldIcon className="mt-[1px] h-3 w-3 shrink-0 text-ayanami-accent/60" />
                      Ayanami requests access only to files it creates in your Drive.
                    </div>
                  </>
                ) : (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <code className="rounded-md border border-white/[0.06] bg-[#0b0e13] px-2 py-1 font-mono text-[9px] text-slate-400">
                        GOOGLE_CLIENT_ID
                      </code>
                      <code className="rounded-md border border-white/[0.06] bg-[#0b0e13] px-2 py-1 font-mono text-[9px] text-slate-400">
                        GOOGLE_CLIENT_SECRET
                      </code>
                    </div>
                    <p className="text-[9px] leading-4 text-slate-600">
                      Create a Google Cloud OAuth client of type{' '}
                      <span className="text-slate-400">Desktop app</span>, enable the Google
                      Drive API, and put both values in <span className="font-mono">.env</span>.
                      Restart Ayanami after saving.
                    </p>
                  </div>
                )}

                {driveNotice && <NoticeBanner message={driveNotice} />}
                {driveError && <ErrorBanner message={driveError} />}
              </div>
            </div>
          </section>

          <section>
            <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Local data
            </p>
            <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.018] p-3.5">
              <div className="flex items-center gap-2 text-[10px] font-medium text-slate-400">
                <FolderIcon className="h-3.5 w-3.5 text-slate-500" />
                Library database
              </div>
              <p className="mt-2 break-all font-mono text-[9.5px] leading-5 text-slate-600">
                {appInfo?.dbPath ?? 'Resolving local database…'}
              </p>
            </div>
            <p className="mt-2.5 text-[9.5px] leading-5 text-slate-600">
              Your library lives entirely on this PC. Nothing is uploaded unless you explicitly
              connect a cloud service.
            </p>
          </section>

          <section>
            <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Credentials
            </p>
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.018] p-3.5">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <p className="text-[10px] leading-5 text-slate-500">
                API keys are read from <span className="font-mono text-slate-400">.env</span> in
                the project root. Library search uses SteamGridDB and IGDB when keys are present;
                Store metadata uses Steam&apos;s public catalog endpoints and needs no key.
                Ayanami falls back to built-in demo metadata when keys are missing. Restart the
                app after changing credentials.
              </p>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.055] bg-[#101319] px-6 py-4">
          <span className="inline-flex items-center gap-1.5 text-[9px] text-slate-600">
            <CheckIcon className="h-3 w-3 text-emerald-400/60" />
            Ayanami {appInfo ? `v${appInfo.version}` : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg bg-gradient-to-r from-[#9db2ca] to-[#879cb5] px-4 text-[11px] font-semibold text-[#0b0e18] shadow-[0_10px_26px_-12px_rgba(135,156,181,0.55)] transition hover:brightness-105"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
