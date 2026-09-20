import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// partyserver imports `cloudflare:workers`, which only exists inside workerd.
// Unit tests run in Node, so they swap it for a minimal stub that lets the
// worker module load and a room be constructed with a mocked Durable Object
// context. The real runtime is exercised by the Playwright suite.
export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('./test/stubs/cloudflare-workers.ts', import.meta.url),
      ),
    },
  },
  test: {
    server: {
      deps: {
        // Inline partyserver so the alias above applies to its
        // `cloudflare:workers` import instead of handing it to Node.
        inline: ['partyserver'],
      },
    },
  },
})
