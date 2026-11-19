#!/usr/bin/env node
/**
 * Downloads the public PassMark CPU Mark and G3D Mark lists and writes the
 * bundled benchmark snapshot used by the Store. Run `npm run benchmarks:update`
 * to refresh the data. No API key is required.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUTPUT = join(ROOT, 'src', 'main', 'data', 'hardware-benchmarks.json')

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const CPU_SOURCES = [
  'https://www.cpubenchmark.net/cpu-list/intel',
  'https://www.cpubenchmark.net/cpu-list/amd'
]
const GPU_SOURCE = 'https://www.videocardbenchmark.net/gpu_list.php'

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
}

function cleanName(value) {
  return decodeEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchList(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml'
    }
  })
  if (!response.ok) {
    throw new Error(`PassMark request failed (${response.status}) for ${url}`)
  }
  return response.text()
}

function parseCpuRows(html) {
  const rows = []
  const pattern =
    /<tr\s+id="cpu\d+"[^>]*>\s*<td[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>([\d,]+)<\/td>/gi
  for (const match of html.matchAll(pattern)) {
    const name = cleanName(match[1])
    const score = Number(match[2].replace(/,/g, ''))
    if (name && Number.isFinite(score) && score > 0) rows.push([name, score])
  }
  return rows
}

function parseGpuRows(html) {
  const rows = []
  const pattern =
    /<tr\s+id="gpu\d+"[^>]*>\s*<td[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>\s*([\d,]+|NA)\s*<\/td>/gi
  for (const match of html.matchAll(pattern)) {
    const name = cleanName(match[1])
    const rawScore = match[2].toUpperCase()
    if (!name || rawScore === 'NA') continue
    const score = Number(rawScore.replace(/,/g, ''))
    if (Number.isFinite(score) && score > 0) rows.push([name, score])
  }
  return rows
}

function dedupe(rows) {
  const seen = new Map()
  for (const [name, score] of rows) {
    const key = name.toLowerCase()
    const existing = seen.get(key)
    if (!existing || existing[1] < score) seen.set(key, [name, score])
  }
  return [...seen.values()].sort((first, second) => {
    if (second[1] !== first[1]) return second[1] - first[1]
    return first[0].localeCompare(second[0])
  })
}

async function main() {
  const cpu = []
  for (const url of CPU_SOURCES) {
    const html = await fetchList(url)
    const rows = parseCpuRows(html)
    console.log(`${url}: ${rows.length} CPUs`)
    cpu.push(...rows)
  }

  const gpuHtml = await fetchList(GPU_SOURCE)
  const gpu = parseGpuRows(gpuHtml)
  console.log(`${GPU_SOURCE}: ${gpu.length} GPUs`)

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'PassMark public benchmark lists',
    cpu: dedupe(cpu),
    gpu: dedupe(gpu)
  }

  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, `${JSON.stringify(payload)}\n`, 'utf8')
  console.log(`Wrote ${payload.cpu.length} CPUs and ${payload.gpu.length} GPUs to ${OUTPUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
