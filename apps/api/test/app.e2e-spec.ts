import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/setup-app.js';

// Runs the real HTTP stack against the test database (DATABASE_URL points at ledgernest_test)
describe('API foundation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health reports the API and database as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('unknown routes return the standard error format with a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').set('X-Request-Id', 'test-req-0001').expect(404);
    expect(res.headers['x-request-id']).toBe('test-req-0001');
    expect(res.body).toMatchObject({ statusCode: 404, error: 'NOT_FOUND', path: '/api/v1/does-not-exist', requestId: 'test-req-0001' });
    expect(res.body.timestamp).toBeDefined();
  });

  it('sends security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows the configured web origin and refuses others', async () => {
    const ok = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('publishes OpenAPI docs', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(res.body.info.title).toBe('LedgerNest API');
    expect(Object.keys(res.body.paths)).toContain('/api/v1/health');
  });
});
