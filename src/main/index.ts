import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import { BenchmarkVideoService } from './benchmark-videos'
import { CatalogManager } from './catalog'
import { CatalogMetadataEnricher } from './catalog-metadata'
import { CatalogRepository } from './catalog-repository'
import { GameRepository } from './db'
import { CloudSaveManager } from './cloud-saves'
import { DownloadManager } from './downloads/manager'
import { SourceWindowManager } from './downloads/source-window'
import { Postprocessor } from './downloads/postprocess'
import { DownloadRepository } from './downloads/repository'
import { DownloadSettingsStore } from './downloads/settings'
import { GoogleDriveAuth } from './drive-auth'
import { loadEnvironment } from './env'
import { GameProcessManager } from './game-processes'
import { HardwareDetector } from './hardware'
import { registerIpcHandlers } from './ipc'
import { CatalogOnlineChecker } from './online-status'
import { SteamPopularityService } from './steam-popularity'
import type { DownloadUpdateEvent, GameStatusEvent, SaveSyncEvent, StoreGame } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let repository: GameRepository | null = null
let processManager: GameProcessManager | null = null
let cloudSaves: CloudSaveManager | null = null
let catalogManager: CatalogManager | null = null
let catalogMetadata: CatalogMetadataEnricher | null = null
let onlineChecker: CatalogOnlineChecker | null = null
let downloadManager: DownloadManager | null = null
let sourceWindows: SourceWindowManager | null = null

function broadcast(channel: string, event: unknown): void {
  // Only the trusted app window receives IPC. Source pages run untrusted
  // third-party content and must never be a broadcast target.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, event)
  }
}

function broadcastGameStatus(event: GameStatusEvent): void {
  broadcast('games:status', event)
}

function broadcastSaveStatus(event: SaveSyncEvent): void {
  broadcast('saves:status', event)
}

function broadcastCatalogGame(game: StoreGame): void {
  broadcast('catalog:game-updated', game)
}

function broadcastDownload(event: DownloadUpdateEvent): void {
  broadcast('downloads:updated', event)
}

/**
 * The renderer is loaded from file:// in production, which sends no HTTP
 * referrer to the YouTube iframe. YouTube rejects those embeds with error 153,
 * so supply a normal web referrer for player requests. This must be a neutral
 * external origin: youtube.com itself is rejected as 152-4, and ayanami.app is
 * an origin YouTube accepts for embedded playback.
 */
const YOUTUBE_EMBED_REFERER = 'https://ayanami.app/'

function installYoutubeReferrer(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*']
    },
    (details, callback) => {
      details.requestHeaders['Referer'] = YOUTUBE_EMBED_REFERER
      callback({ requestHeaders: details.requestHeaders })
    }
  )
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    icon: join(app.getAppPath(), 'assets/icon.png'),
    title: 'Ayanami',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  mainWindow = window
  window.setMenuBarVisibility(false)

  window.once('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
    sourceWindows?.closeAll()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[window] Failed to load preload script ${preloadPath}:`, error)
  })

  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[window] Failed to load ${url} (${code}): ${description}`)
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const hasInstanceLock = app.requestSingleInstanceLock()

const SAMPLE_BOOTSTRAP_MARKER = 'catalog-bootstrap.json'

/**
 * A clean install has no catalog source, so the Store would look empty until
 * the user imported a manifest by hand. Import the bundled sample once, and
 * record that it happened so deliberately removing the source sticks.
 */
function loadBundledSampleOnce(catalog: CatalogManager, userDataPath: string): void {
  const markerPath = join(userDataPath, SAMPLE_BOOTSTRAP_MARKER)
  if (existsSync(markerPath)) return

  try {
    if (catalog.listSources().length === 0) {
      const result = catalog.loadSample()
      console.info(`[catalog] Loaded the bundled sample catalog (${result.importedCount} games).`)
    }
  } catch (error) {
    console.warn('[catalog] Could not load the bundled sample catalog:', error)
  } finally {
    try {
      writeFileSync(
        markerPath,
        JSON.stringify({ bootstrappedAt: new Date().toISOString() }),
        'utf8'
      )
    } catch (error) {
      console.warn('[catalog] Could not record the sample bootstrap marker:', error)
    }
  }
}

if (!hasInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark'
    app.setAppUserModelId('com.ayanami.launcher')
    loadEnvironment()
    installYoutubeReferrer()

    const userDataPath = app.getPath('userData')
    const databasePath = join(userDataPath, 'ayanami.db')
    repository = new GameRepository(databasePath)

    const hardware = new HardwareDetector(join(userDataPath, 'hardware-profile.json'))
    const catalogRepository = new CatalogRepository(databasePath)
    const catalog = new CatalogManager(catalogRepository, {
      samplePath: join(app.getAppPath(), 'sources.sample.json'),
      downloadsDirectory: join(app.getPath('downloads'), 'Ayanami')
    })
    catalogManager = catalog
    loadBundledSampleOnce(catalog, userDataPath)
    catalogMetadata = new CatalogMetadataEnricher(catalogRepository, broadcastCatalogGame)
    const onlineStatusChecker = new CatalogOnlineChecker(catalogRepository, broadcastCatalogGame)
    onlineChecker = onlineStatusChecker
    const benchmarkVideos = new BenchmarkVideoService(catalogRepository)
    void hardware.getProfile().catch((error: unknown) => {
      console.warn('[hardware] Initial detection failed:', error)
    })

    const downloadSettings = new DownloadSettingsStore(
      join(userDataPath, 'download-settings.json'),
      {
        downloadDirectory: join(app.getPath('downloads'), 'Ayanami'),
        gamesDirectory: join(app.getPath('home'), 'Games', 'Ayanami')
      }
    )
    const downloadRepository = new DownloadRepository(databasePath)
    const postprocessor = new Postprocessor(() => downloadSettings.get().gamesDirectory)
    const downloads = new DownloadManager(
      downloadRepository,
      downloadSettings,
      postprocessor,
      broadcastDownload
    )
    downloadManager = downloads
    sourceWindows = new SourceWindowManager(downloads)
    const popularity = new SteamPopularityService(
      catalogRepository,
      join(userDataPath, 'steam-popular.json')
    )

    const driveAuth = new GoogleDriveAuth(join(userDataPath, 'google-drive-auth.json'))
    cloudSaves = new CloudSaveManager(repository, driveAuth, broadcastSaveStatus)
    processManager = new GameProcessManager(repository, broadcastGameStatus, (gameId) => {
      cloudSaves?.scheduleAutoSync(gameId)
    })
    registerIpcHandlers({
      repository,
      processes: processManager,
      driveAuth,
      cloudSaves,
      catalog,
      catalogMetadata,
      downloads,
      sourceWindows,
      popularity,
      hardware,
      onlineChecker: onlineStatusChecker,
      benchmarkVideos
    })

    downloads.initialize()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    sourceWindows?.dispose()
    sourceWindows = null
    downloadManager?.shutdown()
    downloadManager?.close()
    downloadManager = null
    cloudSaves?.shutdown()
    cloudSaves = null
    processManager?.shutdown()
    processManager = null
    catalogMetadata?.shutdown()
    catalogMetadata = null
    onlineChecker?.shutdown()
    onlineChecker = null
    catalogManager?.close()
    catalogManager = null
    repository?.close()
    repository = null
  })
}
