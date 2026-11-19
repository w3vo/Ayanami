import { app, BrowserWindow, dialog } from 'electron'
import type { DownloadItem, Event as ElectronEvent, WebContents } from 'electron'
import { join } from 'path'
import type { ReleaseType } from '../../shared/types'
import type { DownloadManager } from './manager'
import { sourcePageReferer } from './source-plan'
import { sourceSession } from './source-session'

export interface SourcePageRequest {
  /** Page the user drives. The captured transfer is tied to this page. */
  url: string
  title: string
  releaseType: ReleaseType
  originUri: string
  savePath?: string
}

interface SourceWindowEntry {
  window: BrowserWindow
  request: SourcePageRequest
  /** Referer used for the window's first navigation. */
  referer: string | null
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Owns the visible pages for manual hosts (1fichier, Gofile, MegaDB, VikingFile,
 * Datanodes). Chromium's own download is intercepted and handed to the HTTP
 * engine, so the queue keeps one transfer while the page supplies the host's
 * cookies, referer, and short-lived signed URL.
 *
 * Closing a window only discards this page. A transfer that was already
 * captured keeps running because it lives entirely in DownloadManager.
 */
export class SourceWindowManager {
  private readonly windows = new Map<string, SourceWindowEntry>()
  private readonly byContents = new Map<number, SourceWindowEntry>()
  private sessionListener:
    | ((event: ElectronEvent, item: DownloadItem, contents: WebContents) => void)
    | null = null
  private disposed = false

  constructor(private readonly downloads: DownloadManager) {}

  async open(request: SourcePageRequest): Promise<void> {
    if (this.disposed) return
    if (!isHttpUrl(request.url)) {
      throw new Error('Only http(s) download pages can be opened in Ayanami.')
    }

    const existing = this.windows.get(request.url)
    if (existing && !existing.window.isDestroyed()) {
      existing.window.show()
      existing.window.focus()
      return
    }

    const referer = await sourcePageReferer(request.url).catch(() => null)
    if (this.disposed) return

    // Re-check: the same page may have been opened while its referer was
    // being discovered.
    const alreadyOpen = this.windows.get(request.url)
    if (alreadyOpen && !alreadyOpen.window.isDestroyed()) {
      alreadyOpen.window.show()
      alreadyOpen.window.focus()
      return
    }

    this.ensureSessionListener()
    const window = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 760,
      minHeight: 520,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#0f1115',
      title: `Ayanami — ${request.title}`,
      icon: join(app.getAppPath(), 'assets/icon.png'),
      webPreferences: {
        session: sourceSession(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        plugins: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        backgroundThrottling: false
      }
    })

    const entry: SourceWindowEntry = { window, request, referer }
    const contentsId = window.webContents.id
    this.windows.set(request.url, entry)
    this.byContents.set(contentsId, entry)
    window.setMenuBarVisibility(false)

    // Some host pages stay on a challenge or a slow redirect before their
    // first paint. Never leave the user with an invisible window and a spinner.
    const showTimer = setTimeout(() => {
      if (!window.isDestroyed() && !window.isVisible()) window.show()
    }, 2_500)

    window.once('ready-to-show', () => {
      clearTimeout(showTimer)
      if (!window.isDestroyed()) window.show()
    })

    window.on('closed', () => {
      clearTimeout(showTimer)
      this.byContents.delete(contentsId)
      const current = this.windows.get(request.url)
      if (current === entry) this.windows.delete(request.url)
    })

