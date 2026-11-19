const PALETTES: Array<{ from: string; to: string; accent: string }> = [
  { from: '#161d27', to: '#0b0f14', accent: '#a8c5e5' },
  { from: '#1b1d2b', to: '#0e0f17', accent: '#c4b5fd' },
  { from: '#142225', to: '#090f12', accent: '#6ee7d8' },
  { from: '#291b1c', to: '#120c0d', accent: '#ff9c8a' },
  { from: '#232015', to: '#100f0a', accent: '#e5c877' },
  { from: '#152230', to: '#0a0f15', accent: '#7dd3fc' }
]

function hashCode(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapTitle(title: string): string[] {
  const words = title.trim().split(/\s+/)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > 16 && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }

  if (current) lines.push(current)
  if (lines.length > 3) {
    return [lines[0], lines[1], `${lines.slice(2).join(' ').slice(0, 14)}…`]
  }
  return lines.length > 0 ? lines : ['Untitled']
}

/**
 * Generates a deterministic, self-contained vertical cover. Used for demo
 * metadata and as a fallback when a remote artwork URL cannot be loaded.
 */
export function createPlaceholderCover(
  title: string,
  label = 'AYANAMI · LOCAL COVER'
): string {
  const seed = hashCode(title || 'Ayanami')
  const palette = PALETTES[seed % PALETTES.length]
  const initial = escapeXml((title.trim()[0] ?? 'A').toUpperCase())
  const lines = wrapTitle(title).map(escapeXml)
  const titleMarkup = lines
    .map(
      (line, index) =>
        `<text x="54" y="${666 + index * 62}" font-family="Segoe UI, Arial, sans-serif" font-size="54" font-weight="700" letter-spacing="-1.5" fill="#f8fafc">${line}</text>`
    )
    .join('')
  const angle = 120 + (seed % 80)
  const ringX = 460 + (seed % 90)
  const ringY = 250 + (seed % 110)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.from}"/>
      <stop offset="1" stop-color="${palette.to}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.32"/>
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M48 0H0V48" fill="none" stroke="#ffffff" stroke-opacity="0.035"/>
    </pattern>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070b" stop-opacity="0"/>
      <stop offset="1" stop-color="#05070b" stop-opacity="0.88"/>
    </linearGradient>
  </defs>
  <rect width="600" height="900" fill="url(#bg)"/>
  <rect width="600" height="900" fill="url(#grid)"/>
  <circle cx="${ringX}" cy="${ringY}" r="310" fill="url(#glow)"/>
  <circle cx="${ringX}" cy="${ringY}" r="194" fill="none" stroke="${palette.accent}" stroke-opacity="0.22"/>
  <circle cx="${ringX}" cy="${ringY}" r="148" fill="none" stroke="${palette.accent}" stroke-opacity="0.12"/>
  <path d="M600 ${angle} L380 900" stroke="${palette.accent}" stroke-opacity="0.16" stroke-width="2"/>
  <path d="M600 ${angle + 86} L470 900" stroke="${palette.accent}" stroke-opacity="0.08" stroke-width="2"/>
  <text x="554" y="510" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="480" font-weight="700" fill="${palette.accent}" fill-opacity="0.07">${initial}</text>
  <rect y="500" width="600" height="400" fill="url(#fade)"/>
  <text x="54" y="72" font-family="Segoe UI, Arial, sans-serif" font-size="19" font-weight="700" letter-spacing="7" fill="${palette.accent}">AYANAMI</text>
  <text x="54" y="98" font-family="Segoe UI, Arial, sans-serif" font-size="12" letter-spacing="4" fill="#94a3b8">LOCAL GAME LIBRARY</text>
  <rect x="54" y="596" width="34" height="3" rx="1.5" fill="${palette.accent}"/>
  ${titleMarkup}
  <text x="54" y="840" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" letter-spacing="3.5" fill="#94a3b8">${escapeXml(label)}</text>
  <text x="546" y="840" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="12" letter-spacing="2" fill="${palette.accent}" fill-opacity="0.75">${String(seed % 1000).padStart(3, '0')}</text>
  <rect x="0.5" y="0.5" width="599" height="899" fill="none" stroke="#ffffff" stroke-opacity="0.06"/>
</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
