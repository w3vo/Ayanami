import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import type { FormEvent, JSX } from 'react'
import { createPortal } from 'react-dom'
import type {
  Game,
  GameSearchResult,
  MetadataSource,
  ProviderState,
  ProviderStatus,
  SearchResponse
} from '@shared/types'
import { createPlaceholderCover } from '@shared/placeholderCover'
import { fileNameFromPath } from '../lib/format'
import { getErrorMessage } from '../lib/errors'
import {
  AlertCircleIcon,
  AppWindowIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CloseIcon,
  FolderIcon,
  InfoIcon,
  PlayIcon,
  SearchIcon,
  SparkleIcon
} from './Icons'
import { Spinner } from './Spinner'

interface AddGameModalProps {
  onClose: () => void
  onSaved: (game: Game) => void
}

type Step = 1 | 2 | 3
type ChipState = ProviderState | 'unknown'

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 1, label: 'Find game' },
  { id: 2, label: 'Executable' },
  { id: 3, label: 'Save folder' }
]

const SUGGESTIONS = ['Elden Ring', 'Baldur’s Gate 3', 'Hades II', 'Stardew Valley']

const SOURCE_LABELS: Record<MetadataSource, string> = {
  steamgriddb: 'SGDB',
  igdb: 'IGDB',
  demo: 'Demo'
}

function sourceLabel(result: GameSearchResult): string {
  return result.sources.map((source) => SOURCE_LABELS[source]).join(' + ')
}

function Artwork({
  src,
  title,
  className
}: {
  src: string | null
  title: string
  className: string
}): JSX.Element {
  const fallback = useMemo(() => createPlaceholderCover(title), [title])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  return (
    <img
      src={failed || !src ? fallback : src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={className}
    />
  )
}

function ProviderChip({ name, state }: { name: string; state: ChipState }): JSX.Element {
  const presentation =
    state === 'live'
      ? { label: 'Live', dot: 'bg-emerald-400', text: 'text-slate-400' }
      : state === 'error'
        ? { label: 'Error', dot: 'bg-red-400', text: 'text-red-300/75' }
        : state === 'unconfigured'
          ? { label: 'No key', dot: 'bg-slate-600', text: 'text-slate-500' }
          : { label: 'Checking', dot: 'bg-slate-700', text: 'text-slate-600' }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.025] px-2.5 py-1 text-[9px] font-medium">
      <span className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />
      <span className="text-slate-400">{name}</span>
      <span className="text-slate-700">/</span>
      <span className={presentation.text}>{presentation.label}</span>
    </span>
  )
}

function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-400/15 bg-red-400/[0.05] px-3.5 py-3 text-[11px] leading-5 text-red-200/85">
      <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
      <p>{message}</p>
    </div>
  )
}

