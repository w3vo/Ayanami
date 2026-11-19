import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { StoreGame } from '@shared/types'
import { createPlaceholderCover } from '@shared/placeholderCover'
import { formatBytes, formatMonthYear } from '../lib/format'
import { ChevronRightIcon, HardDriveIcon } from './Icons'
import { OnlineStatusBadge } from './StoreBadges'

interface StoreGameCardProps {
  game: StoreGame
  onOpen: (game: StoreGame) => void
}

export function StoreGameCard({ game, onOpen }: StoreGameCardProps): JSX.Element {
  const fallbackCover = useMemo(
    () => createPlaceholderCover(game.title, 'STORE CATALOG · AYANAMI'),
    [game.title]
  )
  const [coverFailed, setCoverFailed] = useState(false)
  const coverUrl = game.coverUrl && !coverFailed ? game.coverUrl : fallbackCover

  const metaParts = [
    game.releaseYear ? String(game.releaseYear) : null,
    ...game.genres.slice(0, 2)
  ].filter(Boolean)
  const meta =
    metaParts.length > 0
      ? metaParts.join(' · ')
      : game.catalogAddedAt
        ? `Added ${formatMonthYear(game.catalogAddedAt)}`
        : 'Genre not listed'
  const sizeLabel = game.download.sizeBytes
    ? formatBytes(game.download.sizeBytes)
    : game.storageGb
      ? `${Math.round(game.storageGb)} GB`
      : 'Size unknown'
  const mirrorLabel =
    game.download.mirrors.length > 0
      ? `${game.download.mirrors.length + 1} mirrors`
      : null

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-ayanami-line/90 bg-ayanami-card transition-all duration-300 hover:-translate-y-1 hover:border-[#3a4150] hover:shadow-[0_24px_50px_-24px_rgba(0,0,0,0.85)]">
      <button
        type="button"
        onClick={() => onOpen(game)}
        aria-label={`Open the store page for ${game.title}`}
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
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0b0d12]/70 via-transparent to-[#06090d]/20" />
          <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/[0.055]" />

          <div className="absolute left-2.5 top-2.5 flex max-w-[calc(100%-20px)] flex-wrap gap-1.5">
            <OnlineStatusBadge game={game} size="sm" />
          </div>

          <div className="absolute inset-x-2.5 bottom-2.5 flex items-center justify-end gap-2">
            {game.storageGb !== null && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.1] bg-[#080b10]/70 px-2 py-1 text-[8.5px] font-medium text-slate-300 backdrop-blur-md">
                <HardDriveIcon className="h-2.5 w-2.5" />
                {Math.round(game.storageGb)} GB
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col p-3.5 pb-3">
          <h3 className="line-clamp-2 min-h-[2.5rem] text-[13px] font-semibold leading-5 tracking-[-0.01em] text-slate-100">
            {game.title}
          </h3>
          <p className="mt-1.5 truncate text-[9.5px] text-slate-500">
            {meta || 'Genre not listed'}
          </p>
        </div>
      </button>

      <div className="flex items-center justify-between gap-2 border-t border-white/[0.05] px-3.5 py-2.5 text-[9px]">
        <span className="truncate text-slate-600">
          {sizeLabel}
          {mirrorLabel ? ` · ${mirrorLabel}` : ''}
        </span>
        <span className="inline-flex items-center gap-0.5 font-medium text-ayanami-accent/80 transition group-hover:text-ayanami-highlight">
          View game
          <ChevronRightIcon className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </article>
  )
}
