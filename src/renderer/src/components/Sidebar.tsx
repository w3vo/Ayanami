import type { ComponentType, JSX, SVGProps } from 'react'
import type { DriveStatus } from '@shared/types'
import type { View } from '../types'
import {
  BrandMark,
  ChevronRightIcon,
  DownloadsIcon,
  GoogleDriveIcon,
  LibraryIcon,
  SlidersIcon,
  StoreIcon
} from './Icons'

interface SidebarProps {
  activeView: View
  gameCount: number
  drive: DriveStatus
  version: string
  onNavigate: (view: View) => void
  onOpenSettings: () => void
}

const NAV_ITEMS: Array<{
  id: View
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}> = [
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'store', label: 'Store', icon: StoreIcon },
  { id: 'downloads', label: 'Downloads', icon: DownloadsIcon }
]

function drivePresentation(drive: DriveStatus): {
  label: string
  dotClass: string
  pillClass: string
} {
  if (drive.connected) {
    return {
      label: 'Connected',
      dotClass: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]',
      pillClass: 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300'
    }
  }
  if (drive.configured) {
    return {
      label: 'Not connected',
      dotClass: 'bg-amber-400',
      pillClass: 'border-amber-400/20 bg-amber-400/[0.07] text-amber-300/90'
    }
  }
  return {
    label: 'Not set up',
    dotClass: 'bg-slate-500',
    pillClass: 'border-white/[0.07] bg-white/[0.03] text-slate-400'
  }
}

export function Sidebar({
  activeView,
  gameCount,
  drive,
  version,
  onNavigate,
  onOpenSettings
}: SidebarProps): JSX.Element {
  const driveState = drivePresentation(drive)

  return (
    <aside className="sidebar-bg relative z-20 flex h-full w-[244px] shrink-0 flex-col border-r border-white/[0.055]">
      <div className="flex items-center gap-3 px-5 pb-7 pt-6">
        <BrandMark />
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold tracking-[0.19em] text-white">
            AYANAMI
          </p>
          <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.28em] text-slate-500">
            Game launcher
          </p>
        </div>
      </div>

      <nav className="px-3">
        <p className="px-3 pb-2.5 text-[9px] font-semibold uppercase tracking-[0.26em] text-slate-600">
          Workspace
        </p>
        <div className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`group relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] font-medium transition-all duration-200 ${
                  isActive
                    ? 'border-ayanami-accent/25 bg-ayanami-accent/[0.1] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]'
                    : 'border-transparent text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
                }`}
              >
                {isActive && (
                  <span className="absolute -left-[13px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-ayanami-accent shadow-[0_0_14px_rgba(135,156,181,0.8)]" />
                )}
                <Icon
                  className={`h-[18px] w-[18px] transition-colors ${
                    isActive ? 'text-ayanami-highlight' : 'text-slate-500 group-hover:text-slate-300'
                  }`}
                />
                <span className="flex-1">{item.label}</span>
                {item.id === 'library' && gameCount > 0 && (
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      isActive
                        ? 'bg-ayanami-accent/15 text-ayanami-highlight'
                        : 'bg-white/[0.045] text-slate-500'
                    }`}
                  >
                    {gameCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </nav>

      <div className="mx-5 mt-7 h-px bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />

      <div className="px-5 pt-5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.26em] text-slate-600">
          Your setup
        </p>
        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          Local library, cloud saves, and downloads — all in one place.
        </p>
      </div>

      <div className="mt-auto space-y-2 border-t border-white/[0.055] p-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="group flex w-full items-center gap-2.5 rounded-xl border border-ayanami-line/80 bg-[#0f1218]/80 px-3 py-2.5 text-left transition hover:border-[#353d4c] hover:bg-[#141821]"
          title="Google Drive connection status"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.035]">
            <GoogleDriveIcon className="h-[17px] w-[17px]" />
          </span>
          <span className="text-[11px] font-medium text-slate-300">Google Drive</span>
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[9px] font-medium ${driveState.pillClass}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${driveState.dotClass}`} />
            {driveState.label}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium text-slate-400 transition hover:bg-white/[0.035] hover:text-white"
        >
          <SlidersIcon className="h-4 w-4 text-slate-500 transition group-hover:text-slate-300" />
          <span>Settings</span>
          <ChevronRightIcon className="ml-auto h-3.5 w-3.5 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-slate-400" />
        </button>

        <p className="px-3 pb-1 pt-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-slate-600">
          Ayanami {version ? `v${version}` : ''}
        </p>
      </div>
    </aside>
  )
}
