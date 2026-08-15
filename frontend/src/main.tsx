import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './app/App'
import { ErrorBoundary } from './app/components/ErrorBoundary'
import { initErrorReporter } from './app/lib/errorReporter'

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
