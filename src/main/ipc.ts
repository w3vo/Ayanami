import { existsSync, statSync } from 'fs'
import { extname } from 'path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { isDirectDownloadUri, isManualDownloadUri } from '../shared/download-links'
import type { AyanamiAPI } from '../shared/api'
import type {
  AppInfo,
  CatalogSnapshot,
  CatalogSource,
  DownloadQueueItem,
  DownloadSettings,
  DownloadsSnapshot,
  DriveStatus,
  Game,
  HardwareProfile,
  ImportCatalogResult,
  NewDownloadInput,
  NewGameInput,
  PopularGamesResult,
  ProviderStatus,
  QueueDownloadResult,
  SaveBackup,
  SaveRestoreResult,
  SaveSyncResult,
  SearchResponse,
  StoreGame,
  UpdateGameSettingsInput
} from '../shared/types'
import type { CatalogManager } from './catalog'
import type { CatalogMetadataEnricher } from './catalog-metadata'
import type { BenchmarkVideoService } from './benchmark-videos'
import type { CloudSaveManager } from './cloud-saves'
import type { GameRepository } from './db'
import type { DownloadManager } from './downloads/manager'
import type { SourceWindowManager } from './downloads/source-window'
import type { GoogleDriveAuth } from './drive-auth'
import type { GameProcessManager } from './game-processes'
import type { HardwareDetector } from './hardware'
import type { CatalogOnlineChecker } from './online-status'
import type { SteamPopularityService } from './steam-popularity'
import { getProviderStatus, searchGames } from './metadata'

interface IpcDependencies {
  repository: GameRepository
  processes: GameProcessManager
  driveAuth: GoogleDriveAuth
  cloudSaves: CloudSaveManager
  catalog: CatalogManager
  catalogMetadata: CatalogMetadataEnricher
  downloads: DownloadManager
  sourceWindows: SourceWindowManager
  popularity: SteamPopularityService
  hardware: HardwareDetector
  onlineChecker: CatalogOnlineChecker
  benchmarkVideos: BenchmarkVideoService
}

function isArtworkUrl(value: string): boolean {
  if (value.startsWith('data:image/')) return true
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function normalizeId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}

function normalizeNewGame(raw: unknown, repository: GameRepository): NewGameInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('The game details are invalid.')
  }

  const input = raw as Record<string, unknown>
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const exePath = typeof input.exePath === 'string' ? input.exePath.trim() : ''
  const rawSaveFolder =
    typeof input.saveFolderPath === 'string' ? input.saveFolderPath.trim() : ''
  const saveFolderPath = rawSaveFolder || null

  if (!title) throw new Error('A game title is required.')
  if (title.length > 200) throw new Error('The game title is too long.')
  if (!exePath) throw new Error('Choose a game executable before saving.')
  if (extname(exePath).toLowerCase() !== '.exe') {
    throw new Error('The selected game file must be a Windows .exe executable.')
  }
  if (!existsSync(exePath) || !statSync(exePath).isFile()) {
    throw new Error('The selected game executable could not be found.')
  }
  if (saveFolderPath && (!existsSync(saveFolderPath) || !statSync(saveFolderPath).isDirectory())) {
    throw new Error('The selected save folder could not be found.')
  }

  const existingGame = repository
    .listGames()
    .find((game) => game.exePath.toLowerCase() === exePath.toLowerCase())
  if (existingGame) {
    throw new Error(`This executable is already linked to "${existingGame.title}".`)
  }

  const coverUrl =
    typeof input.coverUrl === 'string' && isArtworkUrl(input.coverUrl)
      ? input.coverUrl
      : null
  const heroUrl =
    typeof input.heroUrl === 'string' && isArtworkUrl(input.heroUrl)
      ? input.heroUrl
      : null

  return {
    title,
    igdbId: normalizeId(input.igdbId),
    steamgriddbId: normalizeId(input.steamgriddbId),
    coverUrl,
    heroUrl,
    exePath,
    saveFolderPath
  }
}

