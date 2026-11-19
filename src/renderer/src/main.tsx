import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const bridgeReady = typeof window.ayanami !== 'undefined'

if (!bridgeReady) {
  console.error('[renderer] The Ayanami preload bridge is unavailable. Restart the app.')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {bridgeReady ? (
      <App />
    ) : (
      <div className="flex h-full items-center justify-center bg-[#0f1115] px-6 text-center">
        <div className="max-w-md rounded-2xl border border-ayanami-line bg-ayanami-card p-8">
          <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-ayanami-accent">
            Connection error
          </p>
          <h1 className="mt-3 font-display text-xl font-semibold text-white">
            Ayanami could not reach its desktop bridge
          </h1>
          <p className="mt-3 text-[12px] leading-6 text-slate-400">
            Close Ayanami completely and start it again. Your library and settings are safe on
            this PC.
          </p>
        </div>
      </div>
    )}
  </StrictMode>
)
