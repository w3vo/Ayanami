const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Formats cumulative seconds as "45 mins", "2.5 hrs" or "1,204 hrs". */
export function formatPlaytime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'No playtime'

  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 1) return 'Under a minute'
  if (totalMinutes < 60) return formatCount(totalMinutes, 'min', 'mins')

  const hours = totalSeconds / 3600
  const rounded = Math.round(hours * 10) / 10
  if (rounded < 1000) {
    return formatCount(rounded, 'hr', 'hrs')
  }
  return formatCount(Math.round(hours), 'hr', 'hrs')
}

/** Formats a launch timestamp as "Today", "Yesterday" or "Nov 14, 2026". */
export function formatLastPlayed(isoDate: string | null): string {
  if (!isoDate) return 'Never played'

  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return 'Unknown'

  const difference = Math.round((startOfDay(new Date()) - startOfDay(parsed)) / DAY_MS)
  if (difference === 0) return 'Played today'
  if (difference === 1) return 'Played yesterday'

  return `Played ${new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(parsed)}`
}

export function fileNameFromPath(filePath: string): string {
  const segments = filePath.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? filePath
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`
}

/** Formats a backup/sync timestamp as "Nov 16, 2026, 7:16 PM". */
export function formatDateTime(isoDate: string | null): string {
  if (!isoDate) return 'Never'
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return 'Unknown'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed)
}

/** Formats a timestamp as "Nov 2026". */
export function formatMonthYear(isoDate: string | null): string {
  if (!isoDate) return ''
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return ''

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric'
  }).format(parsed)
}

/** Formats a scheduled event as "7:16 PM". */
export function formatTime(isoDate: string | null): string {
  if (!isoDate) return ''
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return ''

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}
