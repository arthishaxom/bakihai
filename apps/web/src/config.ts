const PRODUCTION_RELAY_URL = 'https://relay.bakihai.apothal.dev'
const LOCAL_RELAY_URL = 'http://localhost:8790'

/**
 * The relay a newly created Group starts on. Deploys and the e2e build set
 * `VITE_RELAY_URL`; local development talks to `wrangler dev`. Joining devices
 * take the relay from the invite link instead, so this only matters when a
 * Group is created (ADR-0002).
 */
export function defaultRelayUrl(): string {
  const configured = import.meta.env.VITE_RELAY_URL

  if (typeof configured === 'string' && configured.length > 0) {
    return configured
  }

  return import.meta.env.DEV ? LOCAL_RELAY_URL : PRODUCTION_RELAY_URL
}
