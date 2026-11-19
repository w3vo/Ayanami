import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import type { Dirent } from 'fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'path'
import { shell } from 'electron'
import { path7za } from '7zip-bin'
import type {
  DownloadPostprocessStatus,
  DownloadQueueItem
} from '../../shared/types'

const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z'])
const MAX_SCANNED_FILES = 2_000

export interface PostprocessResult {
  status: DownloadPostprocessStatus
  message: string
  /** Final on-disk location to show for this item (archive folder or extracted game folder). */
  location?: string | null
}

export interface PostprocessCallbacks {
  onStatus: (status: DownloadPostprocessStatus, message: string) => void
}

function sanitizeFolderName(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return cleaned.slice(0, 80) || 'Ayanami Game'
}

function hasInstallerName(fileName: string): boolean {
  return /(?:^|[\s._-])(setup|install|installer|repack)(?:[\s._-]|$)/i.test(fileName)
}

function isIgnoredExecutable(fileName: string): boolean {
  return /(?:unins|uninstall|vc_?redist|dxsetup|directx|dotnet|crash|helper)/i.test(fileName)
}

function listFiles(root: string): string[] {
  const found: string[] = []
  const visit = (path: string, depth: number): void => {
    if (found.length >= MAX_SCANNED_FILES || depth > 4) return
    let entries: Dirent[]
    try {
      entries = readdirSync(path, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= MAX_SCANNED_FILES) return
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        visit(child, depth + 1)
      } else if (entry.isFile()) {
        found.push(child)
      }
    }
  }

  if (!existsSync(root)) return found
  if (statSync(root).isFile()) return [root]
  visit(root, 0)
  return found
}

function archiveFamily(filePath: string): string {
  const name = basename(filePath).toLowerCase()
  return name
    .replace(/\.part\d+\.rar$/, '.rar')
    .replace(/\.r\d{2}$/, '.rar')
    .replace(/\.z\d{2}$/, '.zip')
}

function isPrimaryArchive(filePath: string): boolean {
  const name = basename(filePath).toLowerCase()
  if (/\.r\d{2}$/.test(name) || /\.z\d{2}$/.test(name)) return false
  if (/\.part(?:0[2-9]|[1-9]\d+)\.rar$/.test(name)) return false
  return true
}

async function runExtractor(
  executable: string,
  args: string[],
  label: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })

    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2_000)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        const detail = stderr.trim().split(/\r?\n/).filter(Boolean).at(-1)
        reject(new Error(detail ?? `${label} exited with code ${code ?? 'unknown'}.`))
      }
    })
  })
}

/** Raised when an archive is refused rather than merely unreadable. */
class UnsafeArchiveError extends Error {}

const MAX_LISTING_BYTES = 16 * 1024 * 1024

function runCapture(executable: string, args: string[], label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let tooLarge = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (tooLarge) return
      stdout = `${stdout}${chunk}`
      if (stdout.length > MAX_LISTING_BYTES) {
        tooLarge = true
        stdout = ''
        child.kill()
      }
    })
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2_000)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (tooLarge) {
        reject(new Error(`${label} listed more data than can be verified safely.`))
      } else if (code === 0) {
        resolve(stdout)
      } else {
        const detail = stderr.trim().split(/\r?\n/).filter(Boolean).at(-1)
        reject(new Error(detail ?? `${label} exited with code ${code ?? 'unknown'}.`))
      }
    })
  })
}

/**
 * Rejects entries that would land outside the extraction folder: absolute
 * paths, drive-relative paths, UNC paths, and any parent traversal.
 */
function isSafeArchiveEntry(entry: string): boolean {
  const name = entry.trim()
  if (!name || name.includes('\u0000')) return false
  if (isAbsolute(name) || /^[a-zA-Z]:/.test(name)) return false

  const normalized = name.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized) return true
  return !normalized.split('/').some((segment) => segment === '..')
}

