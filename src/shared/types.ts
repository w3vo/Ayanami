export interface Game {
  id: number
  title: string
  igdbId: number | null
  steamgriddbId: number | null
  coverUrl: string | null
  heroUrl: string | null
  exePath: string
  saveFolderPath: string | null
  totalPlaytimeSeconds: number
  lastPlayedAt: string | null
  autoSyncEnabled: boolean
  lastSyncedAt: string | null
  createdAt: string
  isRunning: boolean
}

export interface NewGameInput {
  title: string
  igdbId: number | null
  steamgriddbId: number | null
  coverUrl: string | null
  heroUrl: string | null
  exePath: string
  saveFolderPath: string | null
}

export type MetadataSource = 'steamgriddb' | 'igdb' | 'demo'

export interface GameSearchResult {
  key: string
  title: string
  igdbId: number | null
  steamgriddbId: number | null
  coverUrl: string | null
  heroUrl: string | null
  releaseYear: number | null
  genres: string[]
  sources: MetadataSource[]
}

export type ProviderState = 'live' | 'unconfigured' | 'error'

export interface SearchResponse {
  query: string
  results: GameSearchResult[]
  demoMode: boolean
  providers: {
    steamgriddb: ProviderState
    igdb: ProviderState
  }
  notice?: string
}

export interface ProviderStatus {
  steamgriddb: boolean
  igdb: boolean
  googleDrive: boolean
}

export interface DriveStatus {
  configured: boolean
  connected: boolean
  accountEmail: string | null
  accountName: string | null
  accountAvatarUrl: string | null
  connectedAt: string | null
}

export interface UpdateGameSettingsInput {
  saveFolderPath: string | null
  autoSyncEnabled: boolean
}

export interface SaveBackup {
  id: string
  name: string
  sizeBytes: number
  createdAt: string
}

export interface SaveSyncResult {
  game: Game
  backups: SaveBackup[]
}

export interface SaveRestoreResult {
  game: Game
  backup: SaveBackup
  restoredFiles: number
}

export type SaveSyncPhase = 'scheduled' | 'syncing' | 'synced' | 'canceled' | 'error'

export interface SaveSyncEvent {
  gameId: number
  phase: SaveSyncPhase
  trigger: 'manual' | 'auto'
  game?: Game
  backups?: SaveBackup[]
  scheduledFor?: string
  message?: string
}

export interface GameStatusEvent {
  gameId: number
  isRunning: boolean
  game: Game
}

export interface AppInfo {
  version: string
  dbPath: string
  userDataPath: string
}

/* Store catalog & hardware compatibility */

export type OnlineStatus = 'offline' | 'online-fix'

export type DownloadType = 'torrent' | 'http'

export type ReleaseType = 'preinstalled' | 'repack'

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'complete' | 'error'

export type DownloadPostprocessStatus =
  | 'idle'
  | 'pending'
  | 'extracting'
  | 'installing'
  | 'ready'
  | 'error'

export type MetadataStatus = 'pending' | 'ready' | 'missing' | 'error'

export interface RequirementTier {
  cpu: string | null
  gpu: string | null
  ramGb: number | null
  storageGb: number | null
  /** PassMark CPU Mark for the strongest listed CPU alternative. */
  cpuBenchmark: number | null
  /** PassMark G3D Mark for the strongest listed GPU alternative. */
  gpuBenchmark: number | null
  /** Matched PassMark entry used for this tier. */
  cpuBenchmarkModel: string | null
  gpuBenchmarkModel: string | null
  /** True when the spec is generic (for example "3.8 GHz" or "DirectX compatible"). */
  cpuGeneric: boolean
  gpuGeneric: boolean
}

export interface SystemRequirements {
  minimum: RequirementTier
  recommended: RequirementTier
}

export interface StoreDownload {
  url: string | null
  type: DownloadType | null
  releaseType: ReleaseType | null
  sizeBytes: number | null
  mirrors: string[]
}

export interface StoreGame {
  id: number
  sourceId: number
  sourceName: string
  slug: string
  title: string
  synopsis: string
  releaseYear: number | null
  developer: string | null
  publisher: string | null
  genres: string[]
  coverUrl: string | null
  heroUrl: string | null
  screenshots: string[]
  onlineStatus: OnlineStatus
  onlineCheckedAt: string | null
  onlineMatchUrl: string | null
  /** Derived from Co-op, Multiplayer, or Online in the title only. */
  onlineByKeyword: boolean
  storageGb: number | null
  requirements: SystemRequirements
  download: StoreDownload
  catalogAddedAt: string | null
  steamAppId: number | null
  metadataStatus: MetadataStatus
  metadataUpdatedAt: string | null
  importedAt: string
}

