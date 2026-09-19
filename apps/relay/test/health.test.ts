import { describe, expect, it } from 'vitest'
import worker, { type Env } from '../src/index'

const env: Env = {}
const ctx = {} as ExecutionContext

describe('relay worker', () => {
  it('responds ok to GET /health', async () => {
    const response = await worker.fetch(new Request('https://relay.bakihai.test/health'), env, ctx)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'bakihai-relay' })
  })

  it('answers unknown routes with 404', async () => {
    const response = await worker.fetch(new Request('https://relay.bakihai.test/nope'), env, ctx)

    expect(response.status).toBe(404)
  })
})