async function listSevenZipEntries(executable: string, archivePath: string): Promise<string[]> {
  const output = await runCapture(
    executable,
    ['l', '-ba', '-slt', '-sccUTF-8', archivePath],
    '7-Zip'
  )
  const archiveResolved = resolve(archivePath)
  const entries: string[] = []
  let currentPath: string | null = null
  let linked = false

  const flush = (): void => {
    if (currentPath && resolve(currentPath) !== archiveResolved) {
      if (linked) throw new UnsafeArchiveError('the archive contains a link entry')
      entries.push(currentPath)
    }
    currentPath = null
    linked = false
  }

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      flush()
      continue
    }
    const match = /^([^=]+?)\s*=\s?(.*)$/.exec(line)
    if (!match) continue
    const key = match[1].trim()
    if (key === 'Path') currentPath = match[2]
    else if (key === 'Symbolic Link' || key === 'Hard Link') linked = true
  }
  flush()

  return entries
}

async function listTarEntries(executable: string, archivePath: string): Promise<string[]> {
  const [names, verbose] = await Promise.all([
    runCapture(executable, ['-tf', archivePath], 'Windows tar'),
    runCapture(executable, ['-tvf', archivePath], 'Windows tar')
  ])

  // Verbose lines start with the entry type; links could redirect writes.
  if (verbose.split(/\r?\n/).some((line) => /^[lh]/.test(line.trim()))) {
    throw new UnsafeArchiveError('the archive contains a link entry')
  }

  return names
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function assertVerifiedEntries(archivePath: string, entries: string[]): void {
  if (entries.length === 0) {
    throw new Error(`${basename(archivePath)} does not list any files.`)
  }
  const unsafe = entries.find((entry) => !isSafeArchiveEntry(entry))
  if (unsafe) {
    throw new UnsafeArchiveError(
      `the archive tries to write outside the destination (${unsafe})`
    )
  }
}

/** Resolves a folder under `root`, refusing anything that escapes it. */
function folderWithin(root: string, folderName: string): string {
  const rootPath = resolve(root)
  const target = resolve(rootPath, folderName)
  const offset = relative(rootPath, target)
  if (!offset || offset.startsWith('..') || isAbsolute(offset)) {
    throw new Error('The extraction folder is outside the configured games directory.')
  }
  return target
}

function windowsTarPath(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  const bundled = join(systemRoot, 'System32', 'tar.exe')
  return existsSync(bundled) ? bundled : 'tar.exe'
}

interface Extractor {
  label: string
  executable: string
  args: string[]
  list: (executable: string, archivePath: string) => Promise<string[]>
}

async function extractArchive(archivePath: string, destination: string): Promise<void> {
  // The bundled 7-Zip build has no RAR codec, so fall back to Windows' tar.exe
  // (libarchive) which can read RAR and most other common archive formats.
  const attempts: Extractor[] = []
  if (existsSync(path7za)) {
    attempts.push({
      label: '7-Zip',
      executable: path7za,
      args: ['x', archivePath, `-o${destination}`, '-y', '-bso0', '-bsp0'],
      list: listSevenZipEntries
    })
  }
  const tarPath = windowsTarPath()
  attempts.push({
    label: 'Windows tar',
    executable: tarPath,
    args: ['-xf', archivePath, '-C', destination],
    list: listTarEntries
  })

  const failures: string[] = []
  for (const attempt of attempts) {
    // Every entry is checked against the destination before a byte is written,
    // so a malicious archive cannot escape the games folder.
    try {
      const entries = await attempt.list(attempt.executable, archivePath)
      assertVerifiedEntries(archivePath, entries)
    } catch (error) {
      if (error instanceof UnsafeArchiveError) {
        throw new Error(
          `Ayanami refused to extract ${basename(archivePath)}: ${error.message}. Extract it manually only if you trust the source.`
        )
      }
      const detail = error instanceof Error ? error.message : String(error)
      failures.push(`${attempt.label} verification: ${detail}`)
      continue
    }

    // Only create the destination once the archive has been verified, so a
    // refused archive leaves no empty game folder behind.
    mkdirSync(destination, { recursive: true })
    try {
      await runExtractor(attempt.executable, attempt.args, attempt.label)
      return
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      failures.push(`${attempt.label}: ${detail}`)
    }
  }

  throw new Error(`Could not extract ${basename(archivePath)}. ${failures.join(' ')}`)
}

async function launchInstaller(installerPath: string): Promise<void> {
  const result = await shell.openPath(installerPath)
  if (result) throw new Error(result)
}

/**
 * Post-download workflows: unpack pre-installed archives (and delete them),
 * or open the installer for a repack. The extracted game files are placed in
 * the user's configured Games directory.
 */
export class Postprocessor {
  constructor(private readonly getGamesDirectory: () => string) {}

  async run(item: DownloadQueueItem, callbacks: PostprocessCallbacks): Promise<PostprocessResult> {
    const root = item.filePath ?? item.savePath
    const files = listFiles(root)
    const archives = files.filter((file) => ARCHIVE_EXTENSIONS.has(extname(file).toLowerCase()))
    const executables = files.filter(
      (file) => extname(file).toLowerCase() === '.exe' && !isIgnoredExecutable(basename(file))
    )
    const preferredInstaller: string | null =
      executables.find((file) => hasInstallerName(basename(file))) ?? executables[0] ?? null

    if (item.releaseType === 'preinstalled') {
      const primaryArchives = archives.filter(isPrimaryArchive)
      if (primaryArchives.length > 0) {
        const destination = folderWithin(
          this.getGamesDirectory(),
          sanitizeFolderName(item.title)
        )
        callbacks.onStatus(
          'extracting',
          `Extracting ${primaryArchives.length === 1 ? basename(primaryArchives[0]) : `${primaryArchives.length} archives`} to ${destination}`
        )

        for (const archive of primaryArchives) {
          await extractArchive(archive, destination)
        }

        const families = new Set(primaryArchives.map(archiveFamily))
        for (const archive of archives) {
          if (families.has(archiveFamily(archive))) {
            rmSync(archive, { force: true })
          }
        }

        return {
          status: 'ready',
          message: `Extracted to ${destination}. The archive was removed after verification.`,
          location: destination
        }
      }

      return {
        status: 'ready',
        message: executables[0]
          ? `Files are ready in ${root}. Add ${basename(executables[0])} from the Library when you are ready.`
          : `Files are ready in ${root}.`,
        location: root
      }
    }

    const resolveInstaller = async (): Promise<string | null> => {
      if (preferredInstaller || archives.length === 0) return preferredInstaller

      const extractedFolder = folderWithin(
        item.savePath,
        `${sanitizeFolderName(item.title)} (extracted)`
      )
      callbacks.onStatus('extracting', `Unpacking the repack into ${extractedFolder}`)
      for (const archive of archives.filter(isPrimaryArchive)) {
        await extractArchive(archive, extractedFolder)
      }

      const extractedFiles = listFiles(extractedFolder)
      return (
        extractedFiles.find(
          (file) =>
            extname(file).toLowerCase() === '.exe' &&
            !isIgnoredExecutable(basename(file)) &&
            hasInstallerName(basename(file))
        ) ??
        extractedFiles.find(
          (file) =>
            extname(file).toLowerCase() === '.exe' && !isIgnoredExecutable(basename(file))
        ) ??
        null
      )
    }

    const installer = await resolveInstaller()

    if (!installer) {
      return {
        status: 'error',
        message: 'The download finished, but no installer .exe was found.'
      }
    }

    callbacks.onStatus('installing', `Opening ${basename(installer)}`)
    await launchInstaller(installer)
    return {
      status: 'ready',
      message: `Installer opened: ${basename(installer)}. Complete the installation wizard to finish.`,
      location: installer
    }
  }
}
