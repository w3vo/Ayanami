import benchmarkData from './data/hardware-benchmarks.json'

export type BenchmarkKind = 'cpu' | 'gpu'

export interface BenchmarkMatch {
  /** PassMark CPU Mark or G3D Mark. */
  score: number
  /** The matched PassMark entry name. */
  name: string
}

export interface RequirementBenchmark {
  score: number | null
  model: string | null
  candidates: string[]
  /** True when the requirement is a generic spec rather than a specific model. */
  generic: boolean
}

interface RawBenchmarkFile {
  generatedAt: string
  source: string
  cpu: Array<[string, number]>
  gpu: Array<[string, number]>
}

interface IndexedBenchmark {
  name: string
  score: number
  norm: string
}

const DATA = benchmarkData as unknown as RawBenchmarkFile

const MOBILE_MARKER = /\b(?:mobile|laptop|notebook|max q)\b/
const GENERIC_SINGLE_KEYS = new Set([
  'amd',
  'arc',
  'core',
  'geforce',
  'gpu',
  'graphics',
  'hd',
  'intel',
  'iris',
  'laptop',
  'max',
  'mobile',
  'nvidia',
  'radeon',
  'rtx',
  'rx',
  'gtx',
  'uhd',
  'vega'
])

/**
 * Folds a CPU/GPU marketing name into a comparable key. Clocks, core counts,
 * trademark marks, and vendor filler are removed, while model suffixes such as
 * Ti, Super, XT, and 3GB stay intact.
 */
export function normalizeModelName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(r\)|\(tm\)|\(c\)|™|®|©/g, ' ')
    .replace(/\bcore\s*2\b/g, 'core 2')
    .replace(/\b(\d+)\s*gb\b/g, '$1 gb')
    .replace(/@\s*\d+(?:\.\d+)?\s*ghz\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*ghz\b/g, ' ')
    .replace(
      /\b(?:single|dual|quad|hexa|six|eight|ten|twelve|sixteen|\d+)[- ]core\b/g,
      ' '
    )
    .replace(/\b(?:cpu|processor|gpu|apu|vram)\b/g, ' ')
    .replace(/\b(?:with\s+)?max[- ]?q(?:\s+design)?\b/g, ' max q ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUsefulKey(key: string): boolean {
  if (!key) return false
  const tokens = key.split(' ')
  if (tokens.length === 1 && GENERIC_SINGLE_KEYS.has(tokens[0])) return false
  return true
}

/**
 * Builds progressively looser lookup keys for a model. The first key is the
 * most faithful one, so memory-specific cards (GTX 1060 3GB) resolve before
 * their base model.
 */
function modelKeys(value: string): string[] {
  const base = normalizeModelName(value)
  if (!base) return []

  const keys: string[] = []
  const push = (key: string): void => {
    const clean = key.replace(/\s+/g, ' ').trim()
    if (!isUsefulKey(clean) || keys.includes(clean)) return
    keys.push(clean)
  }

  const vendorless = base.replace(/^(?:nvidia|amd|intel|apple)\s+/, '')
  const seriesless = vendorless.replace(/^(?:geforce|radeon)\s+/, '')
  const coreless = vendorless.replace(/^core\s+/, '')
  const allPrefixes = seriesless.replace(/^core\s+/, '')

  for (const candidate of [base, vendorless, seriesless, coreless, allPrefixes]) {
    const withoutMemory = candidate
      .replace(/\b\d+\s*gb\b/g, ' ')
      .replace(/\bwith\s+(?:radeon|intel)\s+graphics\b/g, ' ')
    const withoutMobile = candidate
      .replace(/\b(?:laptop|mobile|notebook)\b/g, ' ')
      .replace(/\bmax q\b/g, ' ')
    const withoutMobileMemory = withoutMemory
      .replace(/\b(?:laptop|mobile|notebook)\b/g, ' ')
      .replace(/\bmax q\b/g, ' ')

    push(candidate)
    push(withoutMemory)
    push(withoutMobile)
    push(withoutMobileMemory)
  }

  return keys
}

