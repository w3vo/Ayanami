import { spawn, type ChildProcess } from 'child_process'
import { existsSync, statSync } from 'fs'
import { dirname } from 'path'
import type { Game, GameStatusEvent } from '../shared/types'
import type { GameRepository } from './db'

interface RunningGame {
  child: ChildProcess
  startedAt: number
  finished: boolean
}

export class GameProcessManager {
  private readonly running = new Map<number, RunningGame>()

  constructor(
    private readonly repository: GameRepository,
    private readonly notify: (event: GameStatusEvent) => void,
    private readonly onSessionEnded?: (gameId: number) => void
  ) {}

  private decorate(game: Game): Game {
    return { ...game, isRunning: this.running.has(game.id) }
  }

  decorateAll(games: Game[]): Game[] {
    return games.map((game) => this.decorate(game))
  }

  isRunning(gameId: number): boolean {
    return this.running.has(gameId)
  }

  private sessionSeconds(record: RunningGame): number {
    return Math.max(0, Math.floor((Date.now() - record.startedAt) / 1000))
  }

  private persistSession(gameId: number, record: RunningGame): void {
    try {
      this.repository.recordPlaySession(gameId, this.sessionSeconds(record))
    } catch (error) {
      console.error(`[playtime] Failed to persist session for game ${gameId}:`, error)
    }
  }

  async launch(gameId: number): Promise<Game> {
    if (this.running.has(gameId)) {
      throw new Error('This game is already running.')
    }

    const game = this.repository.getGame(gameId)
    if (!game) throw new Error('That game is no longer in your library.')

    if (!existsSync(game.exePath)) {
      throw new Error(
        'The game executable could not be found. It may have been moved or deleted.'
      )
    }

    let stats
    try {
      stats = statSync(game.exePath)
    } catch {
      throw new Error('The game executable could not be read.')
    }
    if (!stats.isFile()) {
      throw new Error('The selected game path is not a file.')
    }

    const child = spawn(game.exePath, [], {
      cwd: dirname(game.exePath),
      stdio: 'ignore',
      windowsHide: false
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        child.removeListener('spawn', onSpawn)
        child.removeListener('error', onError)
      }
      const onSpawn = (): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const onError = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(
          new Error(
            error.message.includes('ENOENT')
              ? 'Windows could not find the game executable.'
              : 'Windows could not launch the game executable.'
          )
        )
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    }).catch((error: unknown) => {
      console.warn('[process] Failed to launch game:', error)
      throw error
    })

    const record: RunningGame = {
      child,
      startedAt: Date.now(),
      finished: false
    }
    this.running.set(gameId, record)
    this.repository.markLaunched(gameId)

    const finish = (): void => {
      if (record.finished) return
      record.finished = true
      this.running.delete(gameId)

      this.persistSession(gameId, record)

      const updated = this.repository.getGame(gameId)
      if (!updated) return
      this.notify({ gameId, isRunning: false, game: this.decorate(updated) })

      try {
        this.onSessionEnded?.(gameId)
      } catch (error) {
        console.error(`[process] Session-end handler failed for game ${gameId}:`, error)
      }
    }

    child.once('exit', finish)
    child.once('error', (error) => {
      console.warn('[process] Game process error:', error)
      finish()
    })

    const launched = this.repository.getGame(gameId)
    if (!launched) throw new Error('The game could not be loaded after launching.')

    const decorated = this.decorate(launched)
    this.notify({ gameId, isRunning: true, game: decorated })
    return decorated
  }

  /**
   * Persists playtime accumulated so far and detaches listeners without
   * terminating the game. Games keep running when the launcher closes.
   */
  shutdown(): void {
    for (const [gameId, record] of this.running) {
      if (!record.finished) {
        record.finished = true
        this.persistSession(gameId, record)
      }
      record.child.removeAllListeners()
      record.child.unref()
    }
    this.running.clear()
  }
}
