import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { totpCode, totpStep } from '../src/auth/totp.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const PASSWORD = 'Correct-Horse-42';

describe('Two-factor sign-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const email = `twofa-${run}@test.ledgernest.local`;
  let userId = '';
  let access = '';
  let secret = '';
  let recovery: string[] = [];

  const http = () => request(app.getHttpServer());
  const login = () =>
    http().post('/api/v1/auth/login').send({ email, password: PASSWORD });
  const second = (ticket: string, code: string) =>
    http().post('/api/v1/auth/login/2fa').send({ ticket, code });
  const as = () => ({
    get: (p: string) =>
      http().get(`/api/v1${p}`).set('Authorization', `Bearer ${access}`),
    post: (p: string, body: object = {}) =>
      http()
        .post(`/api/v1${p}`)
        .set('Authorization', `Bearer ${access}`)
        .send(body),
  });
  // A code for a later step than any used so far: each step works once
  let offset = 0;
  const fresh = () => totpCode(secret, totpStep() + Math.min(1, offset++));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    userId = (
      await prisma.user.create({
        data: {
          email,
          name: 'Meera',
          passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        },
      })
    ).id;
    access = (await login().expect(200)).body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  it('turns on with the password and a code from the app, and gives recovery codes once', async () => {
    expect((await as().get('/auth/2fa').expect(200)).body).toMatchObject({
      enabled: false,
    });
    expect(
      (await as().post('/auth/2fa/setup', { password: 'nope' }).expect(400))
        .body.details,
    ).toMatchObject({ reason: 'wrong_password' });
    const s = (
      await as().post('/auth/2fa/setup', { password: PASSWORD }).expect(200)
    ).body as { secret: string; uri: string };
    secret = s.secret;
    expect(s.uri).toBe(
      `otpauth://totp/LedgerNest%3A${encodeURIComponent(email)}?secret=${secret}&issuer=LedgerNest&algorithm=SHA1&digits=6&period=30`,
    );
    // Stored sealed, not as the secret itself
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.totpSecret).not.toContain(secret);
    await as().post('/auth/2fa/enable', { code: '000000' }).expect(400);
    recovery = (
      (await as().post('/auth/2fa/enable', { code: fresh() }).expect(200))
        .body as { recoveryCodes: string[] }
    ).recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await as().get('/auth/2fa').expect(200)).body).toMatchObject({
      enabled: true,
      recoveryCodesLeft: 10,
    });
  });

  it('asks for the code after the password, and won’t take the same code twice', async () => {
    const r = (await login().expect(200)).body as {
      twoFactorRequired: boolean;
      ticket: string;
      accessToken?: string;
    };
    expect(r.twoFactorRequired).toBe(true);
    expect(r.accessToken).toBeUndefined();
    // The ticket isn't an access token
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${r.ticket}`)
      .expect(401);
    expect(
      (await second(r.ticket, '123456').expect(401)).body.details,
    ).toMatchObject({ reason: 'wrong_code' });
    const code = fresh();
    const ok = await second(r.ticket, code).expect(200);
    expect(ok.body.accessToken).toEqual(expect.any(String));
    expect(ok.headers['set-cookie']?.[0]).toContain('HttpOnly');
    // Replayed
    await second(r.ticket, code).expect(401);
    await second('x'.repeat(40), fresh()).expect(401);
  });

  it('lets a recovery code in once', async () => {
    const { ticket } = (await login().expect(200)).body as { ticket: string };
    await second(ticket, recovery[0]!.toUpperCase()).expect(200);
    await second(ticket, recovery[0]!).expect(401);
    expect((await as().get('/auth/2fa').expect(200)).body).toMatchObject({
      recoveryCodesLeft: 9,
    });
    const fresh10 = (
      (
        await as()
          .post('/auth/2fa/recovery-codes', { code: recovery[1] })
          .expect(200)
      ).body as { recoveryCodes: string[] }
    ).recoveryCodes;
    expect(fresh10).toHaveLength(10);
    // The old ones are gone
    await second(ticket, recovery[2]!).expect(401);
    recovery = fresh10;
  });

  it('turns off with the password and a code, and sign-in is one step again', async () => {
    // Reset the lockout counter the wrong codes above built up
    await prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0 },
    });
    await as()
      .post('/auth/2fa/disable', { password: PASSWORD, code: '000000' })
      .expect(400);
    await as()
      .post('/auth/2fa/disable', { password: PASSWORD, code: recovery[0] })
      .expect(204);
    expect((await login().expect(200)).body.accessToken).toEqual(
      expect.any(String),
    );
    expect(
      await prisma.auditLog.count({
        where: {
          actorId: userId,
          action: { in: ['auth.2fa.enabled', 'auth.2fa.disabled'] },
        },
      }),
    ).toBe(2);
  });
});