    this.harden(entry)
    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[source-window] Failed to load preload ${preloadPath}:`, error)
    })

    try {
      await window.loadURL(request.url, referer ? { httpReferrer: referer } : {})
    } catch (error) {
      // Did-fail-load already rendered Chromium's error page; keep the window
      // usable so the user can retry from the address bar.
      console.warn(`[source-window] Failed to load ${request.url}:`, error)
      if (!window.isDestroyed()) window.show()
    }
  }

  /** Closes every source page without touching queued or captured transfers. */
  closeAll(): void {
    for (const entry of [...this.windows.values()]) {
      if (!entry.window.isDestroyed()) entry.window.close()
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.sessionListener) {
      sourceSession().removeListener('will-download', this.sessionListener)
      this.sessionListener = null
    }
    for (const entry of [...this.windows.values()]) {
      if (!entry.window.isDestroyed()) entry.window.destroy()
    }
    this.windows.clear()
    this.byContents.clear()
  }

  private harden(entry: SourceWindowEntry): void {
    const { window } = entry
    const contents = window.webContents

    contents.setWindowOpenHandler(({ url }) => {
      // A same-site link may continue in this window. Cross-site popups are
      // almost always ads or tracking; never create an unmanaged window.
      const currentHost = hostOf(contents.getURL())
      const targetHost = hostOf(url)
      if (
        isHttpUrl(url) &&
        currentHost !== null &&
        targetHost !== null &&
        (currentHost === targetHost ||
          currentHost.endsWith(`.${targetHost}`) ||
          targetHost.endsWith(`.${currentHost}`))
      ) {
        void window.loadURL(url).catch(() => undefined)
      }
      return { action: 'deny' }
    })

    contents.on('will-navigate', (event, url) => {
      if (!isHttpUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isHttpUrl(url)) event.preventDefault()
    })
    // A hostile page must not trap the window open with beforeunload.
    contents.on('will-prevent-unload', (event) => {
      event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  }

  private ensureSessionListener(): void {
    if (this.sessionListener) return
    this.sessionListener = (event, item, contents) => {
      const entry = this.byContents.get(contents.id)
      if (!entry || entry.window.isDestroyed()) return
      this.capture(event, item, contents, entry)
    }
    sourceSession().on('will-download', this.sessionListener)
  }

  private capture(
    event: ElectronEvent,
    item: DownloadItem,
    contents: WebContents,
    entry: SourceWindowEntry
  ): void {
    // Every value must be read synchronously: preventDefault() makes the item
    // unavailable on the next tick.
    let url = ''
    let fileName: string | null = null
    let totalBytes: number | null = null
    let pageUrl = ''
    try {
      url = item.getURL()
    } catch {
      // Leave the URL empty so the failure path reports it.
    }
    try {
      fileName = item.getFilename() || null
    } catch {
      fileName = null
    }
    try {
      totalBytes = item.getTotalBytes() || null
    } catch {
      totalBytes = null
    }
    try {
      pageUrl = contents.getURL()
    } catch {
      pageUrl = entry.request.url
    }

    event.preventDefault()
    try {
      item.cancel()
    } catch {
      // Already canceled by preventDefault; nothing else to do.
    }

    if (!isHttpUrl(url)) {
      this.reportFailure(
        entry,
        'The host produced a download that is not a normal http(s) link, so Ayanami cannot replay it. Use the paste field in Downloads instead.'
      )
      return
    }

    // Same-host automatic providers need the referer their file page was
    // opened with (MegaDB's origin, Buzzheavier's publisher). A cross-host CDN
    // expects the page that actually triggered the download.
    let referer = pageUrl || entry.request.url
    if (entry.referer && hostOf(url) === hostOf(entry.request.url)) {
      referer = entry.referer
    }

    try {
      const result = this.downloads.addCaptured({
        title: entry.request.title,
        sourceUri: url,
        originUri: entry.request.originUri,
        releaseType: entry.request.releaseType,
        savePath: entry.request.savePath,
        totalBytes,
        preferredFileName: fileName,
        referer
      })
      if (!entry.window.isDestroyed()) {
        entry.window.setTitle(
          result.alreadyQueued
            ? `Ayanami — ${entry.request.title} · Already in Downloads`
            : `Ayanami — ${entry.request.title} · Download started`
        )
        entry.window.flashFrame(true)
      }
    } catch (error) {
      this.reportFailure(
        entry,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private reportFailure(entry: SourceWindowEntry, detail: string): void {
    if (entry.window.isDestroyed()) return
    entry.window.show()
    entry.window.focus()
    void dialog
      .showMessageBox(entry.window, {
        type: 'warning',
        title: 'Download not captured',
        message: 'Ayanami could not add this download to its queue.',
        detail,
        buttons: ['OK'],
        noLink: true
      })
      .catch(() => undefined)
  }
}