function preferEntry(
  candidate: IndexedBenchmark,
  current: IndexedBenchmark,
  key: string
): boolean {
  const candidateExact = candidate.norm === key
  const currentExact = current.norm === key
  if (candidateExact !== currentExact) return candidateExact

  const candidateMobile = MOBILE_MARKER.test(candidate.norm)
  const currentMobile = MOBILE_MARKER.test(current.norm)
  if (candidateMobile !== currentMobile) return !candidateMobile

  if (candidate.score !== current.score) return candidate.score > current.score
  return candidate.norm.length < current.norm.length
}

class BenchmarkIndex {
  private readonly exact = new Map<string, IndexedBenchmark>()
  private readonly relaxed = new Map<string, IndexedBenchmark>()

  constructor(rows: Array<[string, number]>) {
    for (const [name, score] of rows) {
      if (!name || !Number.isFinite(score) || score <= 0) continue
      const entry: IndexedBenchmark = {
        name,
        score: Math.round(score),
        norm: normalizeModelName(name)
      }
      if (!entry.norm) continue

      const currentExact = this.exact.get(entry.norm)
      if (!currentExact || preferEntry(entry, currentExact, entry.norm)) {
        this.exact.set(entry.norm, entry)
      }

      for (const key of modelKeys(name)) {
        const current = this.relaxed.get(key)
        if (!current || preferEntry(entry, current, key)) {
          this.relaxed.set(key, entry)
        }
      }
    }
  }

  lookup(value: string | null | undefined): BenchmarkMatch | null {
    if (!value) return null
    const base = normalizeModelName(value)
    if (!base) return null

    const exact = this.exact.get(base)
    if (exact) return { score: exact.score, name: exact.name }

    for (const key of modelKeys(value)) {
      const hit = this.relaxed.get(key)
      if (hit) return { score: hit.score, name: hit.name }
    }

    return null
  }
}

const CPU_INDEX = new BenchmarkIndex(DATA.cpu)
const GPU_INDEX = new BenchmarkIndex(DATA.gpu)

export function lookupCpuBenchmark(model: string | null | undefined): BenchmarkMatch | null {
  return CPU_INDEX.lookup(model)
}

export function lookupGpuBenchmark(model: string | null | undefined): BenchmarkMatch | null {
  return GPU_INDEX.lookup(model)
}

export function lookupBenchmark(
  kind: BenchmarkKind,
  model: string | null | undefined
): BenchmarkMatch | null {
  return kind === 'cpu' ? lookupCpuBenchmark(model) : lookupGpuBenchmark(model)
}

const CPU_PATTERNS: RegExp[] = [
  /(?:intel\s+)?core\s+ultra\s+[3579]\s+\d{3}[a-z]{0,3}\b/gi,
  /(?:intel\s+)?core\s*2\s+(?:duo|quad)\s+[a-z]\d{4}\b/gi,
  /(?:intel\s+)?(?:core\s+)?i[3579][- ]?\d{3,5}[a-z]{0,4}\b/gi,
  /(?:amd\s+)?ryzen\s+(?:ai\s+)?[3579]\s+(?:hx\s+|pro\s+)?\d{3,4}[a-z0-9]*\b/gi,
  /(?:amd\s+)?ryzen\s+threadripper(?:\s+pro)?\s+\d{4}[a-z0-9]*\b/gi,
  /(?:amd\s+)?(?:a|fx)[- ]?\d{1,2}[- ]?\d{3,4}[a-z]{0,3}\b/gi,
  /(?:amd\s+)?athlon(?:\s+ii)?(?:\s+x\d+)?\s+\d{3,4}[a-z]{0,3}\b/gi,
  /(?:intel\s+)?(?:pentium|celeron)\s+[a-z]?\d{3,4}[a-z]{0,3}\b/gi,
  /(?:intel\s+)?xeon\s+[a-z0-9][a-z0-9-]*\b/gi,
  /apple\s+m[1-4](?:\s+(?:pro|max|ultra))?\b/gi
]

