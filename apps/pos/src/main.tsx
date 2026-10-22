import { ActivationGate } from './ActivationGate'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './style.css'
import './interface.css'
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ActivationGate>
      <App />
    </ActivationGate>
  </ErrorBoundary>,
)

