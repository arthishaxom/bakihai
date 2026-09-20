import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

// The sync harness is test-only: it is built as an extra entry point only for
// the Playwright suite (`VITE_E2E=1`), never for a deploy.
const e2e = process.env.VITE_E2E === '1'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  ...(e2e
    ? {
        build: {
          rollupOptions: {
            input: {
              index: `${root}index.html`,
              harness: `${root}e2e/harness/harness.html`,
            },
          },
        },
      }
    : {}),
})
