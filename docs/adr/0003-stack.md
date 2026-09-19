# Stack: TypeScript, React + Vite PWA, Yjs sync, Cloudflare relay

The app is a static TypeScript PWA (React 19, Vite, TanStack Router); sync uses Yjs with y-partyserver on Cloudflare Durable Objects (hibernating WebSockets) and y-indexeddb for local persistence; validation uses Zod; crypto uses WebCrypto (HKDF, AES-GCM, Ed25519); UI uses Tailwind CSS with shadcn/ui on Base UI; the repo is a pnpm workspace of `apps/web`, `apps/relay`, and `packages/shared`.

## Considered Options

- **Evolu** — E2E-encrypted SQLite sync with a stateless relay; the closest alternative, but a younger ecosystem with its own API. Kept as runner-up.
- **Automerge, Loro** — heavier WASM and thinner server tooling for this use case.
- **Next.js / SvelteKit** — server-side rendering is irrelevant for an offline-first client and adds complexity.

## Consequences

`vite-plugin-pwa` / Workbox is in maintenance mode; a future migration to `@vite-pwa/core` or Serwist will be needed.
