import type { StoreGame } from '../shared/types'
import type { CatalogRepository } from './catalog-repository'
import { searchOnlineFix } from './metadata/onlinefix'

const CHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000

type GameUpdater = (game: StoreGame) => void

function ageInMs(timestamp: string | null): number | null {
  if (!timestamp) return null
  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) return null
  return Math.max(0, Date.now() - parsed)
}

/**
 * Checks a title against online-fix.me on demand. The Store calls this when a
 * game page is opened, so importing a large catalog never starts a background
 * crawl. Concurrent requests for the same game share one lookup, and a network
 * failure never turns into a false "Offline Only" badge.
 */
export class CatalogOnlineChecker {
  private readonly inFlight = new Map<number, Promise<StoreGame>>()
  private stopped = false

  constructor(
    private readonly repository: CatalogRepository,
    private readonly onGameUpdated: GameUpdater
  ) {}

  /**
   * Looks up one game. A recent check is reused unless `force` is set; the
   * per-game refresh button passes `true`.
   */
  checkNow(gameId: number, force = false): Promise<StoreGame> {
    if (this.stopped) {
      return Promise.reject(new Error('Online checks are shutting down.'))
    }

    const existing = this.inFlight.get(gameId)
    if (existing) return existing

    const task = this.runCheck(gameId, force).finally(() => {
      this.inFlight.delete(gameId)
    })
    this.inFlight.set(gameId, task)
    return task
  }

  private async runCheck(gameId: number, force: boolean): Promise<StoreGame> {
    const game = this.repository.getGame(gameId)
    if (!game) throw new Error('That game is no longer in the catalog.')

    if (!force) {
      const age = ageInMs(game.onlineCheckedAt)
      if (age !== null && age < CHECK_TTL_MS) return game
    }

    let match: Awaited<ReturnType<typeof searchOnlineFix>>
    try {
      match = await searchOnlineFix(game.title, true)
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Could not reach online-fix.me: ${error.message}`
          : 'Could not reach online-fix.me.'
      )
    }

    if (this.stopped) return game

    const updated = this.repository.markOnlineStatus(
      gameId,
      match ? 'online-fix' : 'offline',
      match?.url ?? null
    )
    if (!updated) throw new Error('The online status could not be saved.')

    this.onGameUpdated(updated)
    return updated
  }

  shutdown(): void {
    this.stopped = true
    this.inFlight.clear()
  }
}
