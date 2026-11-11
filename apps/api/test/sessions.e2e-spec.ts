import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const PASSWORD = 'Correct-Horse-42';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

type Session = {
  id: string;
  current: boolean;
  ip: string | null;
  device: { browser: string | null; os: string | null; mobile: boolean };
};

describe('Active sessions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const email = `sessions-${run}@test.ledgernest.local`;
  let userId = '';

  const http = () => request(app.getHttpServer());
  const signIn = async (ua: string) => {
    const r = await http()
      .post('/api/v1/auth/login')
      .set('User-Agent', ua)
      .send({ email, password: PASSWORD })
      .expect(200);
    const cookie = (r.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!;
    return { access: r.body.accessToken as string, cookie };
  };

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
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  it('lists each device signed in, this one first, and signs another out', async () => {
    const laptop = await signIn(CHROME_WINDOWS);
    const phone = await signIn(SAFARI_IPHONE);
    const list = (
      await http()
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${laptop.access}`)
        .set('Cookie', laptop.cookie)
        .expect(200)
    ).body as Session[];
    expect(list.map((s) => [s.current, s.device])).toEqual([
      [true, { browser: 'Chrome', os: 'Windows', mobile: false }],
      [false, { browser: 'Safari', os: 'iPhone', mobile: true }],
    ]);
    // Refreshing keeps it one session
    await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', phone.cookie)
      .expect(200);
    const phoneId = list[1]!.id;
    await http()
      .delete(`/api/v1/auth/sessions/${phoneId}`)
      .set('Authorization', `Bearer ${laptop.access}`)
      .expect(204);
    await http()
      .delete(`/api/v1/auth/sessions/${phoneId}`)
      .set('Authorization', `Bearer ${laptop.access}`)
      .expect(404);
    expect(
      (
        await http()
          .get('/api/v1/auth/sessions')
          .set('Authorization', `Bearer ${laptop.access}`)
          .expect(200)
      ).body,
    ).toHaveLength(1);
  });

  it('won’t end someone else’s session', async () => {
    const other = await prisma.user.create({
      data: {
        email: `other-${run}@test.ledgernest.local`,
        name: 'Other',
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      },
    });
    const r = await http()
      .post('/api/v1/auth/login')
      .send({ email: other.email, password: PASSWORD })
      .expect(200);
    const theirs = (
      await http()
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${r.body.accessToken}`)
        .expect(200)
    ).body as Session[];
    const mine = await signIn(CHROME_WINDOWS);
    await http()
      .delete(`/api/v1/auth/sessions/${theirs[0]!.id}`)
      .set('Authorization', `Bearer ${mine.access}`)
      .expect(404);
    await prisma.user.delete({ where: { id: other.id } });
  });
});