const GPU_PATTERNS: RegExp[] = [
  /(?:nvidia\s+)?(?:geforce\s+)?(?:rtx|gtx|mx)\s*\d{3,4}(?:\s*(?:ti|super))?(?:\s*(?:\(mobile\)|\(laptop\)|laptop|mobile)(?:\s+gpu)?)?(?:\s*\d+\s*gb)?/gi,
  /(?:nvidia\s+)?geforce\s+\d{3,4}\s*(?:gtx|gts|gt|gs|le)?\b/gi,
  /(?:amd\s+)?(?:radeon\s+)?(?:rx|hd)\s*\d{3,4}(?:\s*(?:xtx|xt|gre))?(?:\s*\d+\s*gb)?/gi,
  /(?:amd\s+)?(?:radeon\s+)?r[579]\s*\d{3}(?:\s*x)?(?:\s*\d+\s*gb)?/gi,
  /(?:amd\s+)?(?:radeon\s+)?(?:rx\s+)?vega\s+\d{2}(?:\s*\d+\s*gb)?/gi,
  /(?:intel\s+)?arc\s+[ab]\d{3}(?:\s*pro)?/gi,
  /(?:intel\s+)?(?:hd|uhd|iris(?:\s+xe)?)\s+graphics(?:\s+\d{3,4})?/gi,
  /apple\s+m[1-4](?:\s+(?:pro|max|ultra))?\b/gi
]

function extractCandidates(text: string, patterns: RegExp[]): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const value = match[0].trim()
      const key = value.toLowerCase()
      if (!value || seen.has(key)) continue
      seen.add(key)
      candidates.push(value)
    }
  }
  return candidates
}

function scoreCandidates(
  index: BenchmarkIndex,
  text: string | null | undefined,
  patterns: RegExp[]
): RequirementBenchmark {
  if (!text || !text.trim()) {
    return { score: null, model: null, candidates: [], generic: false }
  }

  const candidates = extractCandidates(text, patterns)
  const hits: Array<BenchmarkMatch & { candidate: string }> = []
  for (const candidate of candidates) {
    const match = index.lookup(candidate)
    if (match) hits.push({ ...match, candidate })
  }

  hits.sort((first, second) => second.score - first.score)

  // Steam lists equivalent hardware alternatives with "or". Use the strongest
  // listed alternative so the bar does not change when a weaker option is added
  // to the same comparison.
  const strongest = hits[0]

  // Specifications such as "DirectX compatible", "128 MB VRAM", or "3.8 GHz"
  // do not name a scoreable model. They are treated as generic and assumed
  // satisfied. A named model that is missing from PassMark stays unknown, even
  // when the same line also mentions VRAM or a clock speed.
  const modelLike = candidates.some((candidate) => /\d/.test(candidate))
  const generic = hits.length === 0 && !modelLike

  return {
    score: strongest?.score ?? null,
    model: strongest?.name ?? null,
    candidates,
    generic
  }
}

const cpuRequirementCache = new Map<string, RequirementBenchmark>()
const gpuRequirementCache = new Map<string, RequirementBenchmark>()

export function benchmarkCpuRequirement(text: string | null | undefined): RequirementBenchmark {
  if (!text) return { score: null, model: null, candidates: [], generic: false }
  const cached = cpuRequirementCache.get(text)
  if (cached) return cached
  const result = scoreCandidates(CPU_INDEX, text, CPU_PATTERNS)
  cpuRequirementCache.set(text, result)
  return result
}

export function benchmarkGpuRequirement(text: string | null | undefined): RequirementBenchmark {
  if (!text) return { score: null, model: null, candidates: [], generic: false }
  const cached = gpuRequirementCache.get(text)
  if (cached) return cached
  const result = scoreCandidates(GPU_INDEX, text, GPU_PATTERNS)
  gpuRequirementCache.set(text, result)
  return result
}

export function benchmarkForRequirements(
  kind: BenchmarkKind,
  text: string | null | undefined
): RequirementBenchmark {
  return kind === 'cpu' ? benchmarkCpuRequirement(text) : benchmarkGpuRequirement(text)
}

export interface BenchmarkSnapshotInfo {
  generatedAt: string
  source: string
  cpuCount: number
  gpuCount: number
}

export function getBenchmarkSnapshotInfo(): BenchmarkSnapshotInfo {
  return {
    generatedAt: DATA.generatedAt,
    source: DATA.source,
    cpuCount: DATA.cpu.length,
    gpuCount: DATA.gpu.length
  }
}
