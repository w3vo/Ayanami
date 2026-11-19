const HERO_PALETTES = [
  { from: '#172232', via: '#0e141e', to: '#080b10', accent: '#a8c5e5' },
  { from: '#241a2e', via: '#14101c', to: '#08070c', accent: '#c4b5fd' },
  { from: '#0f2530', via: '#0b161d', to: '#060b0e', accent: '#6ee7d8' },
  { from: '#2a1b1d', via: '#170f11', to: '#090607', accent: '#ff9c8a' },
  { from: '#262315', via: '#16140c', to: '#080705', accent: '#e5c877' }
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

function wrapTitle(title: string, maxLength: number, maxLines: number): string[] {
  const words = title.trim().split(/\s+/)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxLength && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)

  if (lines.length > maxLines) {
    return [...lines.slice(0, maxLines - 1), `${lines.slice(maxLines - 1).join(' ').slice(0, maxLength - 1)}…`]
  }
  return lines.length > 0 ? lines : ['Untitled']
}

/**
 * Generates a wide, atmospheric hero banner for store pages that do not ship
 * their own artwork. It is deterministic so the same game keeps its look.
 */
export function createPlaceholderHero(
  title: string,
  label = 'AYANAMI · CATALOG ART'
): string {
  const seed = hashCode(title || 'Ayanami')
  const palette = HERO_PALETTES[seed % HERO_PALETTES.length]
  const initial = escapeXml((title.trim()[0] ?? 'A').toUpperCase())
  const ringX = 1090 + (seed % 220)
  const ringY = 210 + (seed % 160)
  const ringRadius = 300 + (seed % 100)
  const titleLines = wrapTitle(title, 22, 2)
  const titleMarkup = titleLines
    .map(
      (line, index) =>
        `<text x="92" y="${592 + index * 58}" font-family="Segoe UI, Arial, sans-serif" font-size="50" font-weight="700" letter-spacing="-1.5" fill="#f8fafc" fill-opacity="0.16">${escapeXml(line)}</text>`
    )
    .join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="760" viewBox="0 0 1600 760">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.from}"/>
      <stop offset="0.55" stop-color="${palette.via}"/>
      <stop offset="1" stop-color="${palette.to}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.34"/>
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="0"/>
      <stop offset="0.55" stop-color="${palette.accent}" stop-opacity="0.2"/>
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
      <path d="M64 0H0V64" fill="none" stroke="#ffffff" stroke-opacity="0.032"/>
    </pattern>
  </defs>
  <rect width="1600" height="760" fill="url(#bg)"/>
  <rect width="1600" height="760" fill="url(#grid)"/>
  <circle cx="${ringX}" cy="${ringY}" r="${ringRadius}" fill="url(#glow)"/>
  <circle cx="${ringX}" cy="${ringY}" r="${Math.round(ringRadius * 0.62)}" fill="none" stroke="${palette.accent}" stroke-opacity="0.2"/>
  <circle cx="${ringX}" cy="${ringY}" r="${Math.round(ringRadius * 0.46)}" fill="none" stroke="${palette.accent}" stroke-opacity="0.1"/>
  <path d="M0 240 L1600 100" stroke="url(#beam)" stroke-width="2"/>
  <path d="M0 280 L1600 140" stroke="url(#beam)" stroke-width="1"/>
  <path d="M${880 + (seed % 80)} 760 L1430 0" stroke="${palette.accent}" stroke-opacity="0.09" stroke-width="2"/>
  <text x="1500" y="580" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="520" font-weight="700" fill="${palette.accent}" fill-opacity="0.045">${initial}</text>
  <text x="92" y="92" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" letter-spacing="6" fill="${palette.accent}" fill-opacity="0.8">AYANAMI</text>
  <text x="92" y="120" font-family="Segoe UI, Arial, sans-serif" font-size="11" letter-spacing="4" fill="#94a3b8" fill-opacity="0.7">STORE CATALOG</text>
  ${titleMarkup}
  <text x="92" y="700" font-family="Segoe UI, Arial, sans-serif" font-size="11" font-weight="600" letter-spacing="3.5" fill="#94a3b8" fill-opacity="0.45">${escapeXml(label)}</text>
  <text x="1508" y="700" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="11" letter-spacing="2" fill="${palette.accent}" fill-opacity="0.5">${String(seed % 1000).padStart(3, '0')}</text>
  <rect x="0.5" y="0.5" width="1599" height="759" fill="none" stroke="#ffffff" stroke-opacity="0.05"/>
