import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import App from './App'
import { hydrateStoreFromUrl, startUrlSync, useAppStore } from './store'
import { ErrorBoundary } from './ui'

declare global {
  interface Window {
    /** Dev-only handle for debugging and browser tests. */
    __store?: typeof useAppStore
  }
}

hydrateStoreFromUrl()
startUrlSync()
if (import.meta.env.DEV) window.__store = useAppStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
