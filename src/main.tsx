import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { initViewportHeightVar } from './viewportHeight.ts'

initViewportHeightVar()

// Chats live entirely in IndexedDB on this device. Ask the browser to treat
// that storage as persistent so it isn't evicted under disk pressure - a
// refresh or restart never drops it, only a manual "clear site data" does.
void navigator.storage?.persist?.()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
