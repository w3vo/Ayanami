import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { DownloadSettings } from '../../shared/types'

interface StoredSettings {
  downloadDirectory?: unknown
  gamesDirectory?: unknown
}

function normalizeDirectory(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Small JSON-backed settings file for the download manager. Keeping this out of
 * SQLite means folder preferences survive database maintenance and can be read
 * before any catalog repository is opened.
 */
export class DownloadSettingsStore {
  private settings: DownloadSettings

  constructor(
    private readonly filePath: string,
    defaults: DownloadSettings
  ) {
    this.settings = { ...defaults }
    this.load()
    this.ensureDirectories()
  }

  get(): DownloadSettings {
    return { ...this.settings }
  }

  update(input: Partial<DownloadSettings>): DownloadSettings {
    const downloadDirectory = normalizeDirectory(input.downloadDirectory)
    const gamesDirectory = normalizeDirectory(input.gamesDirectory)

    if (downloadDirectory) this.settings.downloadDirectory = downloadDirectory
    if (gamesDirectory) this.settings.gamesDirectory = gamesDirectory

    this.ensureDirectories()
    this.persist()
    return this.get()
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const stored = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoredSettings
      const downloadDirectory = normalizeDirectory(stored.downloadDirectory)
      const gamesDirectory = normalizeDirectory(stored.gamesDirectory)
      if (downloadDirectory) this.settings.downloadDirectory = downloadDirectory
      if (gamesDirectory) this.settings.gamesDirectory = gamesDirectory
    } catch {
      // A malformed settings file should never prevent the app from starting.
    }
  }

  private ensureDirectories(): void {
    mkdirSync(this.settings.downloadDirectory, { recursive: true })
    mkdirSync(this.settings.gamesDirectory, { recursive: true })
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8')
  }
}
