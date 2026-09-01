import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const base = {
  DATABASE_URL: 'postgres://example', GATEWAY_API_KEY: '1234567890123456', DELEGATION_ISSUER: 'https://kbsandbox.tech',
  DELEGATION_HS256_SECRET: '12345678901234567890123456789012',
}

describe('configuration', () => {
  it('accepts a controlled local signing secret', () => {
    expect(loadConfig(base).DELEGATION_AUDIENCE).toBe('orderlunch-mcp')
  })
  it('requires a delegation verifier', () => {
    const { DELEGATION_HS256_SECRET: _, ...missing } = base
    expect(() => loadConfig(missing)).toThrow(/JWKS/)
  })
})
