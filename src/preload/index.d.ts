import type { AyanamiAPI } from '../shared/api'

declare global {
  interface Window {
    ayanami: AyanamiAPI
  }
}

export {}
