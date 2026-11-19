import type { MetadataStatus, StoreGame } from '../shared/types'
import type { CatalogRepository } from './catalog-repository'
import { lookupSteamGame } from './metadata/steam'

const MAX_CONCURRENT_LOOKUPS = 4
const MISSING_RETRY_MS = 24 * 60 * 60 * 1000
const ERROR_RETRY_MS = 20 * 60 * 1000

type MetadataUpdater = (game: StoreGame) => void

function ageInMs(timestamp: string | null): number | null {
  if (!timestamp) return null
  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) return null
  return Math.max(0, Date.now() - parsed)
}

function shouldLookup(game: StoreGame, force: boolean): boolean {
  if (force) return true
  if (game.metadataStatus === 'ready') return false

  const age = ageInMs(game.metadataUpdatedAt)
  if (age === null) return true
  if (game.metadataStatus === 'missing') return age >= MISSING_RETRY_MS
  return age >= ERROR_RETRY_MS
}

/**
 * Lazily resolves the games the user can see. Lookups are queued, deduplicated,
 * persisted, and retried conservatively so opening the Store does not hammer
 * Steam with thousands of requests for titles that will never be viewed.
 */
export class CatalogMetadataEnricher {
  private readonly queue: number[] = []
  private readonly scheduled = new Set<number>()
  private readonly forced = new Set<number>()
  private active = 0
  private stopped = false
  private warningCount = 0

  constructor(
    private readonly repository: CatalogRepository,
    private readonly onGameUpdated: MetadataUpdater
  ) {}

  enqueue(gameIds: number[], force = false): number {
    if (this.stopped) return 0

    let added = 0
    for (const gameId of gameIds) {
      if (!Number.isInteger(gameId) || gameId <= 0) continue
      if (this.scheduled.has(gameId)) {
        if (force) this.forced.add(gameId)
        continue
      }

      const game = this.repository.getGame(gameId)
      if (!game || !shouldLookup(game, force)) continue

      if (force) this.forced.add(gameId)
      this.scheduled.add(gameId)
      this.queue.push(gameId)
      added += 1
    }

    this.pump()
    return added
  }

  private pump(): void {
    while (!this.stopped && this.active < MAX_CONCURRENT_LOOKUPS && this.queue.length > 0) {
      const gameId = this.queue.shift()
      if (gameId === undefined) return

      this.active += 1
      void this.process(gameId)
        .catch((error: unknown) => {
          if (this.warningCount < 8) {
            this.warningCount += 1
            console.warn('[catalog] Metadata lookup failed:', error)
          }
        })
        .finally(() => {
          this.active = Math.max(0, this.active - 1)
          this.scheduled.delete(gameId)
          this.pump()
        })
    }
  }

  private async process(gameId: number): Promise<void> {
    const game = this.repository.getGame(gameId)
    if (!game) return

    let status: MetadataStatus = 'missing'
    try {
      const metadata = await lookupSteamGame(game.title, {
        force: this.forced.delete(gameId)
      })
      if (!this.stopped && metadata) {
        const updated = this.repository.applyGameMetadata(gameId, metadata)
        if (updated) this.onGameUpdated(updated)
        return
      }
    } catch (error) {
      status = 'error'
      if (this.warningCount < 8) {
        this.warningCount += 1
        console.warn(`[catalog] Steam metadata unavailable for “${game.title}”:`, error)
      }
    }

    if (this.stopped) return
    const updated = this.repository.markGameMetadata(gameId, status)
    if (updated) this.onGameUpdated(updated)
  }

  shutdown(): void {
    this.stopped = true
    this.queue.length = 0
    this.scheduled.clear()
  }
}
