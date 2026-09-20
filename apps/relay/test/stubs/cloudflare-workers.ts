/**
 * Minimal stand-in for the `cloudflare:workers` module so Node unit tests can
 * import partyserver. It reproduces the only two exports the library uses.
 */
export const env = {}

export class DurableObject<Env = unknown> {
  protected readonly ctx: DurableObjectState
  protected readonly env: Env

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}
