import type {
  CompatibilityLevel,
  CompatibilityResult,
  CompatibilityTier,
  CompatibilityVerdict,
  HardwareProfile,
  RequirementCheck,
  RequirementCheckStatus,
  RequirementTier,
  SystemRequirements
} from './types'

export function createEmptyRequirementTier(): RequirementTier {
  return {
    cpu: null,
    gpu: null,
    ramGb: null,
    storageGb: null,
    cpuBenchmark: null,
    gpuBenchmark: null,
    cpuBenchmarkModel: null,
    gpuBenchmarkModel: null,
    cpuGeneric: false,
    gpuGeneric: false
  }
}

export function createEmptyRequirements(): SystemRequirements {
  return {
    minimum: createEmptyRequirementTier(),
    recommended: createEmptyRequirementTier()
  }
}

function hasValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function hasRequirementTierData(tier: RequirementTier): boolean {
  return Boolean(
    tier.cpu ||
      tier.gpu ||
      hasValue(tier.ramGb) ||
      hasValue(tier.storageGb) ||
      hasValue(tier.cpuBenchmark) ||
      hasValue(tier.gpuBenchmark)
  )
}

export function hasRequirementsData(requirements: SystemRequirements): boolean {
  return (
    hasRequirementTierData(requirements.minimum) ||
    hasRequirementTierData(requirements.recommended)
  )
}

