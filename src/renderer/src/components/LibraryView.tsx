import type { JSX } from 'react'
import type { Game } from '@shared/types'
import { formatCount, formatPlaytime } from '../lib/format'
import { PageHeader } from './PageHeader'
import { GameCard } from './GameCard'
import { AlertCircleIcon, PlusIcon, RefreshIcon } from './Icons'
import { Spinner } from './Spinner'

interface LibraryViewProps {
  games: Game[]
  loading: boolean
  loadError: string | null
  launchingIds: ReadonlySet<number>
  onAddGame: () => void
  onLaunch: (game: Game) => void
  onOpenGame: (game: Game) => void
  onRetry: () => void
}

function AddGameButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex h-11 items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#a8c5e5] via-[#9db2ca] to-[#879cb5] px-5 text-[13px] font-semibold tracking-[-0.01em] text-[#0b0e18] shadow-[0_14px_35px_-14px_rgba(135,156,181,0.6)] transition-all duration-200 hover:brightness-105 hover:shadow-[0_18px_42px_-14px_rgba(157,178,202,0.65)] active:scale-[0.985]"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#0b0e18]/15 transition group-hover:bg-[#0b0e18]/20">
        <PlusIcon className="h-4 w-4" strokeWidth={2.2} />
      </span>
      Add Game
    </button>
  )
}

function EmptyLibrary({ onAddGame }: { onAddGame: () => void }): JSX.Element {
  return (
    <div className="relative mt-9 overflow-hidden rounded-[26px] border border-dashed border-[#2b313c] bg-[#11141a]/55 px-6 py-16 text-center">
      <div className="pointer-events-none absolute left-1/2 top-8 h-64 w-80 -translate-x-1/2 rounded-full bg-ayanami-accent/[0.07] blur-3xl" />
      <div className="relative">
        <div className="relative mx-auto mb-8 h-32 w-48">
          <div className="absolute left-2 top-6 h-[100px] w-[70px] -rotate-[13deg] rounded-xl border border-white/[0.07] bg-gradient-to-b from-[#1a2029] to-[#0d1016] shadow-xl" />
          <div className="absolute right-2 top-6 h-[100px] w-[70px] rotate-[13deg] rounded-xl border border-white/[0.07] bg-gradient-to-b from-[#181d25] to-[#0c0f15] shadow-xl" />
          <div className="absolute left-1/2 top-0 flex h-[112px] w-[80px] -translate-x-1/2 items-center justify-center rounded-xl border border-ayanami-accent/25 bg-gradient-to-br from-[#202832] via-[#171b22] to-[#0e1118] shadow-[0_20px_45px_-18px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.06)]">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-ayanami-accent/25 bg-ayanami-accent/10 text-ayanami-accent">
              <PlusIcon className="h-5 w-5" />
            </span>
          </div>
        </div>

        <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-white">
          Your library is waiting
        </h2>
        <p className="mx-auto mt-2.5 max-w-md text-[13px] leading-6 text-slate-400">
          Add a game, choose its Windows executable, and it will be ready to launch from one
          quiet, local library.
        </p>
        <button
          type="button"
          onClick={onAddGame}
          className="mt-7 inline-flex h-10 items-center gap-2 rounded-xl border border-ayanami-accent/30 bg-ayanami-accent/[0.09] px-4 text-xs font-semibold text-ayanami-accent transition hover:border-ayanami-accent/45 hover:bg-ayanami-accent/[0.14] hover:text-white"
        >
          <PlusIcon className="h-4 w-4" />
          Add your first game
        </button>
        <p className="mt-5 text-[9px] font-medium uppercase tracking-[0.24em] text-slate-600">
          Stored locally · No account required
        </p>
      </div>
    </div>
  )
}

function SkeletonGrid(): JSX.Element {
  return (
    <div className="mt-9 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-2xl border border-ayanami-line/80 bg-ayanami-card"
        >
          <div className="skeleton aspect-[2/3]" />
          <div className="space-y-3 p-4">
            <div className="skeleton h-3.5 w-4/5 rounded-full" />
            <div className="skeleton h-2.5 w-1/2 rounded-full" />
            <div className="skeleton h-9 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function LibraryView({
  games,
  loading,
  loadError,
  launchingIds,
  onAddGame,
  onLaunch,
  onOpenGame,
  onRetry
}: LibraryViewProps): JSX.Element {
  const totalPlaytime = games.reduce((sum, game) => sum + game.totalPlaytimeSeconds, 0)
  const runningCount = games.filter((game) => game.isRunning).length
  const summary =
    games.length === 0
      ? 'Your local collection lives here — no storefront, no clutter, just the games you own.'
      : `${formatCount(games.length, 'game')} · ${
          totalPlaytime > 0 ? `${formatPlaytime(totalPlaytime)} logged` : 'No playtime yet'
        }${runningCount > 0 ? ` · ${runningCount} running now` : ''}`

  return (
    <>
      <PageHeader
        eyebrow="Your collection"
        title="Library"
        description={summary}
        aside={<AddGameButton onClick={onAddGame} />}
      />

      {loadError && games.length === 0 ? (
        <div className="mt-9 flex flex-col items-center rounded-2xl border border-red-400/15 bg-red-400/[0.035] px-6 py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/[0.08] text-red-300">
            <AlertCircleIcon className="h-5 w-5" />
          </span>
          <h2 className="mt-4 font-display text-lg font-semibold text-white">
            Your library couldn’t be loaded
          </h2>
          <p className="mt-2 max-w-md text-xs leading-5 text-slate-400">{loadError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 text-xs font-medium text-slate-200 transition hover:bg-white/[0.07]"
          >
            <RefreshIcon className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      ) : loading ? (
        <SkeletonGrid />
      ) : games.length === 0 ? (
        <EmptyLibrary onAddGame={onAddGame} />
      ) : (
        <>
          <div className="mb-4 mt-10 flex items-center justify-between">
            <p className="text-[9px] font-semibold uppercase tracking-[0.26em] text-slate-500">
              All games
            </p>
            <p className="text-[10px] tabular-nums text-slate-600">
              {formatCount(games.length, 'title')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {games.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                isLaunching={launchingIds.has(game.id)}
                onLaunch={onLaunch}
                onOpen={onOpenGame}
              />
            ))}
          </div>
        </>
      )}

      {loading && games.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-500">
          <Spinner className="h-3 w-3" />
          Refreshing library…
        </div>
      )}
    </>
  )
}
