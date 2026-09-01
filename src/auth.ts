import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { Config } from './config.js'
import type { Identity } from './domain/types.js'
import { errors } from './domain/errors.js'

function equalSecret(received: string, expected: string): boolean {
  const left = createHash('sha256').update(received).digest()
  const right = createHash('sha256').update(expected).digest()
  return timingSafeEqual(left, right)
}

function stringArray(payload: JWTPayload, key: string): string[] {
  const value = payload[key]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw errors.forbidden(`Delegation claim ${key} is invalid`)
  return value
}

export async function authenticate(req: Request, config: Config): Promise<Identity> {
  const gatewayKey = req.header('x-gateway-api-key') ?? ''
  if (!equalSecret(gatewayKey, config.GATEWAY_API_KEY)) throw errors.forbidden('Gateway authentication failed')
  const authorization = req.header('authorization')
  if (!authorization?.startsWith('Bearer ')) throw errors.forbidden('Signed user delegation is required')
  const token = authorization.slice('Bearer '.length)
  const verification = { issuer: config.DELEGATION_ISSUER, audience: config.DELEGATION_AUDIENCE, clockTolerance: 5 }
  const { payload } = config.DELEGATION_JWKS_URL
    ? await jwtVerify(token, createRemoteJWKSet(new URL(config.DELEGATION_JWKS_URL)), { ...verification, algorithms: ['RS256', 'ES256', 'EdDSA'] })
    : await jwtVerify(token, new TextEncoder().encode(config.DELEGATION_HS256_SECRET!), { ...verification, algorithms: ['HS256'] })
  const projectId = payload.project_id
  if (!payload.sub || typeof projectId !== 'string' || !payload.jti) throw errors.forbidden('Delegation identity is incomplete')
  const roles = stringArray(payload, 'roles')
  if (!config.TEST_OPERATOR_ENABLED && roles.includes('test_operator')) throw errors.forbidden('Test-operator capability is disabled')
  return { userId: payload.sub, projectId, tools: stringArray(payload, 'tools'), roles, requestId: payload.jti }
}
