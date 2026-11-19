import type {
  AppInfo,
  BenchmarkLookupResult,
  CatalogSnapshot,
  CatalogSource,
  DownloadQueueItem,
  DownloadSettings,
  DownloadsSnapshot,
  DownloadUpdateEvent,
  DriveStatus,
  Game,
  GameStatusEvent,
  HardwareProfile,
  ImportCatalogResult,
  NewDownloadInput,
  NewGameInput,
  PopularGamesResult,
  ProviderStatus,
  QueueDownloadResult,
  SaveBackup,
  SaveRestoreResult,
  SaveSyncEvent,
  SaveSyncResult,
  SearchResponse,
  StoreGame,
  UpdateGameSettingsInput
} from './types'

export interface AyanamiAPI {
  listGames: () => Promise<Game[]>
  searchGames: (query: string) => Promise<SearchResponse>
  addGame: (input: NewGameInput) => Promise<Game>
  updateGame: (gameId: number, settings: UpdateGameSettingsInput) => Promise<Game>
  launchGame: (gameId: number) => Promise<Game>
  pickExecutable: () => Promise<string | null>
  pickSaveFolder: () => Promise<string | null>
  onGameStatusChanged: (listener: (event: GameStatusEvent) => void) => () => void
  getDriveStatus: () => Promise<DriveStatus>
  connectDrive: () => Promise<DriveStatus>
  disconnectDrive: () => Promise<DriveStatus>
  listSaveBackups: (gameId: number) => Promise<SaveBackup[]>
  syncGameSaves: (gameId: number) => Promise<SaveSyncResult>
  restoreSaveBackup: (gameId: number, backupId: string) => Promise<SaveRestoreResult>
  onSaveSyncChanged: (listener: (event: SaveSyncEvent) => void) => () => void
  getProviderStatus: () => Promise<ProviderStatus>
  getAppInfo: () => Promise<AppInfo>
  listCatalog: () => Promise<CatalogSnapshot>
  listCatalogSources: () => Promise<CatalogSource[]>
  importCatalogSource: () => Promise<ImportCatalogResult | null>
  loadSampleCatalog: () => Promise<ImportCatalogResult>
  refreshCatalogSource: (sourceId: number) => Promise<ImportCatalogResult>
  removeCatalogSource: (sourceId: number) => Promise<CatalogSource[]>
  queueStoreDownload: (gameId: number) => Promise<QueueDownloadResult>
  openSourcePage: (gameId: number) => Promise<void>
  openDownloadPage: (downloadId: number) => Promise<void>
  getPopularGames: () => Promise<PopularGamesResult>
  enrichCatalogGames: (gameIds: number[], force?: boolean) => Promise<number>
  onCatalogGameUpdated: (listener: (game: StoreGame) => void) => () => void
  getHardwareProfile: (forceRefresh?: boolean) => Promise<HardwareProfile>
  getBenchmarkVideo: (gameId: number, force?: boolean) => Promise<BenchmarkLookupResult>
  checkOnlineStatus: (gameId: number, force?: boolean) => Promise<StoreGame>
  listDownloads: () => Promise<DownloadsSnapshot>
  addDownload: (input: NewDownloadInput) => Promise<QueueDownloadResult>
  pauseDownload: (downloadId: number) => Promise<DownloadQueueItem>
  resumeDownload: (downloadId: number) => Promise<DownloadQueueItem>
  removeDownload: (downloadId: number) => Promise<void>
  retryDownloadPostprocess: (downloadId: number) => Promise<DownloadQueueItem>
  openDownloadFolder: (downloadId: number) => Promise<void>
  updateDownloadSettings: (settings: Partial<DownloadSettings>) => Promise<DownloadSettings>
  pickDownloadFolder: (kind: 'downloads' | 'games') => Promise<string | null>
  pickTorrentFile: () => Promise<string | null>
  onDownloadUpdated: (listener: (event: DownloadUpdateEvent) => void) => () => void
}
