import type { JSX, SVGProps } from 'react'

export function Spinner({
  className = 'h-4 w-4',
  ...props
}: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.4" />
      <path
        d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
