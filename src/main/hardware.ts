import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import * as si from 'systeminformation'
import type { Systeminformation } from 'systeminformation'
import type { HardwareProfile } from '../shared/types'
import { lookupCpuBenchmark, lookupGpuBenchmark } from './hardware-benchmarks'

const CACHE_VERSION = 2
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface HardwareCacheFile {
  version: number
  profile: HardwareProfile
}

function round(value: number, precision = 1): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function bytesToGigabytes(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return round(value / 1024 ** 3)
}

function safe<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(() => null)
}

function gpuBenchmark(model: string | null | undefined): number {
  return lookupGpuBenchmark(model)?.score ?? 0
}

function pickPrimaryGpu(
  controllers: Systeminformation.GraphicsControllerData[]
): Systeminformation.GraphicsControllerData | null {
  const usable = controllers.filter(
    (controller) =>
      Boolean(controller.model?.trim()) &&
      !/basic display|remote display|virtual display/i.test(controller.model)
  )
  if (usable.length === 0) return null

  let best = usable[0]
  let bestScore = gpuBenchmark(best.model)
  let bestVram = best.vram ?? 0

  for (const controller of usable.slice(1)) {
    const score = gpuBenchmark(controller.model)
    const vram = controller.vram ?? 0
    if (score > bestScore || (score === bestScore && vram > bestVram)) {
      best = controller
      bestScore = score
      bestVram = vram
    }
  }

  return best
}

function driveLabel(mount: string): string | null {
  const text = mount.trim()
  if (!text) return null
  const match = /^([a-z]):/i.exec(text)
  return match ? `${match[1].toUpperCase()}:` : text
}

/**
 * Storage checks use the largest volume by total capacity, not the Windows
 * system drive. A 931 GB games drive with 504 GB free is more representative
 * than a small C: partition.
 */
function pickLargestVolume(
  disks: Systeminformation.FsSizeData[]
): Systeminformation.FsSizeData | null {
  const usable = disks.filter(
    (disk) => typeof disk.size === 'number' && Number.isFinite(disk.size) && disk.size > 0
  )
  if (usable.length === 0) return disks[0] ?? null

  return [...usable].sort((first, second) => {
    if (second.size !== first.size) return second.size - first.size
    return (second.available ?? 0) - (first.available ?? 0)
  })[0]
}

function storageFields(
  disk: Systeminformation.FsSizeData | null
): Pick<HardwareProfile, 'freeStorageGb' | 'totalStorageGb' | 'storageDrive'> {
  return {
    freeStorageGb: bytesToGigabytes(disk?.available),
    totalStorageGb: bytesToGigabytes(disk?.size),
    storageDrive: disk ? driveLabel(disk.mount) : null
  }
}

async function detectProfile(): Promise<HardwareProfile> {
  const [cpu, graphics, memory, disks, os] = await Promise.all([
    safe(si.cpu()),
    safe(si.graphics()),
    safe(si.mem()),
    safe(si.fsSize()),
    safe(si.osInfo())
  ])

  const cpuBrand = cpu?.brand?.trim() || cpu?.model?.trim() || 'Unknown CPU'
  const gpu = pickPrimaryGpu(graphics?.controllers ?? [])
  const gpuModel = gpu?.model?.trim() || 'Unknown GPU'
  const largestVolume = pickLargestVolume(disks ?? [])

  const vramGb =
    gpu && !gpu.vramDynamic && typeof gpu.vram === 'number' && gpu.vram > 0
      ? round(gpu.vram / 1024)
      : null

  return {
    cpu: cpuBrand,
    cpuVendor: cpu?.manufacturer?.trim() || cpu?.vendor?.trim() || null,
    cpuCores: cpu?.physicalCores && cpu.physicalCores > 0 ? cpu.physicalCores : null,
    cpuThreads: cpu?.cores && cpu.cores > 0 ? cpu.cores : null,
    cpuSpeedGhz: cpu?.speed && cpu.speed > 0 ? round(cpu.speed) : null,
    cpuBenchmark: lookupCpuBenchmark(cpuBrand)?.score ?? null,
    gpu: gpuModel,
    gpuVendor: gpu?.vendor?.trim() || null,
    gpuVramGb: vramGb,
    gpuBenchmark: lookupGpuBenchmark(gpuModel)?.score ?? null,
    memoryGb: bytesToGigabytes(memory?.total) ?? 0,
    ...storageFields(largestVolume),
    os: os ? `${os.distro} ${os.release}`.trim() : 'Windows',
    detectedAt: new Date().toISOString(),
    fromCache: false
  }
}

