import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const PASSWORD = 'Correct-Horse-42';
const NEW_PASSWORD = 'Battery-Staple-77';

describe('Passwords: reset, change, sign out everywhere (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;
  const run = randomUUID().slice(0, 8);
  const created: string[] = [];

  const http = () => request(app.getHttpServer());
  const makeUser = async (status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') => {
    const u = await prisma.user.create({
      data: {
        email: `pw-${randomUUID().slice(0, 8)}-${run}@test.ledgernest.local`,
        name: 'Asha',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        status,
        failedLoginAttempts: 3,
      },
    });
    created.push(u.id);
    return u;
  };
  const login = (email: string, password = PASSWORD) =>
    http().post('/api/v1/auth/login').send({ email, password });
  const cookie = (res: request.Response) =>
    ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('ln_refresh='))!
      .split(';')[0]!;
  const refresh = (pair: string) =>
    http().post('/api/v1/auth/refresh').set('Cookie', pair);
  /** Asks for a link and reads the token out of the email */
  const resetLink = async (email: string) => {
    const send = vi.spyOn(mail, 'send');
    try {
      await http()
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(204);
      const text = send.mock.calls.at(-1)?.[0].text ?? '';
      return /reset-password\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? null;
    } finally {
      send.mockRestore();
    }
  };

  beforeAll(async () => {
    process.env.SMTP_URL = 'json';
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
  });

  afterAll(async () => {
    delete process.env.SMTP_URL;
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await app.close();
  });

  it('answers the same for unknown, suspended and real addresses, and only emails the real one', async () => {
    const send = vi.spyOn(mail, 'send');
    try {
      await http()
        .post('/api/v1/auth/forgot-password')
        .send({ email: `nobody-${run}@test.ledgernest.local` })
        .expect(204);
      const suspended = await makeUser('SUSPENDED');
      await http()
        .post('/api/v1/auth/forgot-password')
        .send({ email: suspended.email })
        .expect(204);
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
    const user = await makeUser();
    const token = await resetLink(user.email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only its hash is kept
    const row = await prisma.passwordReset.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(row.tokenHash).not.toContain(token!);
    await http()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not an email' })
      .expect(400);
  });

  it('sets a new password from the link once, clears the lockout and signs every device out', async () => {
    const user = await makeUser();
    const session = cookie(await login(user.email).expect(200));
    const token = (await resetLink(user.email))!;
    // Weak passwords are refused before the link is touched
    await http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'short' })
      .expect(400);
    await http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: NEW_PASSWORD })
      .expect(204);
    // The old session is gone, the old password too; the new one works
    await refresh(session).expect(401);
    await login(user.email).expect(401);
    await login(user.email, NEW_PASSWORD).expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .failedLoginAttempts,
    ).toBe(0);
    // Used up
    expect(
      (
        await http()
          .post('/api/v1/auth/reset-password')
          .send({ token, password: 'Another-Pass-99' })
          .expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'invalid_token' });
    expect(
      await prisma.auditLog.count({
        where: { actorId: user.id, action: 'auth.password.reset' },
      }),
    ).toBe(1);
  });

  it('refuses expired and made-up links, and a newer link leaves at most three working', async () => {
    const user = await makeUser();
    const token = (await resetLink(user.email))!;
    await prisma.passwordReset.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: NEW_PASSWORD })
      .expect(400);
    await http()
      .post('/api/v1/auth/reset-password')
      .send({ token: 'x'.repeat(43), password: NEW_PASSWORD })
      .expect(400);
    for (let i = 0; i < 4; i++) await resetLink(user.email);
    expect(
      await prisma.passwordReset.count({
        where: {
          userId: user.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
    ).toBe(3);
  });

  it('changes your own password after checking the current one, keeping this device signed in', async () => {
    const user = await makeUser();
    const other = cookie(await login(user.email).expect(200));
    const here = await login(user.email).expect(200);
    const pair = cookie(here);
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${here.body.accessToken as string}`)
        .set('Cookie', pair);
    expect(
      (
        await auth(http().post('/api/v1/auth/change-password'))
          .send({ currentPassword: 'Wrong-Pass-11', newPassword: NEW_PASSWORD })
          .expect(400)
      ).body.details,
    ).toMatchObject({ reason: 'wrong_password' });
    await auth(http().post('/api/v1/auth/change-password'))
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD })
      .expect(400);
    await auth(http().post('/api/v1/auth/change-password'))
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(204);
    // The other device is out; this one carries on
    await refresh(other).expect(401);
    const still = await refresh(pair).expect(200);
    // Sign out everywhere: this one too
    const everywhere = await http()
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${still.body.accessToken as string}`)
      .expect(200);
    expect(everywhere.body.sessions).toBeGreaterThanOrEqual(1);
    await refresh(cookie(still)).expect(401);
    await http().post('/api/v1/auth/change-password').send({}).expect(401);
  });
});
