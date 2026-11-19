import { randomUUID } from 'crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import type { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import AdmZip from 'adm-zip'
import { google } from 'googleapis'
import type { drive_v3 } from 'googleapis'
import type {
  Game,
  SaveBackup,
  SaveRestoreResult,
  SaveSyncEvent,
  SaveSyncResult
} from '../shared/types'
import type { GameRepository } from './db'
import type { GoogleDriveAuth } from './drive-auth'

const ROOT_FOLDER_NAME = 'Ayanami_Saves'
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const ZIP_MIME_TYPE = 'application/zip'
const MAX_BACKUPS = 3
export const AUTO_SYNC_DELAY_MS = 2 * 60 * 1000

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function sanitizeFolderName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!cleaned) return 'Game'
  return cleaned.slice(0, 80).trim() || 'Game'
}

function archiveName(date: Date): string {
  const stamp = date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '')
  return `save-${stamp}.zip`
}

function parseBackup(file: drive_v3.Schema$File): SaveBackup | null {
  if (!file.id || !file.name || !file.name.toLowerCase().endsWith('.zip')) return null
  return {
    id: file.id,
    name: file.name,
    sizeBytes: Number(file.size ?? 0),
    createdAt: file.createdTime ?? file.modifiedTime ?? new Date(0).toISOString()
  }
}

function sortBackups(backups: SaveBackup[]): SaveBackup[] {
  return [...backups].sort(
    (first, second) =>
      new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime() ||
      second.name.localeCompare(first.name)
  )
}

function googleErrorMessage(error: Error): string {
  const response = (
    error as Error & {
      response?: { data?: { error?: string | { message?: string } } }
    }
  ).response
  const data = response?.data?.error
  if (typeof data === 'string' && data.trim()) return data
  if (data && typeof data === 'object' && typeof data.message === 'string') return data.message
  return error.message
}

function removeTemporaryFile(filePath: string): void {
  try {
    rmSync(filePath, { force: true })
  } catch (error) {
    console.warn(`[cloud-saves] Could not remove temporary file ${filePath}:`, error)
  }
}

function friendlyDriveError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error('Google Drive could not complete that request. Please try again.')
  }

  const message = googleErrorMessage(error)
  if (/invalid_grant|token has been expired or revoked|unauthorized/i.test(message)) {
    return new Error(
      'Your Google Drive connection has expired. Reconnect it in Settings and try again.'
    )
  }
  if (/insufficient authentication scopes|insufficient scope|invalid_scope/i.test(message)) {
    return new Error(
      'Ayanami is connected to Google without Drive access. Reconnect Google Drive in Settings and keep the Google Drive permission checked.'
    )
  }
  if (/insufficientpermissions|insufficient permission|forbidden|not granted/i.test(message)) {
    return new Error(
      'Ayanami does not have permission to access that part of Google Drive. Reconnect the account in Settings and try again.'
    )
  }
  if (/storagequotaexceeded/i.test(message)) {
    return new Error('Your Google Drive is full. Free up space, then try the backup again.')
  }
  if (/ratelimitexceeded|userratelimitexceeded|quotaexceeded|backend error/i.test(message)) {
    return new Error('Google Drive is busy right now. Wait a moment, then try again.')
  }
  if (
    /enotfound|econnrefused|econnreset|etimedout|network|fetch failed|socket hang up/i.test(
      message
    )
  ) {
    return new Error(
      'Google Drive could not be reached. Check your internet connection and try again.'
    )
  }

  const trimmed = message.trim()
  if (!trimmed) return new Error('Google Drive could not complete that request. Please try again.')
  return new Error(trimmed.length > 320 ? `${trimmed.slice(0, 317)}…` : trimmed)
}

export class CloudSaveManager {
  private readonly timers = new Map<number, NodeJS.Timeout>()
  private readonly activeSyncs = new Map<number, Promise<SaveSyncResult>>()

  constructor(
    private readonly repository: GameRepository,
    private readonly driveAuth: GoogleDriveAuth,
    private readonly notify: (event: SaveSyncEvent) => void
  ) {}

