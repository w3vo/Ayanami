import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { dirname } from 'path'
import { safeStorage, shell } from 'electron'
import { google } from 'googleapis'
import type { Credentials, OAuth2Client } from 'google-auth-library'
import { hasEnv } from './env'
import type { DriveStatus } from '../shared/types'

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const SCOPES = ['openid', 'email', 'profile', DRIVE_FILE_SCOPE]

const AUTH_TIMEOUT_MS = 5 * 60 * 1000

interface StoredAccount {
  email: string | null
  name: string | null
  picture: string | null
}

interface StoredAuth {
  version: 1
  tokens: Credentials
  scopes: string[]
  account: StoredAccount | null
  connectedAt: string
}

interface PersistedAuthFile {
  version: 1
  encrypted: boolean
  payload: string
}

interface AuthCallback {
  code?: string
  error?: string
}

function hasUsableToken(stored: StoredAuth | null): stored is StoredAuth {
  if (!stored) return false
  if (stored.tokens.refresh_token) return true
  if (!stored.tokens.access_token) return false
  if (!stored.tokens.expiry_date) return true
  return stored.tokens.expiry_date > Date.now() + 30_000
}

function splitScopes(scope: string | null | undefined): string[] {
  if (!scope) return []
  return [...new Set(scope.split(/\s+/).filter(Boolean))]
}