function normalizeGameId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Invalid game selection.')
  }
  return value
}

function normalizeStoreGameId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Invalid store game selection.')
  }
  return value
}

function normalizeSourceId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Invalid catalog source selection.')
  }
  return value
}

function normalizeGameSettings(
  raw: unknown,
  current: Game
): UpdateGameSettingsInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('The game settings are invalid.')
  }

  const input = raw as Record<string, unknown>
  const rawSaveFolder =
    typeof input.saveFolderPath === 'string' ? input.saveFolderPath.trim() : ''
  const saveFolderPath =
    input.saveFolderPath === null || (typeof input.saveFolderPath === 'string' && !rawSaveFolder)
      ? null
      : rawSaveFolder || current.saveFolderPath
  const autoSyncEnabled =
    typeof input.autoSyncEnabled === 'boolean'
      ? input.autoSyncEnabled
      : current.autoSyncEnabled

  if (saveFolderPath && saveFolderPath.length > 4096) {
    throw new Error('The save folder path is too long.')
  }
  if (
    saveFolderPath &&
    (!existsSync(saveFolderPath) || !statSync(saveFolderPath).isDirectory())
  ) {
    throw new Error('The selected save folder could not be found.')
  }
  if (autoSyncEnabled && !saveFolderPath) {
    throw new Error('Choose a save folder before turning on automatic backups.')
  }

  return { saveFolderPath, autoSyncEnabled }
}

function normalizeDownloadId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Invalid download selection.')
  }
  return value
}

function normalizeNewDownload(raw: unknown): NewDownloadInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Enter a magnet link or an http(s) download URL, or choose a .torrent file.')
  }

  const input = raw as Record<string, unknown>
  const uri = typeof input.uri === 'string' ? input.uri.trim() : ''
  const torrentPath = typeof input.torrentPath === 'string' ? input.torrentPath.trim() : ''

  if (torrentPath) {
    if (torrentPath.length > 4_096) throw new Error('That torrent file path is too long.')
    if (extname(torrentPath).toLowerCase() !== '.torrent') {
      throw new Error('Choose a .torrent file.')
    }
    if (!existsSync(torrentPath) || !statSync(torrentPath).isFile()) {
      throw new Error('That .torrent file could not be found.')
    }
  } else {
    if (!uri) {
      throw new Error('Enter a magnet link or an http(s) download URL, or choose a .torrent file.')
    }
    if (uri.length > 8_192) throw new Error('That download link is too long.')
    if (!/^(magnet:|https?:\/\/)/i.test(uri)) {
      throw new Error('Only magnet links and http(s) download URLs are supported.')
    }
  }

  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const savePath = typeof input.savePath === 'string' ? input.savePath.trim() : ''
  const releaseType = input.releaseType === 'repack' ? 'repack' : 'preinstalled'

  return {
    ...(torrentPath ? { torrentPath } : { uri }),
    releaseType,
    ...(title ? { title: title.slice(0, 240) } : {}),
    ...(savePath ? { savePath } : {})
  }
}

function normalizeDownloadSettings(raw: unknown): Partial<DownloadSettings> {
  if (!raw || typeof raw !== 'object') {
    throw new Error('The download settings are invalid.')
  }

  const input = raw as Record<string, unknown>
  const downloadDirectory =
    typeof input.downloadDirectory === 'string' ? input.downloadDirectory.trim() : ''
  const gamesDirectory =
    typeof input.gamesDirectory === 'string' ? input.gamesDirectory.trim() : ''

  if (downloadDirectory.length > 4_096 || gamesDirectory.length > 4_096) {
    throw new Error('That folder path is too long.')
  }

  return {
    ...(downloadDirectory ? { downloadDirectory } : {}),
    ...(gamesDirectory ? { gamesDirectory } : {})
  }
}

