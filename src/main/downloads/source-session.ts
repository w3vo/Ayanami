import { session, type Session } from 'electron'

/**
 * Catalog hosts are untrusted third-party pages, so they get their own
 * persistent session instead of sharing cookies with Google Drive auth or the
 * app renderer. Persisting matters: a Cloudflare clearance cookie, or a host's
 * short-lived download cookie, must stay usable across the resolver, the
 * transfer engine, and the source window.
 */
export const SOURCE_PARTITION = 'persist:ayanami-sources'

const CHROME_VERSION = process.versions.chrome ?? '120.0.0.0'

function platformToken(): string {
  if (process.platform === 'win32') return 'Windows NT 10.0; Win64; x64'
  if (process.platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7'
  return 'X11; Linux x86_64'
}

/**
 * The embedded Chromium version is used verbatim so the UA string, TLS
 * fingerprint, and JavaScript environment all agree. Hosts that fingerprint
 * clients reject mismatches, and Cloudflare binds clearance to the UA.
 */
export const SOURCE_USER_AGENT =
  `Mozilla/5.0 (${platformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROME_VERSION} Safari/537.36`

let cachedSession: Session | null = null
let hardened = false

export function sourceSession(): Session {
  if (!cachedSession) {
    const created = session.fromPartition(SOURCE_PARTITION)
    created.setUserAgent(SOURCE_USER_AGENT)
    cachedSession = created
  }

  if (!hardened) {
    hardened = true
    // Source pages are untrusted. Nothing in this session may reach the OS,
    // and the resolver or transfer engine never needs a device permission.
    cachedSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    cachedSession.setPermissionCheckHandler(() => false)
  }

  return cachedSession
}

export interface SourceRequestInit extends RequestInit {
  /** Overrides the pinned UA when a host requires a specific client string. */
  userAgent?: string
}

/**
 * Main-process HTTP for catalog hosts. Using Electron's network stack (rather
 * than Node's global fetch) shares the session cookie jar, so a cookie set on
 * an earlier redirect is replayed on later range requests, and a challenge
 * resolved in a source window also unlocks the transfer.
 */
export async function sourceFetch(
  url: string,
  init: SourceRequestInit = {}
): Promise<Response> {
  const { userAgent, ...rest } = init
  const headers = new Headers(rest.headers)
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', userAgent ?? SOURCE_USER_AGENT)
  }

  return sourceSession().fetch(url, {
    ...rest,
    headers,
    credentials: 'include'
  })
}
