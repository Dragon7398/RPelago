import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { restoreOAuthReturnHash } from './contexts/oauthReturn'

// Must run before the first render: App() picks the #keep/ route from the hash
// once, so a sign-in started on the Keep has to have its hash back by now.
restoreOAuthReturnHash()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