  async listBackups(gameId: number): Promise<SaveBackup[]> {
    const game = this.requireGame(gameId)
    try {
      const drive = this.createDriveClient()
      const folderId = await this.findGameFolder(drive, game, false)
      if (!folderId) return []
      return await this.listFolderBackups(drive, folderId)
    } catch (error) {
      throw friendlyDriveError(error)
    }
  }

  /**
   * Uploads a new archive and prunes anything older than the newest three.
   * Concurrent requests for the same game share one upload.
   */
  async syncNow(gameId: number, trigger: 'manual' | 'auto' = 'manual'): Promise<SaveSyncResult> {
    const existing = this.activeSyncs.get(gameId)
    if (existing) return existing

    if (trigger === 'manual') this.clearAutoSyncTimer(gameId)

    const task = (async (): Promise<SaveSyncResult> => {
      try {
        return await this.performSync(gameId, trigger)
      } finally {
        this.activeSyncs.delete(gameId)
      }
    })()

    this.activeSyncs.set(gameId, task)
    return task
  }

  async restore(gameId: number, backupId: string): Promise<SaveRestoreResult> {
    if (typeof backupId !== 'string' || !backupId.trim()) {
      throw new Error('Choose a backup to restore.')
    }

    const game = this.requireGame(gameId)
    const saveFolder = this.resolveRestoreFolder(game)

    try {
      const drive = this.createDriveClient()
      const folderId = await this.findGameFolder(drive, game, false)
      if (!folderId) {
        throw new Error('There are no cloud backups for this game yet.')
      }

      const backups = await this.listFolderBackups(drive, folderId)
      const backup = backups.find((entry) => entry.id === backupId)
      if (!backup) {
        throw new Error('That backup is no longer available on Google Drive. Refresh and try again.')
      }

      mkdirSync(saveFolder, { recursive: true })
      const temporaryPath = join(tmpdir(), `ayanami-restore-${gameId}-${randomUUID()}.zip`)

      try {
        const download = await drive.files.get(
          { fileId: backup.id, alt: 'media' },
          { responseType: 'stream' }
        )
        await pipeline(
          download.data as unknown as Readable,
          createWriteStream(temporaryPath)
        )

        const zip = new AdmZip(temporaryPath)
        const entries = zip.getEntries()
        this.assertSafeArchive(entries, saveFolder)
        zip.extractAllTo(saveFolder, true)

        return {
          game,
          backup,
          restoredFiles: entries.filter((entry) => !entry.isDirectory).length
        }
      } finally {
        removeTemporaryFile(temporaryPath)
      }
    } catch (error) {
      throw friendlyDriveError(error)
    }
  }

  /**
   * Queues the two-minute post-game backup. Manual syncs and game relaunches
   * cancel the queue so saves are never read while the game is running again.
   */
  scheduleAutoSync(gameId: number): void {
    const game = this.repository.getGame(gameId)
    if (!game || !game.autoSyncEnabled || !game.saveFolderPath) return
    if (!this.driveAuth.isConnected()) return

    this.clearAutoSyncTimer(gameId)

    const scheduledFor = new Date(Date.now() + AUTO_SYNC_DELAY_MS).toISOString()
    const timer = setTimeout(() => {
      this.timers.delete(gameId)
      const current = this.repository.getGame(gameId)
      if (!current || !current.autoSyncEnabled || !current.saveFolderPath) return
      void this.syncNow(gameId, 'auto').catch((error: unknown) => {
        console.warn(`[cloud-saves] Automatic backup failed for game ${gameId}:`, error)
      })
    }, AUTO_SYNC_DELAY_MS)
    timer.unref()

    this.timers.set(gameId, timer)
    this.notify({
      gameId,
      phase: 'scheduled',
      trigger: 'auto',
      game,
      scheduledFor,
      message: 'Saves will be backed up two minutes after the game closed.'
    })
  }

