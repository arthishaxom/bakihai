import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const root = fileURLToPath(new URL('.', import.meta.url))

// The sync harness is test-only: it is built as an extra entry point only for
// the Playwright suite (`VITE_E2E=1`), never for a deploy.
const e2e = process.env.VITE_E2E === '1'

// The shell's precache. vite-plugin-pwa adds the web manifest entry itself, and
// when the harness is built it stays out of the worker: its pages carry query
// parameters the navigation fallback would swallow, so they reach the network
// like any other test page.
const workbox = {
  globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
  navigateFallback: '/index.html',
  ...(e2e
    ? {
        globIgnores: ['**/e2e/**', '**/harness-*.js'],
        navigateFallbackDenylist: [/^\/e2e\//],
      }
    : {}),
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A deploy installs the new shell silently; the book is never part of the
      // worker's precache, so an update replaces every cached byte without
      // touching IndexedDB (ADR-0001, ADR-0003).
      registerType: 'autoUpdate',
      manifest: {
        name: 'BakiHai',
        short_name: 'BakiHai',
        description: 'A shared book for who owes what.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#1b2130',
        theme_color: '#1b2130',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox,
      // globPatterns already carries every manifest icon; the plugin's own icon
      // injection would list each of them twice.
      includeManifestIcons: false,
    }),
  ],
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
