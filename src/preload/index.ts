import { contextBridge, ipcRenderer } from 'electron'
import type { AyanamiAPI } from '../shared/api'
import type { DownloadUpdateEvent, GameStatusEvent, SaveSyncEvent, StoreGame } from '../shared/types'

const api: AyanamiAPI = {
  listGames: () => ipcRenderer.invoke('games:list'),
  searchGames: (query) => ipcRenderer.invoke('games:search', query),
  addGame: (input) => ipcRenderer.invoke('games:add', input),
  updateGame: (gameId, settings) => ipcRenderer.invoke('games:update', gameId, settings),
  launchGame: (gameId) => ipcRenderer.invoke('games:launch', gameId),
  pickExecutable: () => ipcRenderer.invoke('games:pick-executable'),
  pickSaveFolder: () => ipcRenderer.invoke('games:pick-save-folder'),
  onGameStatusChanged: (listener) => {
    const handleStatus = (_event: Electron.IpcRendererEvent, status: GameStatusEvent): void => {
      listener(status)
    }
    ipcRenderer.on('games:status', handleStatus)
    return () => {
      ipcRenderer.removeListener('games:status', handleStatus)
    }
  },
  getDriveStatus: () => ipcRenderer.invoke('drive:status'),
  connectDrive: () => ipcRenderer.invoke('drive:connect'),
  disconnectDrive: () => ipcRenderer.invoke('drive:disconnect'),
  listSaveBackups: (gameId) => ipcRenderer.invoke('saves:list', gameId),
  syncGameSaves: (gameId) => ipcRenderer.invoke('saves:sync', gameId),
  restoreSaveBackup: (gameId, backupId) =>
    ipcRenderer.invoke('saves:restore', gameId, backupId),
  onSaveSyncChanged: (listener) => {
    const handleStatus = (_event: Electron.IpcRendererEvent, status: SaveSyncEvent): void => {
      listener(status)
    }
    ipcRenderer.on('saves:status', handleStatus)
    return () => {
      ipcRenderer.removeListener('saves:status', handleStatus)
    }
  },
  getProviderStatus: () => ipcRenderer.invoke('metadata:provider-status'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  listCatalog: () => ipcRenderer.invoke('catalog:list'),
  listCatalogSources: () => ipcRenderer.invoke('catalog:sources'),
  importCatalogSource: () => ipcRenderer.invoke('catalog:import'),
  loadSampleCatalog: () => ipcRenderer.invoke('catalog:load-sample'),
  refreshCatalogSource: (sourceId) => ipcRenderer.invoke('catalog:refresh-source', sourceId),
  removeCatalogSource: (sourceId) => ipcRenderer.invoke('catalog:remove-source', sourceId),
  queueStoreDownload: (gameId) => ipcRenderer.invoke('catalog:queue-download', gameId),
  openSourcePage: (gameId) => ipcRenderer.invoke('catalog:open-source', gameId),
  openDownloadPage: (downloadId) => ipcRenderer.invoke('downloads:open-page', downloadId),
  getPopularGames: () => ipcRenderer.invoke('catalog:popular'),
  enrichCatalogGames: (gameIds, force) =>
    ipcRenderer.invoke('catalog:enrich', gameIds, force === true),
  onCatalogGameUpdated: (listener) => {
    const handleGameUpdated = (
      _event: Electron.IpcRendererEvent,
      game: StoreGame
    ): void => {
      listener(game)
    }
    ipcRenderer.on('catalog:game-updated', handleGameUpdated)
    return () => {
      ipcRenderer.removeListener('catalog:game-updated', handleGameUpdated)
    }
  },
  getHardwareProfile: (forceRefresh) =>
    ipcRenderer.invoke('hardware:get', forceRefresh === true),
  getBenchmarkVideo: (gameId, force) =>
    ipcRenderer.invoke('catalog:benchmark-video', gameId, force === true),
  checkOnlineStatus: (gameId, force) =>
    ipcRenderer.invoke('catalog:check-online', gameId, force === true),
  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  addDownload: (input) => ipcRenderer.invoke('downloads:add', input),
  pauseDownload: (downloadId) => ipcRenderer.invoke('downloads:pause', downloadId),
  resumeDownload: (downloadId) => ipcRenderer.invoke('downloads:resume', downloadId),
  removeDownload: (downloadId) => ipcRenderer.invoke('downloads:remove', downloadId),
  retryDownloadPostprocess: (downloadId) =>
    ipcRenderer.invoke('downloads:retry-postprocess', downloadId),
  openDownloadFolder: (downloadId) => ipcRenderer.invoke('downloads:open-folder', downloadId),
  updateDownloadSettings: (settings) =>
    ipcRenderer.invoke('downloads:update-settings', settings),
  pickDownloadFolder: (kind) => ipcRenderer.invoke('downloads:pick-folder', kind),
  pickTorrentFile: () => ipcRenderer.invoke('downloads:pick-torrent-file'),
  onDownloadUpdated: (listener) => {
    const handleUpdated = (
      _event: Electron.IpcRendererEvent,
      update: DownloadUpdateEvent
    ): void => {
      listener(update)
    }
    ipcRenderer.on('downloads:updated', handleUpdated)
    return () => {
      ipcRenderer.removeListener('downloads:updated', handleUpdated)
    }
  }
}

contextBridge.exposeInMainWorld('ayanami', api)
