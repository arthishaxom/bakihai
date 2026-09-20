import { registerSW } from 'virtual:pwa-register'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { router } from './router'
import './styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element #root not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

// Installability needs a registered service worker; autoUpdate keeps the shell
// fresh without a prompt while the book stays in IndexedDB (ADR-0001).
registerSW({ immediate: true })