export interface StoreMetadata {
  steamAppId: number
  synopsis: string
  releaseYear: number | null
  developer: string | null
  publisher: string | null
  genres: string[]
  coverUrl: string | null
  heroUrl: string | null
  screenshots: string[]
  requirements: SystemRequirements
}

export interface CatalogSource {
  id: number
  name: string
  description: string | null
  path: string
  manifestVersion: number | null
  gameCount: number
  isSample: boolean
  importedAt: string
  updatedAt: string
}

export interface HardwareProfile {
  cpu: string
  cpuVendor: string | null
  cpuCores: number | null
  cpuThreads: number | null
  cpuSpeedGhz: number | null
  cpuBenchmark: number | null
  gpu: string
  gpuVendor: string | null
  gpuVramGb: number | null
  gpuBenchmark: number | null
  memoryGb: number
  freeStorageGb: number | null
  totalStorageGb: number | null
  storageDrive: string | null
  os: string
  detectedAt: string
  fromCache: boolean
}

export type CompatibilityTier = 'recommended' | 'minimum' | 'below' | 'unknown'

export type RequirementKey = 'cpu' | 'gpu' | 'ram' | 'storage'

export type RequirementCheckStatus = 'pass' | 'warn' | 'fail' | 'unknown'

export interface RequirementCheck {
  key: RequirementKey
  label: string
  required: string
  detected: string
  status: RequirementCheckStatus
  detail: string | null
}

export type CompatibilityVerdict = 'meets' | 'near' | 'below' | 'unknown'

export interface CompatibilityLevel {
  verdict: CompatibilityVerdict
  label: string
  checks: RequirementCheck[]
}

export interface CompatibilityResult {
  tier: CompatibilityTier
  label: string
  description: string
  minimum: CompatibilityLevel
  recommended: CompatibilityLevel
}

export interface BenchmarkVideo {
  videoId: string
  title: string
  channel: string | null
  watchUrl: string
  embedUrl: string
  thumbnailUrl: string
  searchUrl: string
  query: string
  fetchedAt: string
}

export type BenchmarkLookupResult =
  | { status: 'found'; video: BenchmarkVideo }
  | { status: 'empty'; query: string; searchUrl: string }
  | { status: 'error'; query: string; searchUrl: string; message: string }

export interface CatalogSnapshot {
  sources: CatalogSource[]
  games: StoreGame[]
  hardware: HardwareProfile
}

export interface ImportCatalogResult {
  source: CatalogSource
  importedCount: number
  replaced: boolean
  warnings: string[]
}

export interface DownloadQueueItem {
  id: number
  title: string
  sourceUri: string
  downloadType: DownloadType
  releaseType: ReleaseType
  status: DownloadStatus
  /** Completion percentage from 0 to 100. */
  progress: number
  savePath: string
  downloadedBytes: number
  totalBytes: number | null
  /** Current download rate in bytes per second. */
  downloadSpeed: number
  /** Current upload/seeding rate in bytes per second. */
  uploadSpeed: number
  etaSeconds: number | null
  /** Downloaded archive, installer, or torrent content root. */
  filePath: string | null
  errorMessage: string | null
  postprocessStatus: DownloadPostprocessStatus
  postprocessMessage: string | null
  createdAt: string
  completedAt: string | null
  updatedAt: string | null
}

export interface DownloadSettings {
  downloadDirectory: string
  gamesDirectory: string
}

export interface NewDownloadInput {
  title?: string
  uri?: string
  /** Local .torrent file chosen from disk. Takes precedence over uri. */
  torrentPath?: string
  releaseType: ReleaseType
  savePath?: string
}

export interface DownloadsSnapshot {
  items: DownloadQueueItem[]
  settings: DownloadSettings
}

export interface DownloadUpdateEvent {
  id: number
  /** Null means the download was removed from the queue. */
  item: DownloadQueueItem | null
}

export interface QueueDownloadResult {
  /** Null when a manual source page was opened instead of a queue entry. */
  item: DownloadQueueItem | null
  alreadyQueued: boolean
  /** True when the host's page was opened for the user to drive. */
  manualPage?: boolean
}

export interface PopularGamesResult {
  games: StoreGame[]
  source: 'steam' | 'catalog'
  updatedAt: string
}
