import type { JSX, ReactNode, SVGProps } from 'react'
import appIcon from '@assets/icon.png'

type IconProps = SVGProps<SVGSVGElement>

function IconShell({
  children,
  ...props
}: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export function LibraryIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <rect x="3.25" y="3.25" width="7.5" height="7.5" rx="1.8" />
      <rect x="13.25" y="3.25" width="7.5" height="7.5" rx="1.8" />
      <rect x="3.25" y="13.25" width="7.5" height="7.5" rx="1.8" />
      <rect x="13.25" y="13.25" width="7.5" height="7.5" rx="1.8" />
    </IconShell>
  )
}

export function StoreIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M4.1 8.2h15.8l-1.05 11.1a2 2 0 0 1-2 1.8H7.15a2 2 0 0 1-2-1.8L4.1 8.2Z" />
      <path d="M8.6 8V6.1a3.4 3.4 0 0 1 6.8 0V8" />
      <path d="M9.2 12.2v1.3a2.8 2.8 0 0 0 5.6 0v-1.3" />
    </IconShell>
  )
}

export function DownloadsIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M12 3.5v11.2" />
      <path d="m7.8 10.8 4.2 4.2 4.2-4.2" />
      <path d="M4.2 16.4v1.8a2.3 2.3 0 0 0 2.3 2.3h11a2.3 2.3 0 0 0 2.3-2.3v-1.8" />
    </IconShell>
  )
}

export function SlidersIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M3.5 6.5h8.2" />
      <path d="M16 6.5h4.5" />
      <circle cx="14" cy="6.5" r="2.1" />
      <path d="M3.5 12h4.4" />
      <path d="M12.3 12h8.2" />
      <circle cx="10.2" cy="12" r="2.1" />
      <path d="M3.5 17.5h10.3" />
      <path d="M18.1 17.5h2.4" />
      <circle cx="16" cy="17.5" r="2.1" />
    </IconShell>
  )
}

export function PlusIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconShell>
  )
}

export function SearchIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4.3 4.3" />
    </IconShell>
  )
}

export function CloseIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </IconShell>
  )
}

export function FolderIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M3.5 7.6a2 2 0 0 1 2-2h4l2.1 2.4h6.9a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.6Z" />
      <path d="M3.8 10.4h16.4" />
    </IconShell>
  )
}

export function PlayIcon(props: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M8.1 5.4c0-.8.86-1.3 1.54-.9l9.2 6.6a1.08 1.08 0 0 1 0 1.8l-9.2 6.6a1.08 1.08 0 0 1-1.54-.9V5.4Z" />
    </svg>
  )
}

export function PauseIcon(props: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <rect x="6.3" y="4.8" width="3.9" height="14.4" rx="1.2" />
      <rect x="13.8" y="4.8" width="3.9" height="14.4" rx="1.2" />
    </svg>
  )
}

export function GoogleDriveIcon(props: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M8.55 3.3h6.9l6.85 11.86h-6.9L8.55 3.3Z" fill="#fbbc04" />
      <path d="M8.55 3.3 1.7 15.16l3.45 5.96 6.85-11.86L8.55 3.3Z" fill="#34a853" />
      <path d="M5.15 21.12h13.7l3.45-5.96H8.6l-3.45 5.96Z" fill="#4285f4" />
    </svg>
  )
}

export function CheckIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="m5 12.5 4.1 4L19 6.7" />
    </IconShell>
  )
}

export function ChevronRightIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </IconShell>
  )
}

export function ArrowLeftIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M19 12H5" />
      <path d="m10.5 6.5-5.5 5.5 5.5 5.5" />
    </IconShell>
  )
}

export function ArrowRightIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M5 12h14" />
      <path d="m13.5 6.5 5.5 5.5-5.5 5.5" />
    </IconShell>
  )
}

export function ExternalLinkIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </IconShell>
  )
}

export function ClockIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.4V12l3.1 1.9" />
    </IconShell>
  )
}

export function CalendarIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <rect x="3.6" y="5.2" width="16.8" height="15" rx="2.2" />
      <path d="M3.8 9.6h16.4M8.2 3.4v3.4M15.8 3.4v3.4" />
    </IconShell>
  )
}

export function AppWindowIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <rect x="3.3" y="4.3" width="17.4" height="15.4" rx="2.2" />
      <path d="M3.6 8.4h16.8" />
      <path d="M6.6 6.35h.01M9.2 6.35h.01M11.8 6.35h.01" />
      <path d="m9.4 15.2 2-2.3 1.7 1.8 1.5-1.6 1.6 2.1" />
    </IconShell>
  )
}

export function AlertCircleIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.6v5.2M12 16.2h.01" />
    </IconShell>
  )
}

export function InfoIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11v5M12 7.7h.01" />
    </IconShell>
  )
}

export function RefreshIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M20.2 11.2A8.3 8.3 0 0 0 5.9 6.4L3.4 8.8" />
      <path d="M3.4 4.5v4.3h4.3" />
      <path d="M3.8 12.8a8.3 8.3 0 0 0 14.3 4.8l2.5-2.4" />
      <path d="M20.6 19.5v-4.3h-4.3" />
    </IconShell>
  )
}