function createFallbackProfile(): HardwareProfile {
  return {
    cpu: 'Unknown CPU',
    cpuVendor: null,
    cpuCores: null,
    cpuThreads: null,
    cpuSpeedGhz: null,
    cpuBenchmark: null,
    gpu: 'Unknown GPU',
    gpuVendor: null,
    gpuVramGb: null,
    gpuBenchmark: null,
    memoryGb: 0,
    freeStorageGb: null,
    totalStorageGb: null,
    storageDrive: null,
    os: 'Windows',
    detectedAt: new Date().toISOString(),
    fromCache: false
  }
}

function isHardwareProfile(value: unknown): value is HardwareProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Partial<HardwareProfile>
  return (
    typeof profile.cpu === 'string' &&
    typeof profile.gpu === 'string' &&
    typeof profile.memoryGb === 'number' &&
    typeof profile.detectedAt === 'string'
  )
}

/**
 * Detects local CPU, GPU, memory, and storage once, then serves the cached
 * profile to the Store. The on-disk cache keeps Store navigation fast across
 * restarts, while free space is re-read on every access so install-size checks
 * never rely on a stale number.
 */
export class HardwareDetector {
  private profile: HardwareProfile | null = null
  private inFlight: Promise<HardwareProfile> | null = null

  constructor(private readonly cachePath: string) {}

  getProfile(forceRefresh = false): Promise<HardwareProfile> {
    if (!forceRefresh && this.profile) {
      return this.withFreshStorage(this.profile)
    }
    if (this.inFlight) return this.inFlight

    const task = (async (): Promise<HardwareProfile> => {
      try {
        if (!forceRefresh) {
          const cached = this.readCache()
          if (cached) {
            const refreshed = await this.withFreshStorage(cached)
            this.profile = refreshed
            return refreshed
          }
        }

        const detected = await detectProfile()
        this.profile = detected
        this.writeCache(detected)
        return detected
      } catch (error) {
        console.warn('[hardware] Could not detect this PC:', error)
        if (this.profile) return this.profile
        const fallback = createFallbackProfile()
        this.profile = fallback
        return fallback
      } finally {
        this.inFlight = null
      }
    })()

    this.inFlight = task
    return task
  }

  private async withFreshStorage(profile: HardwareProfile): Promise<HardwareProfile> {
    const disks = await safe(si.fsSize())
    if (!disks || disks.length === 0) return profile

    const largest = pickLargestVolume(disks)
    const fields = storageFields(largest)
    if (
      fields.freeStorageGb === profile.freeStorageGb &&
      fields.totalStorageGb === profile.totalStorageGb &&
      fields.storageDrive === profile.storageDrive
    ) {
      return profile
    }

    const refreshed = { ...profile, ...fields }
    this.profile = refreshed
    return refreshed
  }

  private readCache(): HardwareProfile | null {
    if (!existsSync(this.cachePath)) return null

    try {
      const parsed = JSON.parse(readFileSync(this.cachePath, 'utf8')) as Partial<HardwareCacheFile>
      if (parsed.version !== CACHE_VERSION || !isHardwareProfile(parsed.profile)) return null

      const age = Date.now() - Date.parse(parsed.profile.detectedAt)
      if (!Number.isFinite(age) || age < 0 || age > CACHE_TTL_MS) return null

      return { ...parsed.profile, fromCache: true }
    } catch (error) {
      console.warn('[hardware] Ignoring an unreadable hardware cache:', error)
      return null
    }
  }

  private writeCache(profile: HardwareProfile): void {
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true })
      const payload: HardwareCacheFile = { version: CACHE_VERSION, profile }
      writeFileSync(this.cachePath, JSON.stringify(payload, null, 2), 'utf8')
    } catch (error) {
      console.warn('[hardware] Could not cache this PC’s hardware profile:', error)
    }
  }
}
