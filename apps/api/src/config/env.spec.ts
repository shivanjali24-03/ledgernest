import { validateEnv } from './env.js';

describe('validateEnv', () => {
  const base = { DATABASE_URL: 'postgresql://u@localhost:5432/db', JWT_ACCESS_SECRET: 'x'.repeat(32) };

  it('applies safe defaults', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({ NODE_ENV: 'development', PORT: 3000, CORS_ORIGINS: ['http://localhost:5173'] });
  });

  it('parses a comma-separated CORS list and a numeric port', () => {
    const env = validateEnv({ ...base, PORT: '8080', CORS_ORIGINS: 'https://a.app, https://b.app' });
    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['https://a.app', 'https://b.app']);
  });

  it('reports every problem in one readable error', () => {
    const run = () => validateEnv({ DATABASE_URL: 'mysql://x', PORT: 'abc' });
    expect(run).toThrow(/DATABASE_URL must be a PostgreSQL URL/);
    expect(run).toThrow(/PORT/);
  });

  it('rejects a short JWT secret and defaults to secure cookies', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'replace-with-a-long-random-string-of-48-plus-chars' })).toThrow(/example value/);
    expect(validateEnv(base)).toMatchObject({ COOKIE_SECURE: true, COOKIE_SAMESITE: 'lax', LOGIN_RATE_LIMIT: 10 });
  });

  it('requires a database URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
});
