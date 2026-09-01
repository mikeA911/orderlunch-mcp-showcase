import { z } from 'zod/v4'

const bool = z.enum(['true', 'false']).transform((value) => value === 'true')
const optionalUrl = z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional())
const optionalSecret = z.preprocess((value) => value === '' ? undefined : value, z.string().min(32).optional())

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: bool.default(false),
  LOG_LEVEL: z.string().default('info'),
  GATEWAY_API_KEY: z.string().min(16),
  DELEGATION_ISSUER: z.string().url(),
  DELEGATION_AUDIENCE: z.string().min(1).default('orderlunch-mcp'),
  DELEGATION_JWKS_URL: optionalUrl,
  DELEGATION_HS256_SECRET: optionalSecret,
  TEST_OPERATOR_ENABLED: bool.default(false),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`)
  if (!parsed.data.DELEGATION_JWKS_URL && !parsed.data.DELEGATION_HS256_SECRET) {
    throw new Error('Configure DELEGATION_JWKS_URL or DELEGATION_HS256_SECRET')
  }
  return parsed.data
}
