import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './app/App'
import { ErrorBoundary } from './app/components/ErrorBoundary'
import { initErrorReporter } from './app/lib/errorReporter'
import { redirectToCanonicalHost } from './app/lib/canonicalHost'

// Checkout UX 1 — settle on the canonical host first; true means this page is
// leaving, so nothing below runs.
if (!redirectToCanonicalHost()) {
  // Observability Foundation Part C — hook window.onerror/onunhandledrejection
  // before anything else runs, so nothing that happens during the initial
  // render is missed.
  initErrorReporter()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}