  cancelAutoSync(gameId: number, reason?: string, announce = true): void {
    const timer = this.timers.get(gameId)
    if (!timer) return

    clearTimeout(timer)
    this.timers.delete(gameId)

    if (announce) {
      this.notify({
        gameId,
        phase: 'canceled',
        trigger: 'auto',
        game: this.repository.getGame(gameId) ?? undefined,
        message: reason
      })
    }
  }

  cancelAllAutoSync(reason?: string): void {
    for (const gameId of [...this.timers.keys()]) {
      this.cancelAutoSync(gameId, reason)
    }
  }

  shutdown(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private async performSync(
    gameId: number,
    trigger: 'manual' | 'auto'
  ): Promise<SaveSyncResult> {
    this.notify({ gameId, phase: 'syncing', trigger })

    try {
      const result = await this.runSync(gameId)
      this.notify({
        gameId,
        phase: 'synced',
        trigger,
        game: result.game,
        backups: result.backups
      })
      return result
    } catch (error) {
      const friendly = friendlyDriveError(error)
      this.notify({
        gameId,
        phase: 'error',
        trigger,
        game: this.repository.getGame(gameId) ?? undefined,
        message: friendly.message
      })
      throw friendly
    }
  }

  private async runSync(gameId: number): Promise<SaveSyncResult> {
    const game = this.requireGame(gameId)
    const saveFolder = this.requireSaveFolder(game)
    const drive = this.createDriveClient()
    const temporaryPath = join(tmpdir(), `ayanami-saves-${gameId}-${randomUUID()}.zip`)

    try {
      const zip = new AdmZip()
      zip.addLocalFolder(saveFolder)
      const fileCount = zip.getEntries().filter((entry) => !entry.isDirectory).length
      if (fileCount === 0) {
        throw new Error(
          'The save folder is empty, so there is nothing to back up. Launch the game once and save your progress first.'
        )
      }
      zip.writeZip(temporaryPath)

      const folderId = await this.findGameFolder(drive, game, true)
      if (!folderId) throw new Error('Ayanami could not prepare the Google Drive save folder.')

      const now = new Date()
      const fileName = archiveName(now)
      const upload = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [folderId],
          mimeType: ZIP_MIME_TYPE,
          appProperties: {
            ayanamiGameId: String(game.id),
            ayanamiUploadedAt: now.toISOString()
          }
        },
        media: {
          mimeType: ZIP_MIME_TYPE,
          body: createReadStream(temporaryPath)
        },
        fields: 'id,name,size,createdTime'
      })

      if (!upload.data.id) {
        throw new Error('Google Drive did not confirm the save upload. Please try again.')
      }

      const uploaded: SaveBackup = {
        id: upload.data.id,
        name: upload.data.name ?? fileName,
        sizeBytes: Number(upload.data.size ?? statSync(temporaryPath).size),
        createdAt: upload.data.createdTime ?? now.toISOString()
      }

      let backups = await this.listFolderBackups(drive, folderId)
      if (!backups.some((backup) => backup.id === uploaded.id)) {
        backups = sortBackups([uploaded, ...backups])
      }

      const excess = backups.slice(MAX_BACKUPS)
      for (const backup of excess) {
        try {
          await drive.files.delete({ fileId: backup.id })
        } catch (error) {
          // A transient delete failure leaves an extra archive until the next
          // sync, but it must not invalidate the backup that just succeeded.
          console.warn(`[cloud-saves] Could not prune old backup ${backup.id}:`, error)
        }
      }

