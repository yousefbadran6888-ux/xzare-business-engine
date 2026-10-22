import { ActivationGate } from '../../pos/src/ActivationGate'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from '../../pos/src/ErrorBoundary'
import '../../pos/src/style.css'
import '../../pos/src/interface.css'
import '../../accounting/src/accounting.css'
import './laboratory.css'
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ActivationGate>
      <App />
    </ActivationGate>
  </ErrorBoundary>,
)

