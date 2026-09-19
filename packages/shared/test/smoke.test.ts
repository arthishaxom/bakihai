import { describe, expect, it } from 'vitest'

describe('@bakihai/shared', () => {
  it('exposes an importable entry point', async () => {
    const shared = await import('../src/index')

    expect(shared).toBeDefined()
  })
})