export function AddGameModal({ onClose, onSaved }: AddGameModalProps): JSX.Element {
  const titleId = useId()
  const [step, setStep] = useState<Step>(1)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GameSearchResult[]>([])
  const [selected, setSelected] = useState<GameSearchResult | null>(null)
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null)
  const [providers, setProviders] = useState<ProviderStatus | null>(null)
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [exePath, setExePath] = useState('')
  const [saveFolder, setSaveFolder] = useState('')
  const [pickingExe, setPickingExe] = useState(false)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestIdRef = useRef(0)
  const debounceRef = useRef<number | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const executeSearch = useCallback(async (rawQuery: string): Promise<void> => {
    const trimmed = rawQuery.trim()
    if (trimmed.length < 2) return

    const requestId = ++requestIdRef.current
    setSearching(true)
    setHasSearched(true)
    setError(null)

    try {
      const response = await window.ayanami.searchGames(trimmed)
      if (requestId !== requestIdRef.current) return
      setSearchResponse(response)
      setResults(response.results)
      setSelected((current) =>
        current && response.results.some((result) => result.key === current.key)
          ? current
          : null
      )
    } catch (searchError) {
      if (requestId !== requestIdRef.current) return
      setError(getErrorMessage(searchError))
      setResults([])
      setSearchResponse(null)
    } finally {
      if (requestId === requestIdRef.current) setSearching(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    window.ayanami
      .getProviderStatus()
      .then((status) => {
        if (active) setProviders(status)
      })
      .catch(() => {
        // Provider availability is informational; searching still works.
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    requestIdRef.current += 1

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    if (trimmed.length < 2) {
      setSearching(false)
      setHasSearched(false)
      setResults([])
      setSearchResponse(null)
      setSelected(null)
      return
    }

    setSearching(true)
    setSelected(null)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      void executeSearch(trimmed)
    }, 420)

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [query, executeSearch])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  const handleSearchSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    void executeSearch(query)
    searchInputRef.current?.focus()
  }

  const handlePickExecutable = async (): Promise<void> => {
    setPickingExe(true)
    setError(null)
    try {
      const path = await window.ayanami.pickExecutable()
      if (path) setExePath(path)
    } catch (pickError) {
      setError(getErrorMessage(pickError))
    } finally {
      setPickingExe(false)
    }
  }

  const handlePickSaveFolder = async (): Promise<void> => {
    setPickingFolder(true)
    setError(null)
    try {
      const path = await window.ayanami.pickSaveFolder()
      if (path) setSaveFolder(path)
    } catch (pickError) {
      setError(getErrorMessage(pickError))
    } finally {
      setPickingFolder(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!selected) {
      setError('Select a game result before saving.')
      return
    }
    if (!exePath) {
      setError('Choose the game executable before saving.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const game = await window.ayanami.addGame({
        title: selected.title,
        igdbId: selected.igdbId,
        steamgriddbId: selected.steamgriddbId,
        coverUrl: selected.coverUrl,
        heroUrl: selected.heroUrl,
        exePath,
        saveFolderPath: saveFolder.trim() || null
      })
      onSaved(game)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
      setSaving(false)
    }
  }

  const goToStep = (nextStep: Step): void => {
    setError(null)
    setStep(nextStep)
  }

  const steamgriddbState: ChipState =
    searchResponse?.providers.steamgriddb ??
    (providers ? (providers.steamgriddb ? 'live' : 'unconfigured') : 'unknown')
  const igdbState: ChipState =
    searchResponse?.providers.igdb ??
    (providers ? (providers.igdb ? 'live' : 'unconfigured') : 'unknown')

  const footerSelection =
    selected !== null ? `Selected: ${selected.title}` : 'Choose a result to continue.'

  const content = ((): JSX.Element => {
    if (step === 1) {
      return (
        <div className="step-enter">
          <form onSubmit={handleSearchSubmit}>
            <label htmlFor="game-search" className="sr-only">
              Search for a game
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500" />
              <input
                ref={searchInputRef}
                id="game-search"
                type="text"
                value={query}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by game title…"
                className="h-12 w-full rounded-xl border border-ayanami-line bg-[#0b0e13] pl-11 pr-28 text-[13px] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition focus:border-ayanami-accent/40 focus:outline-none focus:ring-2 focus:ring-ayanami-accent/10"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-[76px] top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-300"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="submit"
                disabled={query.trim().length < 2 || searching}
                className="absolute right-2 top-1/2 flex h-8 -translate-y-1/2 items-center gap-1.5 rounded-lg bg-white/[0.07] px-3 text-[10px] font-semibold text-slate-200 transition hover:bg-white/[0.11] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {searching ? <Spinner className="h-3 w-3" /> : null}
                Search
              </button>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ProviderChip name="SteamGridDB" state={steamgriddbState} />
            <ProviderChip name="IGDB" state={igdbState} />
            {searchResponse?.demoMode && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/[0.07] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-amber-300/90">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Demo data
              </span>
            )}
          </div>

          {searchResponse?.notice && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-400/[0.13] bg-amber-400/[0.045] px-3.5 py-3 text-[11px] leading-5 text-amber-100/70">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/80" />
              <p>{searchResponse.notice}</p>
            </div>
          )}

          {error && <div className="mt-4"><ErrorBanner message={error} /></div>}

          <div className="mt-5 min-h-[260px]">
            {searching ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="overflow-hidden rounded-xl border border-white/[0.05] bg-white/[0.02] p-1.5"
                  >
                    <div className="skeleton aspect-[2/3] rounded-lg" />
                    <div className="space-y-2 px-1 pb-1 pt-2.5">
                      <div className="skeleton h-2.5 w-4/5 rounded-full" />
                      <div className="skeleton h-2 w-1/2 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : results.length > 0 ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Search results
                  </p>
                  <p className="text-[10px] tabular-nums text-slate-600">
                    {results.length} {results.length === 1 ? 'match' : 'matches'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {results.map((result) => {
                    const isSelected = selected?.key === result.key
                    return (
                      <button
                        key={result.key}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelected(result)}
                        onDoubleClick={() => {
                          setSelected(result)
                          goToStep(2)
                        }}
                        className={`group relative rounded-xl border p-1.5 text-left transition-all duration-200 ${
                          isSelected
                            ? 'border-ayanami-accent/55 bg-ayanami-accent/[0.075] shadow-[0_0_28px_-10px_rgba(135,156,181,0.45)]'
                            : 'border-white/[0.055] bg-white/[0.018] hover:border-white/[0.14] hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-[#0b0e13]">
                          <Artwork
                            src={result.coverUrl}
                            title={result.title}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035]"
                          />
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-70" />
                          {isSelected && (
                            <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-ayanami-accent text-[#0b0e18] shadow-[0_4px_14px_rgba(0,0,0,0.45)]">
                              <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.4} />
                            </span>
                          )}
                        </div>
                        <div className="px-1 pb-1 pt-2.5">
                          <p className="line-clamp-2 min-h-[2rem] text-[12px] font-semibold leading-4 text-slate-100">
                            {result.title}
                          </p>
                          <p className="mt-1.5 truncate text-[8.5px] font-semibold uppercase tracking-[0.11em] text-slate-500">
                            {result.releaseYear ?? 'Year unknown'}
                            <span className="mx-1 text-slate-700">·</span>
                            {sourceLabel(result)}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.065] bg-[#0c0f14]/55 px-6 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.025] text-slate-500">
                  {hasSearched ? (
                    <SearchIcon className="h-5 w-5" />
                  ) : (
                    <SparkleIcon className="h-5 w-5" />
                  )}
                </span>
                <p className="mt-4 text-[13px] font-medium text-slate-300">
                  {hasSearched
                    ? 'No matching games were found'
                    : query.trim().length === 1
                      ? 'Keep typing to search'
                      : 'Find a title to begin'}
                </p>
                <p className="mt-1.5 max-w-sm text-[11px] leading-5 text-slate-500">
                  {hasSearched
                    ? 'Try a different spelling or a shorter title.'
                    : 'Ayanami checks SteamGridDB for covers and IGDB for the details in one search.'}
                </p>
                {!hasSearched && (
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setQuery(suggestion)}
                        className="rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[10px] font-medium text-slate-400 transition hover:border-ayanami-accent/25 hover:bg-ayanami-accent/[0.07] hover:text-slate-200"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )
    }

    if (step === 2 && selected) {
      return (
        <div className="step-enter">
          {error && <ErrorBanner message={error} />}

          <div className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="h-[92px] w-[62px] shrink-0 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0b0e13]">
              <Artwork
                src={selected.coverUrl}
                title={selected.title}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Selected game
              </p>
              <p className="mt-1.5 truncate font-display text-lg font-semibold tracking-[-0.01em] text-white">
                {selected.title}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                {selected.releaseYear ?? 'Year unknown'}
                {selected.genres.length > 0 && ` · ${selected.genres.join(' · ')}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => goToStep(1)}
              className="ml-auto self-start rounded-lg border border-white/[0.06] px-2.5 py-1.5 text-[10px] font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-white"
            >
              Change
            </button>
          </div>

          <div className="mt-6">
            <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Game executable
            </p>
            <h3 className="mt-2 text-[15px] font-semibold text-white">
              Point Ayanami at the game
            </h3>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              Select the Windows <span className="font-mono text-slate-400">.exe</span> Ayanami
              should launch. No arguments or wrappers are added.
            </p>

            <div className="mt-4 rounded-2xl border border-ayanami-line bg-[#0c0f14] p-4">
              <div className="flex items-center gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.025] text-slate-400">
                  <AppWindowIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  {exePath ? (
                    <>
                      <p className="truncate text-[12px] font-medium text-slate-200">
                        {fileNameFromPath(exePath)}
                      </p>
                      <p
                        className="mt-0.5 truncate font-mono text-[9.5px] text-slate-600"
                        title={exePath}
                      >
                        {exePath}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[12px] font-medium text-slate-300">
                        No executable selected
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-600">
                        Browse to the game’s install folder.
                      </p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handlePickExecutable()}
                  disabled={pickingExe}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-[10px] font-semibold text-slate-200 transition hover:border-ayanami-accent/25 hover:bg-ayanami-accent/[0.08] disabled:opacity-60"
                >
                  {pickingExe ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <FolderIcon className="h-3.5 w-3.5" />
                  )}
                  Browse
                </button>
              </div>

              {exePath && (
                <div className="mt-3 flex items-center gap-2 border-t border-white/[0.055] pt-3">
                  <span className="inline-flex items-center gap-1.5 text-[9px] font-medium text-emerald-300/75">
                    <CheckIcon className="h-3 w-3" />
                    Executable ready
                  </span>
                  <button
                    type="button"
                    onClick={() => setExePath('')}
                    className="ml-auto text-[9px] font-medium text-slate-500 transition hover:text-slate-300"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )
    }

    if (step === 3 && selected) {
      return (
        <div className="step-enter">
          {error && <ErrorBanner message={error} />}

          <div className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="h-[74px] w-[50px] shrink-0 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0b0e13]">
              <Artwork
                src={selected.coverUrl}
                title={selected.title}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Ready to add
              </p>
              <p className="mt-1.5 truncate font-display text-base font-semibold text-white">
                {selected.title}
              </p>
              <p className="mt-1 truncate font-mono text-[9px] text-slate-600" title={exePath}>
                {exePath}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Save folder <span className="normal-case tracking-normal">(optional)</span>
                </p>
                <h3 className="mt-2 text-[15px] font-semibold text-white">
                  Where does this game keep its saves?
                </h3>
              </div>
              <span className="rounded-full border border-white/[0.06] bg-white/[0.025] px-2.5 py-1 text-[9px] font-medium text-slate-500">
                Optional
              </span>
            </div>
            <p className="mt-1.5 max-w-lg text-[11px] leading-5 text-slate-500">
              Choose the folder containing this game’s save files. It will be used for Google
              Drive cloud backups and can be changed later.
            </p>

            <div className="mt-4 rounded-2xl border border-ayanami-line bg-[#0c0f14] p-4">
              <div className="flex items-center gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.025] text-slate-400">
                  <FolderIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  {saveFolder ? (
                    <>
                      <p className="truncate text-[12px] font-medium text-slate-200">
                        {fileNameFromPath(saveFolder)}
                      </p>
                      <p
                        className="mt-0.5 truncate font-mono text-[9.5px] text-slate-600"
                        title={saveFolder}
                      >
                        {saveFolder}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[12px] font-medium text-slate-300">No save folder yet</p>
                      <p className="mt-0.5 text-[10px] text-slate-600">
                        You can skip this and configure it later.
                      </p>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handlePickSaveFolder()}
                  disabled={pickingFolder}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-[10px] font-semibold text-slate-200 transition hover:border-ayanami-accent/25 hover:bg-ayanami-accent/[0.08] disabled:opacity-60"
                >
                  {pickingFolder ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <FolderIcon className="h-3.5 w-3.5" />
                  )}
                  Browse
                </button>
              </div>

              {saveFolder && (
                <div className="mt-3 flex items-center gap-2 border-t border-white/[0.055] pt-3">
                  <span className="inline-flex items-center gap-1.5 text-[9px] font-medium text-slate-500">
                    <CheckIcon className="h-3 w-3 text-emerald-400/70" />
                    Save folder linked
                  </span>
                  <button
                    type="button"
                    onClick={() => setSaveFolder('')}
                    className="ml-auto text-[9px] font-medium text-slate-500 transition hover:text-slate-300"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2 text-[10px] text-slate-600">
            <PlayIcon className="h-3 w-3 text-ayanami-accent/70" />
            <span>You can launch this game from the Library as soon as it is saved.</span>
          </div>
        </div>
      )
    }

    return <div />
  })()

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="overlay-enter absolute inset-0 bg-[#05070b]/80 backdrop-blur-md"
        onClick={() => {
          if (!saving) onClose()
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-card relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#12151b] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.04)]"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ayanami-accent/40 to-transparent" />

        <div className="flex items-start gap-4 px-6 pb-5 pt-6 sm:px-7">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-ayanami-accent/75">
              Add to library
            </p>
            <h2
              id={titleId}
              className="mt-2 font-display text-[22px] font-semibold tracking-[-0.025em] text-white"
            >
              Add a game
            </h2>
            <p className="mt-1 text-[11px] text-slate-500">
              Match a title, link its executable, and keep its saves together.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close add game dialog"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200 disabled:opacity-40"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pb-6 sm:px-7">
          <div className="flex items-center gap-2.5">
            {STEPS.map((item, index) => {
              const isActive = step === item.id
              const isComplete = step > item.id
              return (
                <Fragment key={item.id}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold transition ${
                        isActive
                          ? 'border-transparent bg-gradient-to-br from-[#a8c5e5] to-[#879cb5] text-[#0b0e18]'
                          : isComplete
                            ? 'border-ayanami-accent/30 bg-ayanami-accent/[0.09] text-ayanami-accent'
                            : 'border-white/[0.08] bg-white/[0.025] text-slate-600'
                      }`}
                    >
                      {isComplete ? <CheckIcon className="h-3 w-3" strokeWidth={2.4} /> : item.id}
                    </span>
                    <span
                      className={`text-[10px] font-medium ${
                        isActive
                          ? 'text-slate-200'
                          : isComplete
                            ? 'text-slate-400'
                            : 'text-slate-600'
                      }`}
                    >
                      {item.label}
                    </span>
                  </div>
                  {index < STEPS.length - 1 && (
                    <span
                      className={`h-px flex-1 ${
                        step > item.id ? 'bg-ayanami-accent/25' : 'bg-white/[0.06]'
                      }`}
                    />
                  )}
                </Fragment>
              )
            })}
          </div>
        </div>

        <div className="app-scroll min-h-0 flex-1 overflow-y-auto border-t border-white/[0.055] px-6 py-6 sm:px-7">
          {content}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-white/[0.055] bg-[#101319] px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <p className="min-w-0 truncate text-[10px] text-slate-500">
            {step === 1
              ? footerSelection
              : step === 2
                ? exePath
                  ? `Selected: ${selected?.title ?? ''}`
                  : 'Select an executable to continue.'
                : 'Saved locally to your library.'}
          </p>

          <div className="flex shrink-0 items-center justify-end gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => goToStep((step - 1) as Step)}
                disabled={saving}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.06] disabled:opacity-40"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" />
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (!saving) onClose()
              }}
              disabled={saving}
              className="h-9 rounded-lg px-3.5 text-[11px] font-medium text-slate-500 transition hover:text-slate-300 disabled:opacity-40"
            >
              Cancel
            </button>

            {step === 1 && (
              <button
                type="button"
                disabled={!selected || searching}
                onClick={() => goToStep(2)}
                className="flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#9db2ca] to-[#879cb5] px-4 text-[11px] font-semibold text-[#0b0e18] shadow-[0_10px_26px_-12px_rgba(135,156,181,0.55)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-35"
              >
                Continue
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                disabled={!exePath}
                onClick={() => goToStep(3)}
                className="flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#9db2ca] to-[#879cb5] px-4 text-[11px] font-semibold text-[#0b0e18] shadow-[0_10px_26px_-12px_rgba(135,156,181,0.55)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-35"
              >
                Continue
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !exePath || !selected}
                className="flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[#9db2ca] to-[#879cb5] px-4 text-[11px] font-semibold text-[#0b0e18] shadow-[0_10px_26px_-12px_rgba(135,156,181,0.55)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-35"
              >
                {saving ? <Spinner className="h-3.5 w-3.5" /> : <CheckIcon className="h-3.5 w-3.5" strokeWidth={2.4} />}
                {saving ? 'Saving…' : 'Save game'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
