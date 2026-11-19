import type { JSX, ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow: string
  title: string
  description: ReactNode
  aside?: ReactNode
}

export function PageHeader({
  eyebrow,
  title,
  description,
  aside
}: PageHeaderProps): JSX.Element {
  return (
    <header className="flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-3 text-[9px] font-semibold uppercase tracking-[0.3em] text-slate-500">
          <span className="h-px w-7 bg-gradient-to-r from-ayanami-accent/80 to-transparent" />
          {eyebrow}
        </div>
        <h1 className="mt-4 font-display text-[34px] font-semibold leading-none tracking-[-0.025em] text-white text-glow">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-[13px] leading-6 text-slate-400">{description}</p>
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </header>
  )
}
