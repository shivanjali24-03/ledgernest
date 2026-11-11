import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { gstinCheckChar } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;

describe('Contact persons, addresses and defaults (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let token = '';
  let org = '';

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org);
  const post = (p: string, body: object = {}) =>
    auth(http().post(`/api/v1${p}`)).send(body);
  const contact = (body: object) =>
    post('/contacts', { isCustomer: true, isVendor: true, ...body });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    org = (
      await prisma.organization.create({
        data: {
          name: `PERS ${run}`,
          slug: `pers-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: gstin('27AAPFN1234C1Z'),
          addressLine1: 'Plot 4, Chakan MIDC',
          city: 'Pune',
          postalCode: '410501',
        },
      })
    ).id;
    const u = await prisma.user.create({
      data: {
        email: `owner-${run}@test.ledgernest.local`,
        name: 'Owner',
        passwordHash: 'unused',
      },
    });
    await prisma.membership.create({
      data: { userId: u.id, organizationId: org, builtInRole: 'owner' },
    });
    token = await app
      .get(JwtService)
      .signAsync({ sub: u.id, sa: false }, { expiresIn: '15m' });
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('keeps the people, a WhatsApp number, delivery addresses and a TDS section', async () => {
    const c = (
      await contact({
        name: 'Deccan Builders',
        whatsapp: '+91 98220 11111',
        tdsSection: '194C',
        persons: [
          {
            name: 'Priya Joshi',
            designation: 'Accounts',
            email: 'priya@deccan.example',
            phone: '020 4000 1111',
            primary: true,
          },
          { name: 'Ravi Kale', whatsapp: '9822022222' },
        ],
        shipAddresses: [
          {
            label: 'Chakan site',
            line1: 'Plot 7, MIDC',
            city: 'Chakan',
            region: 'Maharashtra',
            postalCode: '410501',
            country: 'IN',
          },
        ],
      }).expect(201)
    ).body as {
      id: string;
      whatsapp: string;
      tdsSection: string;
      persons: { name: string; primary: boolean }[];
      shipAddresses: { label: string; city: string }[];
    };
    expect(c).toMatchObject({
      whatsapp: '+91 98220 11111',
      tdsSection: '194C',
    });
    expect(c.persons.map((p) => [p.name, p.primary])).toEqual([
      ['Priya Joshi', true],
      ['Ravi Kale', false],
    ]);
    expect(c.shipAddresses[0]).toMatchObject({
      label: 'Chakan site',
      city: 'Chakan',
    });
    const u = (
      await auth(http().patch(`/api/v1/contacts/${c.id}`))
        .send({ persons: [], tdsSection: null })
        .expect(200)
    ).body as { persons: unknown[]; tdsSection: string | null };
    expect(u).toMatchObject({ persons: [], tdsSection: null });
  });

  it('refuses two main contacts, an unknown TDS section, and an unnamed address', async () => {
    const fields = async (body: object) =>
      (
        (
          await contact({
            name: `X ${randomUUID().slice(0, 4)}`,
            ...body,
          }).expect(400)
        ).body as { details: { field: string }[] }
      ).details.map((d) => d.field);
    expect(
      await fields({
        persons: [
          { name: 'One', primary: true },
          { name: 'Two', primary: true },
        ],
      }),
    ).toContain('persons');
    expect(await fields({ tdsSection: '999Z' })).toContain('tdsSection');
    expect(
      await fields({ shipAddresses: [{ label: '', city: 'Pune' }] }),
    ).toContain('shipAddresses.0.label');
  });
});
