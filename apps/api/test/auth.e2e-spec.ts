import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import { BUILT_IN_ROLES, LOCKOUT } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const PASSWORD = 'Correct-Horse-42';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const createdUsers: string[] = [];
  const createdOrgs: string[] = [];

  const http = () => request(app.getHttpServer());

  async function makeUser(overrides: { status?: 'ACTIVE' | 'SUSPENDED'; isSuperAdmin?: boolean } = {}) {
    const user = await prisma.user.create({
      data: {
        email: `user-${randomUUID().slice(0, 8)}-${run}@test.ledgernest.local`,
        name: 'Test User',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        ...overrides,
      },
    });
    createdUsers.push(user.id);
    return user;
  }

  const login = (email: string, password = PASSWORD) => http().post('/api/v1/auth/login').send({ email, password });

  /** The raw `ln_refresh=...` pair from a response, ready to send back as a Cookie header. */
  function refreshCookie(res: request.Response) {
    const header = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ln_refresh='));
    if (!header) throw new Error('no refresh cookie set');
    return { pair: header.split(';')[0], header };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
    await app.close();
  });

  it('signs in, returns a short-lived access token and sets a locked-down refresh cookie', async () => {
    const user = await makeUser();
    const res = await login(user.email.toUpperCase()).expect(200); // emails are case-insensitive

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.expiresIn).toBe(15 * 60);
    expect(res.body).not.toHaveProperty('refreshToken'); // never exposed to JavaScript

    const { header } = refreshCookie(res);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Path=\/api\/v1\/auth/);
    expect(header).toMatch(/SameSite=Lax/i);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lastLoginAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'auth.login.success' } })).toBe(1);
  });

  it('stores only a hash of the refresh token', async () => {
    const user = await makeUser();
    const res = await login(user.email).expect(200);
    const raw = decodeURIComponent(refreshCookie(res).pair.split('=')[1]);
    const stored = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toBe(raw);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const user = await makeUser();
    const unknown = await login(`nobody-${run}@test.ledgernest.local`).expect(401);
    const wrong = await login(user.email, 'Wrong-Password-1').expect(401);
    expect(unknown.body.message).toBe(wrong.body.message);
    expect(unknown.body.message).toMatch(/^Email or password is incorrect./);
  });

  it('rejects malformed input with a 400 before touching the database', async () => {
    const res = await http().post('/api/v1/auth/login').send({ email: 'not-an-email', password: '' }).expect(400);
    expect(res.body.error).toBe('BAD_REQUEST');
    const fields = (res.body.details as { field: string }[]).map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it(`locks the account after ${LOCKOUT.maxFailedAttempts} wrong passwords, even for the right one`, async () => {
    const user = await makeUser();
    for (let i = 0; i < LOCKOUT.maxFailedAttempts; i++) await login(user.email, 'Wrong-Password-1').expect(401);

    // Locked, the right password gets the same answer as a wrong one, so nobody learns the account exists
    const locked = await login(user.email).expect(401);
    const unknown = await login(`nobody-${Date.now()}@test.ledgernest.local`).expect(401);
    expect(locked.body.message).toBe(unknown.body.message);
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'auth.lockout' } })).toBe(1);
  });

  it('refuses refresh and sign-out from another site, so nobody can force them on a visitor', async () => {
    await http().post('/api/v1/auth/refresh').set('Origin', 'https://evil.example').expect(403);
    await http().post('/api/v1/auth/logout').set('Origin', 'https://evil.example').expect(403);
    // The web app's own origin, or no Origin at all, goes through as before
    await http().post('/api/v1/auth/refresh').set('Origin', 'http://localhost:5173').expect(401);
    await http().post('/api/v1/auth/logout').expect(204);
  });

  it('a successful sign-in resets the failed-attempt counter', async () => {
    const user = await makeUser();
    await login(user.email, 'Wrong-Password-1').expect(401);
    await login(user.email, 'Wrong-Password-1').expect(401);
    await login(user.email).expect(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedLoginAttempts).toBe(0);
  });

  it('refuses suspended accounts with 403, but only after the password is correct', async () => {
    const user = await makeUser({ status: 'SUSPENDED' });
    await login(user.email, 'Wrong-Password-1').expect(401);
    const res = await login(user.email).expect(403);
    expect(res.body.message).toMatch(/suspended/);
  });

  it('GET /auth/me needs a valid access token', async () => {
    await http().get('/api/v1/auth/me').expect(401);
    await http().get('/api/v1/auth/me').set('Authorization', 'Bearer not.a.token').expect(401);
  });

  it('GET /auth/me returns the user with their organisations and permissions', async () => {
    const user = await makeUser();
    const org = await prisma.organization.create({ data: { name: `Acme ${run}`, slug: `acme-${run}` } });
    createdOrgs.push(org.id);
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, builtInRole: 'accountant' } });

    const { body: tokens } = await login(user.email).expect(200);
    const res = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${tokens.accessToken}`).expect(200);

    expect(res.body.user).toMatchObject({ id: user.id, email: user.email, isSuperAdmin: false });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.platformPermissions).toEqual([]);
    expect(res.body.organizations).toHaveLength(1);
    expect(res.body.organizations[0]).toMatchObject({ id: org.id, role: { type: 'built_in', key: 'accountant' } });
    expect(res.body.organizations[0].permissions).toEqual([...BUILT_IN_ROLES.accountant.permissions]);
  });

  it('gives a Super Admin the platform permissions', async () => {
    const user = await makeUser({ isSuperAdmin: true });
    const { body: tokens } = await login(user.email).expect(200);
    const res = await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${tokens.accessToken}`).expect(200);
    expect(res.body.user.isSuperAdmin).toBe(true);
    expect(res.body.platformPermissions.length).toBeGreaterThan(0);
    expect(res.body.platformPermissions.every((p: string) => p.startsWith('platform.'))).toBe(true);
  });

  it('refresh rotates the token, and reusing an old one signs out the whole session', async () => {
    const user = await makeUser();
    const first = refreshCookie(await login(user.email).expect(200));

    const rotated = await http().post('/api/v1/auth/refresh').set('Cookie', first.pair).expect(200);
    expect(rotated.body.accessToken).toEqual(expect.any(String));
    const second = refreshCookie(rotated);
    expect(second.pair).not.toBe(first.pair);

    // Someone replays the first (already used) token: treat it as stolen
    await http().post('/api/v1/auth/refresh').set('Cookie', first.pair).expect(401);
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'auth.refresh.reuse_detected' } })).toBe(1);

    // ...so even the legitimate newest token no longer works
    await http().post('/api/v1/auth/refresh').set('Cookie', second.pair).expect(401);
  });

  it('refresh without a cookie, or with an expired one, is refused', async () => {
    await http().post('/api/v1/auth/refresh').expect(401);

    const user = await makeUser();
    const cookie = refreshCookie(await login(user.email).expect(200));
    await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await http().post('/api/v1/auth/refresh').set('Cookie', cookie.pair).expect(401);
    expect(res.body.message).toMatch(/expired/);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const user = await makeUser();
    const cookie = refreshCookie(await login(user.email).expect(200));

    const res = await http().post('/api/v1/auth/logout').set('Cookie', cookie.pair).expect(204);
    expect(refreshCookie(res).header).toMatch(/Expires=Thu, 01 Jan 1970/);

    await http().post('/api/v1/auth/refresh').set('Cookie', cookie.pair).expect(401);
    // Logging out twice is harmless
    await http().post('/api/v1/auth/logout').set('Cookie', cookie.pair).expect(204);
  });
});