function hasDriveFileScope(scopes: readonly string[]): boolean {
  return scopes.includes(DRIVE_FILE_SCOPE)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function callbackPage(title: string, message: string, success: boolean): string {
  const accent = success ? '#a8c5e5' : '#fca5a5'
  const dot = success ? '#34d399' : '#f87171'
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} · Ayanami</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: radial-gradient(700px 420px at 50% -10%, rgba(135,156,181,.18), transparent 70%), #0f1115;
        color: #e5e9f0; font-family: 'Segoe UI', system-ui, sans-serif; padding: 24px;
      }
      .card {
        width: min(460px, 100%); border: 1px solid rgba(255,255,255,.08);
        background: #15181f; border-radius: 20px; padding: 34px 32px;
        box-shadow: 0 40px 100px -30px rgba(0,0,0,.95);
      }
      .mark {
        display: flex; align-items: center; gap: 10px; font-size: 11px;
        font-weight: 600; letter-spacing: .24em; text-transform: uppercase; color: #7b8798;
      }
      .dot { width: 7px; height: 7px; border-radius: 999px; background: ${dot}; box-shadow: 0 0 12px ${dot}; }
      h1 { margin: 22px 0 10px; font-size: 24px; letter-spacing: -.025em; color: #fff; }
      p { margin: 0; font-size: 14px; line-height: 1.7; color: #94a3b8; }
      .hint { margin-top: 26px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,.06); font-size: 12px; color: #64748b; }
      strong { color: ${accent}; font-weight: 600; }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="mark"><span class="dot"></span> Ayanami cloud saves</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <p class="hint">You can close this tab and return to <strong>Ayanami</strong>.</p>
    </main>
  </body>
</html>`
}

function profileFromIdToken(idToken: string | null | undefined): StoredAccount | null {
  if (!idToken) return null
  try {
    const payload = idToken.split('.')[1]
    if (!payload) return null
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: string
      name?: string
      picture?: string
    }
    return {
      email: decoded.email ?? null,
      name: decoded.name ?? null,
      picture: decoded.picture ?? null
    }
  } catch {
    return null
  }
}

function waitForServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

export class GoogleDriveAuth {
  private stored: StoredAuth | null
  private pendingConnect: Promise<DriveStatus> | null = null

  constructor(private readonly tokenPath: string) {
    this.stored = this.readStored()
  }

  get configured(): boolean {
    return hasEnv('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')
  }

  isConnected(): boolean {
    if (!this.configured || !hasUsableToken(this.stored)) return false
    return hasDriveFileScope(this.stored.scopes)
  }

  getStatus(): DriveStatus {
    const connected = this.isConnected()
    const account = connected ? this.stored?.account ?? null : null
    return {
      configured: this.configured,
      connected,
      accountEmail: account?.email ?? null,
      accountName: account?.name ?? null,
      accountAvatarUrl: account?.picture ?? null,
      connectedAt: connected ? this.stored?.connectedAt ?? null : null
    }
  }

  /**
   * Returns an OAuth2 client carrying persisted credentials. The renderer never
   * sees these tokens; all Drive work happens here in the main process.
   */
  getAuthorizedClient(): OAuth2Client {
    if (!this.configured) {
      throw new Error(
        'Google Drive is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart Ayanami.'
      )
    }
    const stored = this.stored
    if (!hasUsableToken(stored)) {
      throw new Error('Connect your Google Drive account in Settings before syncing saves.')
    }
    if (!hasDriveFileScope(stored.scopes)) {
      throw new Error(
        'Ayanami is connected to Google without Drive access. Reconnect in Settings and keep the Google Drive permission checked.'
      )
    }

    const client = this.createClient()
    client.setCredentials({ ...stored.tokens })

    client.on('tokens', (tokens) => {
      if (!this.stored) return
      this.stored = {
        ...this.stored,
        scopes: tokens.scope ? splitScopes(tokens.scope) : this.stored.scopes,
        tokens: {
          ...this.stored.tokens,
          ...tokens,
          refresh_token: tokens.refresh_token ?? this.stored.tokens.refresh_token
        }
      }
      try {
        this.persist()
      } catch (error) {
        console.warn('[drive] Could not persist refreshed Google credentials:', error)
      }
    })

    return client
  }

  async connect(): Promise<DriveStatus> {
    if (!this.configured) {
      throw new Error(
        'Google Drive is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart Ayanami.'
      )
    }
    if (this.pendingConnect) return this.pendingConnect

    const flow = this.runConnectFlow()
    this.pendingConnect = flow
    try {
      return await flow
    } finally {
      if (this.pendingConnect === flow) this.pendingConnect = null
    }
  }

  async disconnect(): Promise<DriveStatus> {
    const stored = this.stored
    this.stored = null

    try {
      rmSync(this.tokenPath, { force: true })
    } catch (error) {
      console.warn('[drive] Could not remove the stored Google credentials:', error)
    }

    if (stored?.tokens && this.configured) {
      const token = stored.tokens.refresh_token ?? stored.tokens.access_token
      if (token) {
        try {
          const client = this.createClient()
          client.setCredentials(stored.tokens)
          await Promise.race([
            client.revokeToken(token),
            new Promise<void>((resolve) => setTimeout(resolve, 6000))
          ])
        } catch (error) {
          // Local credentials are already gone; revocation is best effort.
          console.warn('[drive] Could not revoke the Google token:', error)
        }
      }
    }

    return this.getStatus()
  }

  private createClient(redirectUri?: string): OAuth2Client {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? ''
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? ''
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  }

  private async runConnectFlow(): Promise<DriveStatus> {
    const state = randomBytes(24).toString('hex')
    let settle: (result: AuthCallback) => void = () => undefined
    const callback = new Promise<AuthCallback>((resolve) => {
      let settled = false
      settle = (result): void => {
        if (settled) return
        settled = true
        resolve(result)
      }
    })

    const server = createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (requestUrl.pathname !== '/oauth2callback') {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('Not found')
          return
        }

        if (requestUrl.searchParams.get('state') !== state) {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end(
            callbackPage(
              'Sign-in could not be verified',
              'The authorization response did not match this Ayanami request. Please start sign-in again.',
              false
            )
          )
          settle({ error: 'Google sign-in could not be verified. Please try again.' })
          return
        }

        const error = requestUrl.searchParams.get('error')
        if (error) {
          const description = requestUrl.searchParams.get('error_description') ?? error
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end(
            callbackPage(
              error === 'access_denied' ? 'Sign-in canceled' : 'Google sign-in failed',
              error === 'access_denied'
                ? 'Ayanami was not granted access to your Google Drive.'
                : description,
              false
            )
          )
          settle({
            error:
              error === 'access_denied'
                ? 'Google sign-in was canceled.'
                : description || 'Google sign-in failed.'
          })
          return
        }

        const code = requestUrl.searchParams.get('code')
        if (!code) {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end(
            callbackPage(
              'Sign-in failed',
              'Google did not return an authorization code. Please try again.',
              false
            )
          )
          settle({ error: 'Google did not return an authorization code.' })
          return
        }

        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          callbackPage(
            'Google Drive connected',
            'Ayanami can now back up and restore your save files. Only files created by Ayanami are visible to it.',
            true
          )
        )
        settle({ code })
      } catch (error) {
        console.warn('[drive] OAuth callback failed:', error)
        try {
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end('Ayanami could not complete Google sign-in.')
        } catch {
          // The response may already have been sent.
        }
        settle({ error: 'Ayanami could not complete Google sign-in.' })
      }
    })

    const timeout = setTimeout(() => {
      settle({
        error: 'Google sign-in timed out. Start the sign-in again when you are ready.'
      })
    }, AUTH_TIMEOUT_MS)
    timeout.unref()

    let result: AuthCallback
    let redirectUri = ''
    try {
      await waitForServer(server)
      const address = server.address() as AddressInfo | null
      if (!address || typeof address === 'string') {
        throw new Error('Ayanami could not open a local sign-in listener.')
      }
      redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`

      const client = this.createClient(redirectUri)
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: true,
        scope: SCOPES,
        state
      })

      await shell.openExternal(authUrl)
      result = await callback
    } finally {
      clearTimeout(timeout)
      await closeServer(server)
    }

    if (result.error || !result.code) {
      throw new Error(result.error || 'Google sign-in failed.')
    }

    const client = this.createClient(redirectUri)
    let tokens: Credentials
    try {
      const tokenResponse = await client.getToken(result.code)
      tokens = tokenResponse.tokens
    } catch (error) {
      console.warn('[drive] Google token exchange failed:', error)
      throw new Error(
        'Google sign-in could not be completed. Check that the OAuth client in .env is a Desktop app and try again.'
      )
    }

    if (!tokens.access_token && !tokens.refresh_token) {
      throw new Error('Google did not return usable credentials. Please try signing in again.')
    }

    client.setCredentials(tokens)

    let scopes = splitScopes(tokens.scope)
    if (scopes.length === 0 && tokens.access_token) {
      try {
        const tokenInfo = await client.getTokenInfo(tokens.access_token)
        scopes = tokenInfo.scopes ?? []
      } catch (error) {
        console.warn('[drive] Could not verify the granted Google scopes:', error)
      }
    }
    if (!hasDriveFileScope(scopes)) {
      throw new Error(
        'Google sign-in completed without permission to manage Drive files. Sign in again and keep the Google Drive permission checked.'
      )
    }

    let account: StoredAccount | null = null
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: client })
      const profile = await oauth2.userinfo.get()
      account = {
        email: profile.data.email ?? null,
        name: profile.data.name ?? null,
        picture: profile.data.picture ?? null
      }
    } catch (error) {
      console.warn('[drive] Could not load the Google profile:', error)
      account = profileFromIdToken(tokens.id_token)
    }

    if (!account && tokens.id_token) account = profileFromIdToken(tokens.id_token)

    this.stored = {
      version: 1,
      tokens,
      scopes,
      account,
      connectedAt: new Date().toISOString()
    }

    try {
      this.persist()
    } catch (error) {
      this.stored = null
      console.warn('[drive] Could not persist Google credentials:', error)
      throw new Error(
        'Ayanami signed in, but could not save the Google credentials on this PC. Please try again.'
      )
    }

    return this.getStatus()
  }

  private readStored(): StoredAuth | null {
    if (!existsSync(this.tokenPath)) return null

    try {
      const persisted = JSON.parse(readFileSync(this.tokenPath, 'utf8')) as Partial<PersistedAuthFile>
      if (!persisted.payload) return null

      const json =
        persisted.encrypted && safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(persisted.payload, 'base64'))
          : persisted.payload
      const stored = JSON.parse(json) as Partial<StoredAuth>

      if (!stored.tokens || typeof stored.tokens !== 'object') return null

      const scopes = Array.isArray(stored.scopes)
        ? stored.scopes.filter((scope): scope is string => typeof scope === 'string')
        : splitScopes(stored.tokens.scope)

      return {
        version: 1,
        tokens: stored.tokens,
        scopes: [...new Set(scopes)],
        account: stored.account ?? null,
        connectedAt: stored.connectedAt ?? new Date().toISOString()
      }
    } catch (error) {
      console.warn('[drive] Could not read the stored Google credentials:', error)
      return null
    }
  }

  private persist(): void {
    if (!this.stored) return

    const json = JSON.stringify(this.stored)
    const encrypted = safeStorage.isEncryptionAvailable()
    const persisted: PersistedAuthFile = {
      version: 1,
      encrypted,
      payload: encrypted ? safeStorage.encryptString(json).toString('base64') : json
    }

    mkdirSync(dirname(this.tokenPath), { recursive: true })
    const temporaryPath = `${this.tokenPath}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(persisted), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, this.tokenPath)
  }
}
