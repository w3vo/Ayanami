import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { AppInfo, DriveStatus, Game, ProviderStatus } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { LibraryView } from './components/LibraryView'
import { GameDetailView } from './components/GameDetailView'
import { StoreView } from './components/StoreView'
import { DownloadsView } from './components/DownloadsView'
import { AddGameModal } from './components/AddGameModal'
import { SettingsModal } from './components/SettingsModal'
import { Toast, type ToastData, type ToastTone } from './components/Toast'
import { getErrorMessage } from './lib/errors'
import type { View } from './types'

const EMPTY_DRIVE_STATUS: DriveStatus = {
  configured: false,
  connected: false,
  accountEmail: null,
  accountName: null,
  accountAvatarUrl: null,
  connectedAt: null
}

export default function App(): JSX.Element {
  const [activeView, setActiveView] = useState<View>('library')
  const [games, setGames] = useState<Game[]>([])
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [launchingIds, setLaunchingIds] = useState<Set<number>>(new Set())
  const [addGameOpen, setAddGameOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [drive, setDrive] = useState<DriveStatus>(EMPTY_DRIVE_STATUS)
  const [providers, setProviders] = useState<ProviderStatus | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [toast, setToast] = useState<ToastData | null>(null)

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedGameId) ?? null,
    [games, selectedGameId]
  )

  const contentRef = useRef<HTMLElement>(null)
  const toastTimerRef = useRef<number | null>(null)

  const showToast = useCallback((message: string, tone: ToastTone = 'error'): void => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    setToast({ id: Date.now() + Math.random(), message, tone })
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 5200)
  }, [])

  const dismissToast = useCallback((): void => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    setToast(null)
  }, [])

  const scrollToTop = useCallback((): void => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const handleCatalogChanged = useCallback((): void => {
    setCatalogRevision((revision) => revision + 1)
  }, [])

  const loadLibrary = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(null)
    try {
      const loadedGames = await window.ayanami.listGames()
      setGames(loadedGames)
    } catch (error) {
      setLoadError(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  useEffect(() => {
    let active = true
    Promise.all([
      window.ayanami.getDriveStatus(),
      window.ayanami.getProviderStatus(),
      window.ayanami.getAppInfo()
    ])
      .then(([driveStatus, providerStatus, info]) => {
        if (!active) return
        setDrive(driveStatus)
        setProviders(providerStatus)
        setAppInfo(info)
      })
      .catch(() => {
        // These values are informational; the library remains usable without them.
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    return window.ayanami.onGameStatusChanged((event) => {
      setGames((previous) => {
        const index = previous.findIndex((game) => game.id === event.gameId)
        if (index === -1) return [event.game, ...previous]
        const next = [...previous]
        next[index] = event.game
        return next
      })
      setLaunchingIds((previous) => {
        if (!previous.has(event.gameId)) return previous
        const next = new Set(previous)
        next.delete(event.gameId)
        return next
      })
    })
  }, [])

  useEffect(() => {
    return window.ayanami.onSaveSyncChanged((event) => {
      if (event.game && event.phase === 'synced') {
        setGames((previous) =>
          previous.map((game) => (game.id === event.gameId ? event.game! : game))
        )
      }

      if (event.trigger !== 'auto') return
      const title = event.game?.title ?? 'This game'

      if (event.phase === 'scheduled') {
        showToast(`“${title}” will back up its saves in 2 minutes.`, 'info')
      } else if (event.phase === 'synced') {
        showToast(`Cloud backup complete for “${title}”.`, 'success')
      } else if (event.phase === 'error') {
        showToast(
          `Automatic backup failed for “${title}”. ${event.message ?? 'Please try again.'}`,
          'error'
        )
      }
    })
  }, [showToast])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activeView, selectedGameId])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    }
  }, [])

  const handleLaunch = useCallback(
    async (game: Game): Promise<void> => {
      setLaunchingIds((previous) => new Set(previous).add(game.id))
      try {
        const runningGame = await window.ayanami.launchGame(game.id)
        setGames((previous) =>
          previous.map((entry) => (entry.id === runningGame.id ? runningGame : entry))
        )
      } catch (error) {
        showToast(`Couldn’t launch “${game.title}”. ${getErrorMessage(error)}`, 'error')
      } finally {
        setLaunchingIds((previous) => {
          if (!previous.has(game.id)) return previous
          const next = new Set(previous)
          next.delete(game.id)
          return next
        })
      }
    },
    [showToast]
  )

  const handleSaved = useCallback(
    (game: Game): void => {
      setGames((previous) => [game, ...previous])
      setAddGameOpen(false)
      setActiveView('library')
      setSelectedGameId(null)
      showToast(`“${game.title}” was added to your library.`, 'success')
    },
    [showToast]
  )

  const handleGameUpdated = useCallback((game: Game): void => {
    setGames((previous) =>
      previous.map((entry) => (entry.id === game.id ? game : entry))
    )
  }, [])

  const handleNavigate = useCallback((view: View): void => {
    setActiveView(view)
    setSelectedGameId(null)
  }, [])

  return (
    <div className="flex h-full overflow-hidden bg-ayanami-bg text-slate-200">
      <Sidebar
        activeView={activeView}
        gameCount={games.length}
        drive={drive}
        version={appInfo?.version ?? ''}
        onNavigate={handleNavigate}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main
        ref={contentRef}
        className="workspace-bg app-scroll relative min-w-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-[1600px] px-7 py-8 pb-16 lg:px-11 lg:py-11">
          {activeView === 'library' && selectedGame && (
            <GameDetailView
              game={selectedGame}
              drive={drive}
              isLaunching={launchingIds.has(selectedGame.id)}
              onBack={() => setSelectedGameId(null)}
              onLaunch={(game) => void handleLaunch(game)}
              onGameUpdated={handleGameUpdated}
              onOpenSettings={() => setSettingsOpen(true)}
              onToast={showToast}
            />
          )}
          {activeView === 'library' && !selectedGame && (
            <LibraryView
              games={games}
              loading={loading}
              loadError={loadError}
              launchingIds={launchingIds}
              onAddGame={() => setAddGameOpen(true)}
              onLaunch={(game) => void handleLaunch(game)}
              onOpenGame={(game) => setSelectedGameId(game.id)}
              onRetry={() => void loadLibrary()}
            />
          )}
          {activeView === 'store' && (
            <StoreView
              catalogRevision={catalogRevision}
              onCatalogChanged={handleCatalogChanged}
              onOpenSettings={() => setSettingsOpen(true)}
              onScrollTop={scrollToTop}
              onToast={showToast}
            />
          )}
          {activeView === 'downloads' && <DownloadsView onToast={showToast} />}
        </div>
      </main>

      {addGameOpen && (
        <AddGameModal onClose={() => setAddGameOpen(false)} onSaved={handleSaved} />
      )}

      {settingsOpen && (
        <SettingsModal
          drive={drive}
          providers={providers}
          appInfo={appInfo}
          onClose={() => setSettingsOpen(false)}
          onDriveChanged={setDrive}
          onCatalogChanged={handleCatalogChanged}
          onToast={showToast}
        />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
