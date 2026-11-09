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

  it('supports a web app on another site: partitioned SameSite=None cookie behind one proxy', () => {
    const env = validateEnv({ ...base, NODE_ENV: 'production', COOKIE_SAMESITE: 'none', COOKIE_PARTITIONED: 'true', TRUST_PROXY: '1' });
    expect(env).toMatchObject({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: true, COOKIE_PARTITIONED: true, TRUST_PROXY: 1 });
    expect(validateEnv(base)).toMatchObject({ COOKIE_PARTITIONED: false, TRUST_PROXY: 0 });
  });

  it('refuses SameSite=None without Secure, which browsers would silently drop', () => {
    expect(() => validateEnv({ ...base, COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
  });

  it('requires a database URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
});
