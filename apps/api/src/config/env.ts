import { z } from 'zod';

/** Every environment variable the API reads, validated at startup so misconfiguration fails fast. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').startsWith('postgres', 'DATABASE_URL must be a PostgreSQL URL'),
  /** Signs access tokens. Long random string; different per environment. */
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
    .refine((v) => !v.startsWith('replace-with'), 'JWT_ACCESS_SECRET is still the example value; generate your own'),
  /** Refresh cookie: Secure must be on in production (HTTPS). SameSite=none is needed when web and API are on different sites. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  /** Sign-in attempts allowed per IP per minute */
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  /** Where the web app lives; used to build links in invitations */
  WEB_APP_URL: z
    .url()
    .default('http://localhost:5173')
    .transform((v) => v.replace(/\/+$/, '')),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule: throws one readable error listing every problem. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