function normalizeDirectoryKind(value: unknown): 'downloads' | 'games' {
  if (value === 'downloads' || value === 'games') return value
  throw new Error('Invalid folder selection.')
}

export function registerIpcHandlers({
  repository,
  processes,
  driveAuth,
  cloudSaves,
  catalog,
  catalogMetadata,
  downloads,
  sourceWindows,
  popularity,
  hardware,
  onlineChecker,
  benchmarkVideos
}: IpcDependencies): void {
  ipcMain.handle('games:list', (): Game[] => {
    return processes.decorateAll(repository.listGames())
  })

  ipcMain.handle('games:search', async (_event, query: unknown): Promise<SearchResponse> => {
    if (typeof query !== 'string') {
      throw new Error('Enter a game title to search for.')
    }
    return searchGames(query.slice(0, 120))
  })

  ipcMain.handle('games:add', (_event, raw: unknown): Game => {
    const input = normalizeNewGame(raw, repository)
    return repository.addGame(input)
  })

  ipcMain.handle(
    'games:update',
    (_event, rawGameId: unknown, rawSettings: unknown): Game => {
      const gameId = normalizeGameId(rawGameId)
      const current = repository.getGame(gameId)
      if (!current) throw new Error('That game is no longer in your library.')

      const settings = normalizeGameSettings(rawSettings, current)
      const updated = repository.updateGameSettings(
        gameId,
        settings.saveFolderPath,
        settings.autoSyncEnabled
      )

      if (!updated.autoSyncEnabled || !updated.saveFolderPath) {
        cloudSaves.cancelAutoSync(gameId, 'Automatic backups were turned off.')
      }

      return processes.decorateAll([updated])[0]
    }
  )

  ipcMain.handle('games:launch', async (_event, rawGameId: unknown): Promise<Game> => {
    const gameId = normalizeGameId(rawGameId)
    const launched = await processes.launch(gameId)
    cloudSaves.cancelAutoSync(
      gameId,
      'The pending automatic backup was canceled because the game was launched again.'
    )
    return launched
  })

  ipcMain.handle('games:pick-executable', async (event): Promise<string | null> => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Select game executable',
      buttonLabel: 'Select executable',
      properties: ['openFile'],
      filters: [
        { name: 'Windows applications', extensions: ['exe'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('games:pick-save-folder', async (event): Promise<string | null> => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Select this game’s save folder',
      buttonLabel: 'Use save folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('drive:status', (): DriveStatus => {
    return driveAuth.getStatus()
  })

  ipcMain.handle('drive:connect', async (): Promise<DriveStatus> => {
    return driveAuth.connect()
  })

  ipcMain.handle('drive:disconnect', async (): Promise<DriveStatus> => {
    const status = await driveAuth.disconnect()
    cloudSaves.cancelAllAutoSync('Google Drive was disconnected.')
    return status
  })

  ipcMain.handle('saves:list', async (_event, rawGameId: unknown): Promise<SaveBackup[]> => {
    const gameId = normalizeGameId(rawGameId)
    return cloudSaves.listBackups(gameId)
  })

  ipcMain.handle('saves:sync', async (_event, rawGameId: unknown): Promise<SaveSyncResult> => {
    const gameId = normalizeGameId(rawGameId)
    if (processes.isRunning(gameId)) {
      throw new Error('Close the game before backing up its saves.')
    }
    return cloudSaves.syncNow(gameId, 'manual')
  })

  ipcMain.handle(
    'saves:restore',
    async (_event, rawGameId: unknown, backupId: unknown): Promise<SaveRestoreResult> => {
      const gameId = normalizeGameId(rawGameId)
      if (typeof backupId !== 'string' || !backupId.trim()) {
        throw new Error('Choose a backup to restore.')
      }
      if (processes.isRunning(gameId)) {
        throw new Error('Close the game before restoring a backup.')
      }
      return cloudSaves.restore(gameId, backupId)
    }
  )

  ipcMain.handle('metadata:provider-status', (): ProviderStatus => {
    return getProviderStatus()
  })

  ipcMain.handle('catalog:list', async (): Promise<CatalogSnapshot> => {
    const hardwareProfile = await hardware.getProfile()
    return {
      sources: catalog.listSources(),
      games: catalog.listGames(),
      hardware: hardwareProfile
    }
  })

  ipcMain.handle('catalog:sources', (): CatalogSource[] => {
    return catalog.listSources()
  })

  ipcMain.handle('catalog:import', async (event): Promise<ImportCatalogResult | null> => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Import catalog source',
      buttonLabel: 'Import source',
      properties: ['openFile'],
      filters: [
        { name: 'Ayanami or Hydra/SteamRip sources', extensions: ['json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return catalog.importSource(result.filePaths[0])
  })

  ipcMain.handle('catalog:load-sample', (): ImportCatalogResult => {
    return catalog.loadSample()
  })

  ipcMain.handle('catalog:refresh-source', (_event, rawSourceId: unknown): ImportCatalogResult => {
    return catalog.refreshSource(normalizeSourceId(rawSourceId))
  })

  ipcMain.handle('catalog:remove-source', (_event, rawSourceId: unknown): CatalogSource[] => {
    return catalog.removeSource(normalizeSourceId(rawSourceId))
  })

  ipcMain.handle(
    'catalog:queue-download',
    async (_event, rawGameId: unknown): Promise<QueueDownloadResult> => {
      const game = catalog.getGame(normalizeStoreGameId(rawGameId))
      if (!game) throw new Error('That game is no longer in the catalog.')
      if (!game.download.url) throw new Error('This catalog entry does not include a download.')

      // A manual host (1fichier, Gofile, MegaDB, VikingFile, Datanodes) needs a
      // visible page: countdowns and CAPTCHAs must never be automated. The page
      // hands its real download back through the source-window capture.
      if (
        isManualDownloadUri(game.download.url) &&
        !isDirectDownloadUri(game.download.url)
      ) {
        await sourceWindows.open({
          url: game.download.url,
          title: game.title,
          releaseType: game.download.releaseType ?? 'preinstalled',
          originUri: game.download.url
        })
        return { item: null, alreadyQueued: false, manualPage: true }
      }

      return downloads.queueStoreGame(game)
    }
  )

  ipcMain.handle('catalog:open-source', async (_event, rawGameId: unknown): Promise<void> => {
    const game = catalog.getGame(normalizeStoreGameId(rawGameId))
    if (!game) throw new Error('That game is no longer in the catalog.')
    if (!game.download.url) throw new Error('This catalog entry does not include a download.')
    await sourceWindows.open({
      url: game.download.url,
      title: game.title,
      releaseType: game.download.releaseType ?? 'preinstalled',
      originUri: game.download.url
    })
  })

  ipcMain.handle('catalog:popular', async (): Promise<PopularGamesResult> => {
    const result = await popularity.getPopularGames()
    const pendingIds = result.games
      .filter((game) => game.metadataStatus === 'pending')
      .map((game) => game.id)
    if (pendingIds.length > 0) {
      catalogMetadata.enqueue(pendingIds)
    }
    return result
  })

  ipcMain.handle(
    'catalog:enrich',
    (_event, rawGameIds: unknown, rawForce: unknown): number => {
      if (!Array.isArray(rawGameIds)) return 0
      const gameIds = [...new Set(rawGameIds)]
        .filter(
          (value): value is number =>
            typeof value === 'number' && Number.isInteger(value) && value > 0
        )
        .slice(0, 500)
      return catalogMetadata.enqueue(gameIds, rawForce === true)
    }
  )

  ipcMain.handle(
    'catalog:benchmark-video',
    async (_event, rawGameId: unknown, rawForce: unknown) => {
      const gameId = normalizeStoreGameId(rawGameId)
      const profile = await hardware.getProfile()
      return benchmarkVideos.getForGame(gameId, profile, rawForce === true)
    }
  )

  ipcMain.handle(
    'catalog:check-online',
    async (_event, rawGameId: unknown, rawForce: unknown): Promise<StoreGame> => {
      return onlineChecker.checkNow(normalizeStoreGameId(rawGameId), rawForce === true)
    }
  )

  ipcMain.handle('hardware:get', async (_event, rawForceRefresh: unknown): Promise<HardwareProfile> => {
    return hardware.getProfile(rawForceRefresh === true)
  })

  ipcMain.handle('downloads:list', (): DownloadsSnapshot => {
    return {
      items: downloads.list(),
      settings: downloads.getSettings()
    }
  })

  ipcMain.handle('downloads:add', (_event, raw: unknown): QueueDownloadResult => {
    return downloads.add(normalizeNewDownload(raw))
  })

  ipcMain.handle('downloads:open-page', async (_event, rawId: unknown): Promise<void> => {
    const id = normalizeDownloadId(rawId)
    const item = downloads.list().find((candidate) => candidate.id === id)
    if (!item) throw new Error('That download no longer exists.')
    const origin = downloads.getOriginUri(id)
    if (!origin || !/^https?:\/\//i.test(origin)) {
      throw new Error('This download has no source page to reopen.')
    }
    await sourceWindows.open({
      url: origin,
      title: item.title,
      releaseType: item.releaseType,
      originUri: origin,
      savePath: item.savePath
    })
  })

  ipcMain.handle('downloads:pause', (_event, rawId: unknown): DownloadQueueItem => {
    return downloads.pause(normalizeDownloadId(rawId))
  })

  ipcMain.handle('downloads:resume', (_event, rawId: unknown): DownloadQueueItem => {
    return downloads.resume(normalizeDownloadId(rawId))
  })

  ipcMain.handle('downloads:remove', (_event, rawId: unknown): void => {
    downloads.remove(normalizeDownloadId(rawId))
  })

  ipcMain.handle(
    'downloads:retry-postprocess',
    (_event, rawId: unknown): DownloadQueueItem => {
      return downloads.retryPostprocess(normalizeDownloadId(rawId))
    }
  )

  ipcMain.handle('downloads:open-folder', async (_event, rawId: unknown): Promise<void> => {
    const item = downloads
      .list()
      .find((candidate) => candidate.id === normalizeDownloadId(rawId))
    if (!item) throw new Error('That download no longer exists.')

    const target = item.filePath && existsSync(item.filePath) ? item.filePath : item.savePath
    if (!existsSync(target)) {
      throw new Error('That download folder is not available yet.')
    }

    if (statSync(target).isFile()) {
      shell.showItemInFolder(target)
      return
    }

    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  })

  ipcMain.handle(
    'downloads:update-settings',
    (_event, raw: unknown): DownloadSettings => {
      return downloads.updateSettings(normalizeDownloadSettings(raw))
    }
  )

  ipcMain.handle(
    'downloads:pick-folder',
    async (event, rawKind: unknown): Promise<string | null> => {
      const kind = normalizeDirectoryKind(rawKind)
      const parent = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title:
          kind === 'games'
            ? 'Select the Games folder'
            : 'Select the Downloads folder',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory']
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  )

  ipcMain.handle(
    'downloads:pick-torrent-file',
    async (event): Promise<string | null> => {
      const parent = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: 'Select a .torrent file',
        buttonLabel: 'Add torrent',
        properties: ['openFile'],
        filters: [{ name: 'Torrent files', extensions: ['torrent'] }]
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  )

  ipcMain.handle('app:info', (): AppInfo => {
    return {
      version: app.getVersion(),
      dbPath: repository.path,
      userDataPath: app.getPath('userData')
    }
  })
}

/** Keeps the preload contract and the main handlers in the same compile check. */
export type IpcContract = AyanamiAPI