function formatGigabytes(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} GB`
}

function formatScore(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/**
 * PassMark scores vary slightly between runs and list entries. A small margin
 * keeps near-identical hardware from being reported as a hard failure.
 */
function compareBenchmarks(
  required: number | null,
  detected: number | null
): RequirementCheckStatus {
  if (!hasValue(required) || !hasValue(detected)) return 'unknown'
  if (detected >= required) return 'pass'
  if (detected >= required * 0.9) return 'warn'
  return 'fail'
}

function compareAmounts(required: number, detected: number): RequirementCheckStatus {
  if (detected >= required) return 'pass'
  if (detected >= required * 0.9) return 'warn'
  return 'fail'
}

function benchmarkDetail(
  label: 'CPU Mark' | 'G3D Mark',
  required: number | null,
  detected: number | null
): string {
  if (!hasValue(required)) {
    return 'This requirement is not in the bundled PassMark database, so it cannot be scored.'
  }
  if (!hasValue(detected)) {
    return `PassMark ${label} ${formatScore(required)} required · your hardware is not in the database.`
  }
  return `PassMark ${label} ${formatScore(required)} required · yours ${formatScore(detected)}.`
}

const GENERIC_DETAIL =
  'Generic requirement — assumed satisfied by this PC. Specific model names are scored with PassMark.'

function buildChecks(tier: RequirementTier, hardware: HardwareProfile): RequirementCheck[] {
  const checks: RequirementCheck[] = []

  if (tier.cpu || hasValue(tier.cpuBenchmark)) {
    checks.push({
      key: 'cpu',
      label: 'Processor',
      required:
        tier.cpu ??
        (hasValue(tier.cpuBenchmark) ? `PassMark CPU Mark ${formatScore(tier.cpuBenchmark)}` : 'Not specified'),
      detected: hardware.cpu || 'Not detected',
      status: tier.cpuGeneric ? 'pass' : compareBenchmarks(tier.cpuBenchmark, hardware.cpuBenchmark),
      detail: tier.cpuGeneric
        ? GENERIC_DETAIL
        : benchmarkDetail('CPU Mark', tier.cpuBenchmark, hardware.cpuBenchmark)
    })
  }

  if (tier.gpu || hasValue(tier.gpuBenchmark)) {
    checks.push({
      key: 'gpu',
      label: 'Graphics',
      required:
        tier.gpu ??
        (hasValue(tier.gpuBenchmark) ? `PassMark G3D Mark ${formatScore(tier.gpuBenchmark)}` : 'Not specified'),
      detected: hardware.gpu || 'Not detected',
      status: tier.gpuGeneric ? 'pass' : compareBenchmarks(tier.gpuBenchmark, hardware.gpuBenchmark),
      detail: tier.gpuGeneric
        ? GENERIC_DETAIL
        : benchmarkDetail('G3D Mark', tier.gpuBenchmark, hardware.gpuBenchmark)
    })
  }

  if (hasValue(tier.ramGb) && tier.ramGb > 0) {
    checks.push({
      key: 'ram',
      label: 'Memory',
      required: formatGigabytes(tier.ramGb),
      detected: hardware.memoryGb > 0 ? `${formatGigabytes(hardware.memoryGb)} installed` : 'Not detected',
      status:
        hardware.memoryGb > 0 ? compareAmounts(tier.ramGb, hardware.memoryGb) : 'unknown',
      detail:
        hardware.memoryGb > 0
          ? `${formatGigabytes(hardware.memoryGb)} of system memory detected.`
          : null
    })
  }

  if (hasValue(tier.storageGb) && tier.storageGb > 0) {
    const drive = hardware.storageDrive
    const free = hardware.freeStorageGb
    const total = hardware.totalStorageGb
    checks.push({
      key: 'storage',
      label: 'Storage',
      required: formatGigabytes(tier.storageGb),
      detected: hasValue(free)
        ? `${formatGigabytes(free)} free${drive ? ` on ${drive}` : ''}`
        : 'Not detected',
      status: hasValue(free) ? compareAmounts(tier.storageGb, free) : 'unknown',
      detail: hasValue(free)
        ? `Checked against ${drive ?? 'the largest drive'} because it has the most total capacity${
            hasValue(total) ? ` (${formatGigabytes(total)})` : ''
          }.`
        : null
    })
  }

  return checks
}

function verdictFromChecks(checks: RequirementCheck[]): CompatibilityVerdict {
  if (checks.length === 0) return 'unknown'
  if (checks.some((check) => check.status === 'fail')) return 'below'
  if (checks.some((check) => check.status === 'warn' || check.status === 'unknown')) return 'near'
  return 'meets'
}

function verdictLabel(verdict: CompatibilityVerdict): string {
  if (verdict === 'meets') return 'Meets'
  if (verdict === 'near') return 'Nearly meets'
  if (verdict === 'below') return 'Below'
  return 'Not listed'
}

function levelResult(tier: RequirementTier, hardware: HardwareProfile): CompatibilityLevel {
  const checks = buildChecks(tier, hardware)
  const verdict = verdictFromChecks(checks)
  return { verdict, label: verdictLabel(verdict), checks }
}

export function evaluateRequirements(
  requirements: SystemRequirements,
  hardware: HardwareProfile
): CompatibilityResult {
  const minimum = levelResult(requirements.minimum, hardware)
  const recommended = levelResult(requirements.recommended, hardware)
  const minimumListed = minimum.checks.length > 0
  const recommendedListed = recommended.checks.length > 0

  let tier: CompatibilityTier
  if (!minimumListed && !recommendedListed) {
    tier = 'unknown'
  } else if (minimumListed) {
    if (minimum.verdict === 'below') {
      tier = 'below'
    } else if (recommendedListed && recommended.verdict === 'meets') {
      tier = 'recommended'
    } else if (minimum.verdict === 'meets' || minimum.verdict === 'near') {
      tier = 'minimum'
    } else {
      tier = 'unknown'
    }
  } else if (recommended.verdict === 'meets') {
    tier = 'recommended'
  } else if (recommended.verdict === 'below') {
    tier = 'below'
  } else {
    tier = 'unknown'
  }

  const presentation: Record<
    CompatibilityTier,
    { label: string; description: string }
  > = {
    recommended: {
      label: 'Recommended',
      description:
        'Your CPU, GPU, memory, and free space clear every recommended target for this title.'
    },
    minimum: {
      label: 'Minimum',
      description:
        'Your PC clears the minimum targets, but falls short of the recommended hardware.'
    },
    below: {
      label: 'Below minimum',
      description:
        'At least one component is below the minimum target. Expect compromises or an unplayable result.'
    },
    unknown: {
      label: 'Compatibility unknown',
      description:
        'Ayanami could not compare enough requirement data with this PC. Missing benchmark entries are reported instead of guessed.'
    }
  }

  return {
    tier,
    label: presentation[tier].label,
    description: presentation[tier].description,
    minimum,
    recommended
  }
}
