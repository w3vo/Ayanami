import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { Game } from '@shared/types'
import { createPlaceholderCover } from '@shared/placeholderCover'
import { formatLastPlayed, formatPlaytime } from '../lib/format'
import { CalendarIcon, ClockIcon, PlayIcon } from './Icons'
import { Spinner } from './Spinner'

interface GameCardProps {
  game: Game
  isLaunching: boolean
  onLaunch: (game: Game) => void
  onOpen: (game: Game) => void
}

export function GameCard({
  game,
  isLaunching,
  onLaunch,
  onOpen
}: GameCardProps): JSX.Element {
  const fallbackCover = useMemo(() => createPlaceholderCover(game.title), [game.title])
  const [coverFailed, setCoverFailed] = useState(false)
  const coverUrl = game.coverUrl && !coverFailed ? game.coverUrl : fallbackCover

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-ayanami-card transition-all duration-300 hover:-translate-y-1 ${
        game.isRunning
          ? 'border-emerald-400/25 shadow-[0_18px_50px_-24px_rgba(16,185,129,0.55)]'
          : 'border-ayanami-line/90 hover:border-[#3a4150] hover:shadow-[0_24px_50px_-24px_rgba(0,0,0,0.85)]'
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(game)}
        aria-label={`Open details for ${game.title}`}
        className="flex flex-1 flex-col text-left"
      >
        <div className="relative aspect-[2/3] overflow-hidden bg-[#0c0f14]">
          <img
            src={coverUrl}
            alt={`${game.title} cover art`}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setCoverFailed(true)}
            className={`h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.035] ${
              game.isRunning ? 'brightness-[0.82]' : ''
            }`}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0b0d12]/55 via-transparent to-black/10" />
          <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/[0.055]" />

          {game.isRunning && (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-[#07110d]/85 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-emerald-300 backdrop-blur-md">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Running
            </span>
          )}

          <span className="pointer-events-none absolute inset-x-3 bottom-3 flex translate-y-1 items-center justify-center rounded-lg border border-white/[0.1] bg-[#080b10]/80 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-300 opacity-0 backdrop-blur-md transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
            View saves &amp; details
          </span>
        </div>

        <div className="flex flex-1 flex-col p-4 pb-3">
          <h3 className="line-clamp-2 min-h-[2.5rem] text-[13.5px] font-semibold leading-5 tracking-[-0.01em] text-slate-100">
            {game.title}
          </h3>

          <div className="mt-3 space-y-1.5 text-[10.5px] font-medium text-slate-500">
            <div className="flex items-center gap-1.5" title="Total playtime">
              <ClockIcon className="h-3.5 w-3.5 shrink-0 text-slate-600" />
              <span className="truncate">{formatPlaytime(game.totalPlaytimeSeconds)}</span>
            </div>
            <div className="flex items-center gap-1.5" title="Last played">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-slate-600" />
              <span className="truncate">{formatLastPlayed(game.lastPlayedAt)}</span>
            </div>
          </div>
        </div>
      </button>

      <div className="px-4 pb-4">
        <button
          type="button"
          disabled={game.isRunning || isLaunching}
          onClick={() => onLaunch(game)}
          aria-busy={isLaunching}
          className={`flex h-9 w-full items-center justify-center gap-2 rounded-lg border text-[11px] font-semibold tracking-[0.02em] transition-all duration-200 ${
            game.isRunning
              ? 'cursor-default border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300'
              : 'border-transparent bg-gradient-to-r from-[#a8c5e5] to-[#879cb5] text-[#0b0e18] shadow-[0_8px_20px_-12px_rgba(135,156,181,0.6)] hover:brightness-105 active:scale-[0.985] disabled:cursor-wait disabled:opacity-70'
          }`}
        >
          {isLaunching ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : game.isRunning ? (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          ) : (
            <PlayIcon className="h-3.5 w-3.5 translate-x-px" />
          )}
          {game.isRunning ? 'Running' : isLaunching ? 'Launching…' : 'Play'}
        </button>
      </div>
    </article>
  )
}