</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * Generates a widescreen preview frame for manifests that do not include
 * screenshots. The composition changes with the game title and frame index.
 */
export function createPlaceholderScreenshot(title: string, index = 0): string {
  const seed = hashCode(`${title}:${index}`)
  const palette = HERO_PALETTES[(seed + index) % HERO_PALETTES.length]
  const lines = wrapTitle(title, 24, 2)
  const horizon = 420 + (seed % 80)
  const sunX = 860 + (seed % 260)
  const sunY = 220 + (seed % 90)
  const sunSize = 70 + (seed % 60)
  const titleMarkup = lines
    .map(
      (line, lineIndex) =>
        `<text x="90" y="${548 + lineIndex * 54}" font-family="Segoe UI, Arial, sans-serif" font-size="46" font-weight="700" letter-spacing="-1.4" fill="#f8fafc" fill-opacity="0.9">${escapeXml(line)}</text>`
    )
    .join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.from}"/>
      <stop offset="0.62" stop-color="${palette.via}"/>
      <stop offset="1" stop-color="${palette.to}"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070b" stop-opacity="0"/>
      <stop offset="1" stop-color="#05070b" stop-opacity="0.75"/>
    </linearGradient>
    <pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse">
      <path d="M52 0H0V52" fill="none" stroke="#ffffff" stroke-opacity="0.028"/>
    </pattern>
  </defs>
  <rect width="1280" height="720" fill="url(#sky)"/>
  <rect width="1280" height="720" fill="url(#grid)"/>
  <circle cx="${sunX}" cy="${sunY}" r="${sunSize * 2.8}" fill="url(#sun)"/>
  <circle cx="${sunX}" cy="${sunY}" r="${sunSize}" fill="${palette.accent}" fill-opacity="0.13"/>
  <circle cx="${sunX}" cy="${sunY}" r="${Math.round(sunSize * 0.68)}" fill="${palette.accent}" fill-opacity="0.09"/>
  <path d="M0 ${horizon} L1280 ${horizon - 60} L1280 720 L0 720 Z" fill="#070a0e" fill-opacity="0.68"/>
  <path d="M0 ${horizon + 20} L1280 ${horizon - 40}" stroke="${palette.accent}" stroke-opacity="0.14" stroke-width="2"/>
  <path d="M${180 + (seed % 80)} 720 L${430 + (seed % 60)} ${horizon - 80} L${600 + (seed % 80)} 720 Z" fill="#05070b" fill-opacity="0.5"/>
  <path d="M${790 + (seed % 90)} 720 L${930 + (seed % 70)} ${horizon - 130} L${1090 + (seed % 60)} 720 Z" fill="#05070b" fill-opacity="0.42"/>
  <rect y="480" width="1280" height="240" fill="url(#fade)"/>
  <text x="90" y="84" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="700" letter-spacing="5" fill="${palette.accent}" fill-opacity="0.78">AYANAMI · PREVIEW ${String(index + 1).padStart(2, '0')}</text>
  <rect x="90" y="488" width="30" height="3" rx="1.5" fill="${palette.accent}" fill-opacity="0.8"/>
  ${titleMarkup}
  <text x="90" y="670" font-family="Segoe UI, Arial, sans-serif" font-size="11" letter-spacing="3" fill="#94a3b8" fill-opacity="0.6">CATALOG SCREENSHOT · GENERATED PLACEHOLDER</text>
  <rect x="0.5" y="0.5" width="1279" height="719" fill="none" stroke="#ffffff" stroke-opacity="0.05"/>
</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