      const updatedGame = this.repository.markSynced(gameId)
      return {
        game: updatedGame,
        backups: backups.slice(0, MAX_BACKUPS)
      }
    } finally {
      removeTemporaryFile(temporaryPath)
    }
  }

  private createDriveClient(): drive_v3.Drive {
    const auth = this.driveAuth.getAuthorizedClient()
    return google.drive({ version: 'v3', auth })
  }

  private requireGame(gameId: number): Game {
    const game = this.repository.getGame(gameId)
    if (!game) throw new Error('That game is no longer in your library.')
    return game
  }

  private requireSaveFolder(game: Game): string {
    if (!game.saveFolderPath) {
      throw new Error('Choose this game’s save folder before backing up or restoring saves.')
    }
    if (!existsSync(game.saveFolderPath) || !statSync(game.saveFolderPath).isDirectory()) {
      throw new Error(
        'The save folder could not be found. Choose the folder again from this game’s page.'
      )
    }
    return game.saveFolderPath
  }

  private resolveRestoreFolder(game: Game): string {
    if (!game.saveFolderPath) {
      throw new Error('Choose this game’s save folder before restoring a backup.')
    }
    if (existsSync(game.saveFolderPath) && !statSync(game.saveFolderPath).isDirectory()) {
      throw new Error('The configured save path is not a folder. Choose it again from this page.')
    }
    return resolve(game.saveFolderPath)
  }

  private clearAutoSyncTimer(gameId: number): void {
    const timer = this.timers.get(gameId)
    if (!timer) return
    clearTimeout(timer)
    this.timers.delete(gameId)
  }

  private async findGameFolder(
    drive: drive_v3.Drive,
    game: Game,
    create: boolean
  ): Promise<string | null> {
    const rootId = await this.findOrCreateFolder(
      drive,
      ROOT_FOLDER_NAME,
      'root',
      null,
      create
    )
    if (!rootId) return null

    return this.findOrCreateFolder(
      drive,
      sanitizeFolderName(game.title),
      rootId,
      String(game.id),
      create
    )
  }

  private async findOrCreateFolder(
    drive: drive_v3.Drive,
    name: string,
    parentId: string,
    gameId: string | null,
    create: boolean
  ): Promise<string | null> {
    const parentClause =
      parentId === 'root' ? "'root' in parents" : `'${escapeDriveQuery(parentId)}' in parents`
    const list = await drive.files.list({
      q: `name = '${escapeDriveQuery(name)}' and mimeType = '${FOLDER_MIME_TYPE}' and ${parentClause} and trashed = false`,
      spaces: 'drive',
      pageSize: 10,
      orderBy: 'createdTime',
      fields: 'files(id,name,appProperties)'
    })

    const candidates = (list.data.files ?? []).filter(
      (file): file is drive_v3.Schema$File & { id: string } => Boolean(file.id)
    )
    // Prefer a folder this game already owns. Games can share a title (for
    // example, remasters), and a visible name alone is not a unique key.
    const existing = gameId
      ? candidates.find((file) => file.appProperties?.ayanamiGameId === gameId) ??
        candidates.find((file) => !file.appProperties?.ayanamiGameId)
      : candidates[0]

    if (existing) return existing.id
    if (!create) return null

    const folder = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME_TYPE,
        parents: [parentId],
        appProperties: gameId ? { ayanamiGameId: gameId } : undefined
      },
      fields: 'id'
    })

    if (!folder.data.id) {
      throw new Error('Google Drive could not create the save folder.')
    }
    return folder.data.id
  }

  private async listFolderBackups(
    drive: drive_v3.Drive,
    folderId: string
  ): Promise<SaveBackup[]> {
    const response = await drive.files.list({
      q: `'${escapeDriveQuery(folderId)}' in parents and mimeType != '${FOLDER_MIME_TYPE}' and trashed = false`,
      spaces: 'drive',
      pageSize: 100,
      orderBy: 'createdTime desc',
      fields: 'files(id,name,size,createdTime,modifiedTime,mimeType)'
    })

    const backups: SaveBackup[] = []
    for (const file of response.data.files ?? []) {
      const backup = parseBackup(file)
      if (backup) backups.push(backup)
    }
    return sortBackups(backups)
  }

  private assertSafeArchive(entries: AdmZip.IZipEntry[], destination: string): void {
    const root = resolve(destination)
    for (const entry of entries) {
      const entryName = entry.entryName.replace(/\\/g, '/')
      if (!entryName) continue
      const target = resolve(root, entryName)
      if (target !== root && !target.startsWith(root + sep)) {
        throw new Error('This backup archive contains an unsafe path and was not restored.')
      }
    }
  }
}
