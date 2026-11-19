import type { CSSProperties, JSX } from 'react'
import { isOnlineAvailable, onlineStatusMeta } from '@shared/catalog'
import type { CompatibilityTier, StoreGame } from '@shared/types'

type BadgeSize = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'gap-1.5 px-2.5 py-1 text-[8.5px]',
  md: 'gap-1.5 px-3 py-1.5 text-[10px]',
  lg: 'gap-2 px-3.5 py-2 text-[11px]'
}

const DOT_CLASSES: Record<BadgeSize, string> = {
  sm: 'h-1.5 w-1.5',
  md: 'h-[7px] w-[7px]',
  lg: 'h-2 w-2'
}

export interface CompatibilityPresentation {
  label: string
  shortLabel: string
  color: string
  description: string
}

export const COMPATIBILITY_META: Record<CompatibilityTier, CompatibilityPresentation> = {
  recommended: {
    label: 'Recommended',
    shortLabel: 'Recommended',
    color: '#22c55e',
    description: 'This PC is at or above every recommended target.'
  },
  minimum: {
    label: 'Minimum',
    shortLabel: 'Minimum',
    color: '#eab308',
    description: 'This PC clears the minimum targets but sits below recommended.'
  },
  below: {
    label: 'Below minimum',
    shortLabel: 'Below min',
    color: '#ef4444',
    description: 'At least one component is below the minimum target.'
  },
  unknown: {
    label: 'Unknown',
    shortLabel: 'Unknown',
    color: '#94a3b8',
    description: 'There is not enough requirement data to compare with this PC.'
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function badgeStyle(color: string): CSSProperties {
  return {
    color,
    borderColor: hexToRgba(color, 0.3),
    backgroundColor: hexToRgba(color, 0.1),
    boxShadow: `inset 0 1px 0 ${hexToRgba(color, 0.06)}`
  }
}

function dotStyle(color: string): CSSProperties {
  return {
    backgroundColor: color,
    boxShadow: `0 0 9px ${hexToRgba(color, 0.75)}`
  }
}

/**
 * Only positive online states are shown. A title with no online fix and no
 * title keyword gets no badge at all instead of an "Offline Only" label.
 */
export function OnlineStatusBadge({
  game,
  checking = false,
  size = 'sm',
  className = ''
}: {
  game: Pick<StoreGame, 'onlineStatus' | 'onlineCheckedAt' | 'onlineByKeyword'>
  checking?: boolean
  size?: BadgeSize
  className?: string
}): JSX.Element | null {
  if (!isOnlineAvailable(game)) return null

  const meta = onlineStatusMeta(game, checking)
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border font-semibold tracking-[0.01em] ${SIZE_CLASSES[size]} ${className}`}
      style={badgeStyle(meta.color)}
      title={meta.description}
    >
      <span className={`shrink-0 rounded-full ${DOT_CLASSES[size]}`} style={dotStyle(meta.color)} />
      {meta.label}
    </span>
  )
}
