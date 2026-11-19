import type { JSX } from 'react'
import { AlertCircleIcon, CheckIcon, CloseIcon, InfoIcon } from './Icons'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastData {
  id: number
  message: string
  tone: ToastTone
}

interface ToastProps {
  toast: ToastData | null
  onDismiss: () => void
}

const TONE_STYLES: Record<
  ToastTone,
  { container: string; icon: string; iconWrap: string }
> = {
  success: {
    container: 'border-emerald-400/20 bg-[#0d1713]/95',
    icon: 'text-emerald-300',
    iconWrap: 'border-emerald-400/20 bg-emerald-400/[0.08]'
  },
  error: {
    container: 'border-red-400/20 bg-[#190f11]/95',
    icon: 'text-red-300',
    iconWrap: 'border-red-400/20 bg-red-400/[0.08]'
  },
  info: {
    container: 'border-ayanami-accent/20 bg-[#10131d]/95',
    icon: 'text-ayanami-accent',
    iconWrap: 'border-ayanami-accent/20 bg-ayanami-accent/[0.08]'
  }
}

export function Toast({ toast, onDismiss }: ToastProps): JSX.Element | null {
  if (!toast) return null

  const style = TONE_STYLES[toast.tone]
  const Icon = toast.tone === 'error' ? AlertCircleIcon : toast.tone === 'success' ? CheckIcon : InfoIcon

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] sm:bottom-6 sm:right-6">
      <div
        key={toast.id}
        role="status"
        aria-live="polite"
        className={`overlay-enter pointer-events-auto flex w-[min(380px,calc(100vw-2.5rem))] items-start gap-3 rounded-xl border p-3.5 shadow-[0_22px_60px_-18px_rgba(0,0,0,0.9)] backdrop-blur-md ${style.container}`}
      >
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${style.iconWrap}`}
        >
          <Icon className={`h-4 w-4 ${style.icon}`} />
        </span>
        <p className="min-w-0 flex-1 pt-1 text-[11px] leading-5 text-slate-300">
          {toast.message}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-white/[0.05] hover:text-slate-300"
        >
          <CloseIcon className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
