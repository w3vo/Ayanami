import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import dotenv from 'dotenv'

let loaded = false

/**
 * Loads local secrets from the project .env in development, from beside the
 * packaged app resources when one is present, and from the per-user data
 * folder (%APPDATA%\ayanami\.env) so installed copies can be configured
 * without rebuilding. Missing files are fine — every integration has a
 * graceful fallback.
 */
export function loadEnvironment(): void {
  if (loaded) return
  loaded = true

  const candidates = [
    app.isPackaged ? join(process.resourcesPath, '.env') : join(process.cwd(), '.env'),
    // Installed builds have no writable .env beside the app, so let users add
    // their own keys in the per-user data folder without a rebuilt installer.
    join(app.getPath('userData'), '.env'),
    join(app.getAppPath(), '.env')
  ]

  for (const path of [...new Set(candidates)]) {
    if (!existsSync(path)) continue
    dotenv.config({ path, override: false, quiet: true })
  }
}

export function hasEnv(...keys: string[]): boolean {
  return keys.every((key) => Boolean(process.env[key]?.trim()))
}