export function CloudUploadIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M7.2 18.4a4.2 4.2 0 0 1-.5-8.37 5.5 5.5 0 0 1 10.4-1.6 3.9 3.9 0 0 1 .9 7.65" />
      <path d="M12 20.2v-6.6" />
      <path d="m9.4 16 2.6-2.6 2.6 2.6" />
    </IconShell>
  )
}

export function ArchiveIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <rect x="3.4" y="4.4" width="17.2" height="4.2" rx="1.3" />
      <path d="M5.1 8.6v9.3a1.9 1.9 0 0 0 1.9 1.9h10a1.9 1.9 0 0 0 1.9-1.9V8.6" />
      <path d="M9.7 12.4h4.6" />
    </IconShell>
  )
}

export function RestoreIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M4.3 9.6A8.1 8.1 0 1 1 4 13.9" />
      <path d="M4.6 4.7v5h5" />
      <path d="M12 8.3V12l2.7 1.6" />
    </IconShell>
  )
}

export function ShieldIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M12 3.4 5.2 6v5.4c0 4.25 2.8 7.3 6.8 9.2 4-1.9 6.8-4.95 6.8-9.2V6L12 3.4Z" />
      <path d="m9.3 11.9 1.9 1.9 3.7-3.8" />
    </IconShell>
  )
}

export function TrashIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M4.5 6.8h15" />
      <path d="M9.3 4.2h5.4l.7 2.6H8.6l.7-2.6Z" />
      <path d="M6.4 6.8 7.3 19a1.4 1.4 0 0 0 1.4 1.3h6.6A1.4 1.4 0 0 0 16.7 19l.9-12.2" />
      <path d="M10.3 10.6v5.9M13.7 10.6v5.9" />
    </IconShell>
  )
}

export function SparkleIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
      <path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </IconShell>
  )
}

export function MonitorIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <rect x="3.3" y="4.6" width="17.4" height="12.2" rx="2" />
      <path d="M9 20.4h6M12 16.8v3.6" />
    </IconShell>
  )
}

export function CpuIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
      <rect x="9.6" y="9.6" width="4.8" height="4.8" rx="1" />
      <path d="M9.6 3.6v2.9M14.4 3.6v2.9M9.6 17.5v2.9M14.4 17.5v2.9M3.6 9.6h2.9M3.6 14.4h2.9M17.5 9.6h2.9M17.5 14.4h2.9" />
    </IconShell>
  )
}

export function MemoryIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <rect x="3.2" y="7.4" width="17.6" height="8.4" rx="1.8" />
      <path d="M7 15.8v2.4M12 15.8v2.4M17 15.8v2.4M7.4 10.6v2M12 10.6v2M16.6 10.6v2" />
    </IconShell>
  )
}

export function HardDriveIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <rect x="3.4" y="5.3" width="17.2" height="13.4" rx="2.2" />
      <path d="M3.7 13.1h16.6" />
      <circle cx="7.1" cy="16.2" r=".9" fill="currentColor" stroke="none" />
      <path d="M11.8 16.2h5.1" />
    </IconShell>
  )
}

export function DownloadIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M12 4v10.6" />
      <path d="m7.8 10.5 4.2 4.2 4.2-4.2" />
      <path d="M4.5 18.8h15" />
    </IconShell>
  )
}

export function WifiIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M3.8 8.6a12.5 12.5 0 0 1 16.4 0" />
      <path d="M6.7 11.7a8.3 8.3 0 0 1 10.6 0" />
      <path d="M9.6 14.8a4.1 4.1 0 0 1 4.8 0" />
      <circle cx="12" cy="18.1" r="1.1" fill="currentColor" stroke="none" />
    </IconShell>
  )
}

export function TagIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M11.2 3.5H4.9a1.4 1.4 0 0 0-1.4 1.4v6.3L12.7 20.4l7.7-7.7L11.2 3.5Z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </IconShell>
  )
}

export function ChevronDownIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </IconShell>
  )
}

export function GamepadIcon(props: IconProps): JSX.Element {
  return (
    <IconShell {...props}>
      <path d="M7.1 8.2h9.8a4.1 4.1 0 0 1 3.9 5.4l-1 3.1a2.1 2.1 0 0 1-3.5 1l-1.8-1.6a2.8 2.8 0 0 0-3.7 0l-1.8 1.6a2.1 2.1 0 0 1-3.5-1l-1-3.1a4.1 4.1 0 0 1 3.9-5.4Z" />
      <path d="M8.2 11.2v3M6.7 12.7h3M15.3 11.8h.01M17.3 13.6h.01" />
    </IconShell>
  )
}

export function BrandMark({ className = '' }: { className?: string }): JSX.Element {
  return (
    <div
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[13px] border border-white/15 bg-[#181b20] shadow-[0_10px_28px_-10px_rgba(135,156,181,0.75)] ${className}`}
    >
      <img
        src={appIcon}
        alt=""
        aria-hidden="true"
        loading="eager"
        decoding="async"
        draggable={false}
        className="h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 rounded-[12px] ring-1 ring-inset ring-white/10" />
    </div>
  )
}
