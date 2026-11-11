import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  complianceDueDates,
  gstinCheckChar,
  todayIn,
} from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';
import { GstReturnsService } from '../src/reports/gst-returns.service.js';

const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;
const SHARMA = gstin('27ABZPS6519M1Z');
const DELL = gstin('29AAACD4382A1Z');
const OURS = gstin('27AAPFN1234C1Z');

type Result = {
  gstin: string | null;
  period: string | null;
  otherGstin: boolean;
  skipped: number;
  summary: Record<string, { count: number; tax: number }>;
  rows: {
    status: string;
    supplierGstin: string;
    doc: { number: string } | null;
    bill: {
      id: string;
      number: string | null;
      vendorReference: string | null;
    } | null;
    diff: { taxable: number; tax: number } | null;
    problems: string[];
  }[];
};

describe('GSTR-2B reconciliation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const contact: Record<string, string> = {};
  let org = '';
  let gst18 = '';

  const http = () => request(app.getHttpServer());
  const as = (who = 'owner') => {
    const auth = (r: request.Test) =>
      r
        .set('Authorization', `Bearer ${users[who]}`)
        .set('X-Organization-Id', org);
    return {
      get: (p: string) => auth(http().get(`/api/v1${p}`)),
      post: (p: string, body: object = {}) =>
        auth(http().post(`/api/v1${p}`)).send(body),
    };
  };
  const bill = async (
    contactId: string,
    vendorReference: string,
    billDate: string,
    unitPrice: number,
    record = true,
  ) => {
    const b = (
      await as()
        .post('/bills', {
          contactId,
          vendorReference,
          billDate,
          lines: [
            {
              description: 'Supplies',
              quantity: 1,
              unitPrice,
              taxGroupId: gst18,
              accountId: acc.supplies,
            },
          ],
        })
        .expect(201)
    ).body as { id: string };
    if (record) await as().post(`/bills/${b.id}/record`).expect(200);
    return b.id;
  };
  // GSTR-2B as the portal downloads it, amounts in rupees
  const twoB = (gstinFor = OURS) =>
    JSON.stringify({
      chksum: 'abc',
      data: {
        gstin: gstinFor,
        rtnprd: '102026',
        docdata: {
          b2b: [
            {
              ctin: SHARMA,
              trdnm: 'SHARMA OFFICE SUPPLIES',
              inv: [
                {
                  inum: 'SOS/0042/26-27',
                  dt: '05-10-2026',
                  val: 11800,
                  pos: '27',
                  rev: 'N',
                  itcavl: 'Y',
                  items: [
                    { txval: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0 },
                  ],
                },
                {
                  inum: 'SOS/43/26-27',
                  dt: '12-10-2026',
                  val: 5900,
                  pos: '27',
                  rev: 'N',
                  itcavl: 'Y',
                  items: [
                    { txval: 5000, igst: 0, cgst: 450, sgst: 450, cess: 0 },
                  ],
                },
                {
                  inum: 'SOS/44/26-27',
                  dt: '20-10-2026',
                  val: 2360,
                  pos: '27',
                  rev: 'N',
                  itcavl: 'Y',
                  items: [
                    { txval: 2000, igst: 0, cgst: 180, sgst: 180, cess: 0 },
                  ],
                },
              ],
            },
            {
              ctin: DELL,
              trdnm: 'DELL TECHNOLOGIES INDIA',
              inv: [
                {
                  inum: 'DL-5501',
                  dt: '08-10-2026',
                  val: 70800,
                  pos: '27',
                  rev: 'N',
                  itcavl: 'Y',
                  items: [
                    { txval: 60000, igst: 10800, cgst: 0, sgst: 0, cess: 0 },
                  ],
                },
              ],
            },
          ],
        },
      },
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    org = (
      await prisma.organization.create({
        data: {
          name: `GSTR-2B ${run}`,
          slug: `gstr2b-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: OURS,
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['viewer', 'viewer'],
    ] as const) {
      const u = await prisma.user.create({
        data: {
          email: `${key}-${run}@test.ledgernest.local`,
          name: key,
          passwordHash: 'unused',
        },
      });
      await prisma.membership.create({
        data: { userId: u.id, organizationId: org, builtInRole: role },
      });
      users[key] = await jwt.signAsync(
        { sub: u.id, sa: false },
        { expiresIn: '15m' },
      );
    }
    for (const [key, body] of [
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      [
        'supplies',
        { code: '5400', type: 'expense', subtype: 'operating_expense' },
      ],
    ] as const) {
      acc[key] = (
        await as()
          .post('/accounts', { name: `${key} ${run}`, ...body })
          .expect(201)
      ).body.id;
    }
    await as().post('/fiscal-years', { startYear: 2026 }).expect(201);
    gst18 = (
      (await as().post('/taxes/gst-setup').expect(200)).body.groups as {
        id: string;
        name: string;
      }[]
    ).find((g) => g.name === 'GST 18%')!.id;
    for (const [key, body] of [
      [
        'sharma',
        {
          name: 'Sharma Office Supplies',
          isVendor: true,
          isCustomer: false,
          taxId: SHARMA,
        },
      ],
      [
        'dell',
        {
          name: 'Dell Technologies India',
          isVendor: true,
          isCustomer: false,
          taxId: DELL,
        },
      ],
    ] as const) {
      contact[key] = (await as().post('/contacts', body).expect(201)).body.id;
    }
    // Matches (number typed loosely), booked for less, Dell with a mistyped number, one not filed, a draft
    await bill(contact.sharma, 'sos-42/2627', '2026-10-05', 10_000_00);
    await bill(contact.sharma, 'SOS/43/26-27', '2026-10-12', 4_000_00);
    await bill(contact.dell, 'DL-5510', '2026-10-09', 60_000_00);
    await bill(contact.sharma, 'SOS/45/26-27', '2026-10-28', 1_000_00);
    await bill(contact.sharma, 'SOS/46/26-27', '2026-10-29', 500_00, false);
    // Outside the dates
    await bill(contact.sharma, 'SOS/40/26-27', '2026-09-28', 700_00);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  it('matches the portal’s invoices to recorded bills, worst first', async () => {
    const r = (
      await as('viewer')
        .post('/reports/gst/gstr-2b', {
          content: twoB(),
          from: '2026-10-01',
          to: '2026-10-31',
        })
        .expect(200)
    ).body as Result;
    expect(r).toMatchObject({
      gstin: OURS,
      period: '102026',
      otherGstin: false,
      skipped: 0,
    });
    const pick = (status: string) =>
      r.rows
        .filter((x) => x.status === status)
        .map((x) => x.doc?.number ?? x.bill!.vendorReference);
    expect(pick('matched')).toEqual(['SOS/0042/26-27']);
    expect(pick('mismatch')).toEqual(['SOS/43/26-27']);
    expect(pick('probable')).toEqual(['DL-5501']);
    expect(pick('missing_in_books')).toEqual(['SOS/44/26-27']);
    // The draft and September's bill aren't in the books for October
    expect(pick('missing_in_2b')).toEqual(['SOS/45/26-27']);
    expect(r.rows.find((x) => x.status === 'mismatch')).toMatchObject({
      diff: { taxable: 1_000_00, tax: 180_00 },
      problems: ['taxable', 'tax'],
      bill: { number: 'BILL/2026-27/0002' },
    });
    expect(r.summary).toMatchObject({
      matched: { count: 1, tax: 1_800_00 },
      probable: { count: 1, tax: 10_800_00 },
      missing_in_books: { count: 1, tax: 360_00 },
      missing_in_2b: { count: 1, tax: 180_00 },
    });
    expect(r.rows.map((x) => x.status)).toEqual([
      'mismatch',
      'missing_in_2b',
      'missing_in_books',
      'probable',
      'matched',
    ]);
  });

  it('matches on the date printed on the vendor’s bill, not the day it was entered', async () => {
    const draft = (
      await as()
        .post('/bills', {
          contactId: contact.sharma,
          vendorReference: 'SOS/50/26-27',
          vendorBillDate: '2026-10-21',
          billDate: '2026-10-24',
          lines: [
            {
              description: 'Toner',
              quantity: 1,
              unitPrice: 1_000_00,
              taxGroupId: gst18,
              accountId: acc.supplies,
            },
          ],
        })
        .expect(201)
    ).body as {
      id: string;
      vendorBillDate: string;
      billDate: string;
      dueDate: string;
    };
    // Payment terms run from the vendor's date
    expect(draft).toMatchObject({
      vendorBillDate: '2026-10-21',
      billDate: '2026-10-24',
      dueDate: '2026-11-20',
    });
    await as().post(`/bills/${draft.id}/record`).expect(200);
    const content = JSON.stringify({
      data: {
        gstin: OURS,
        rtnprd: '102026',
        docdata: {
          b2b: [
            {
              ctin: SHARMA,
              inv: [
                {
                  inum: 'SOS/50/26-27',
                  dt: '21-10-2026',
                  val: 1180,
                  pos: '27',
                  rev: 'N',
                  itcavl: 'Y',
                  items: [
                    { txval: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0 },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    const r = (
      await as()
        .post('/reports/gst/gstr-2b', {
          content,
          from: '2026-10-01',
          to: '2026-10-31',
        })
        .expect(200)
    ).body as Result;
    expect(r.rows.find((x) => x.doc?.number === 'SOS/50/26-27')).toMatchObject({
      status: 'matched',
      problems: [],
    });
    // A vendor's bill can't be dated after it's entered
    await as()
      .post('/bills', {
        contactId: contact.sharma,
        vendorReference: 'SOS/51/26-27',
        vendorBillDate: '2026-10-25',
        billDate: '2026-10-24',
        lines: [
          {
            description: 'x',
            quantity: 1,
            unitPrice: 100,
            accountId: acc.supplies,
          },
        ],
      })
      .expect(400);
  });

  it('says when the file is for another GSTIN, and turns away files that aren’t GSTR-2B', async () => {
    const other = (
      await as()
        .post('/reports/gst/gstr-2b', {
          content: twoB(gstin('29AAQFB7310K1Z')),
          from: '2026-10-01',
          to: '2026-10-31',
        })
        .expect(200)
    ).body as Result;
    expect(other.otherGstin).toBe(true);
    for (const [content, reason] of [
      ['not json at all', 'not_json'],
      ['{"data":{"gstin":"x"}}', 'not_gstr2b'],
    ])
      expect(
        (
          await as()
            .post('/reports/gst/gstr-2b', {
              content,
              from: '2026-10-01',
              to: '2026-10-31',
            })
            .expect(400)
        ).body.details,
      ).toMatchObject({ reason });
    await as()
      .post('/reports/gst/gstr-2b', {
        content: twoB(),
        from: '2026-10-31',
        to: '2026-10-01',
      })
      .expect(400);
  });

  it('takes large files, and needs a signed-in member', async () => {
    // About 1 MB of the portal's JSON
    const big = JSON.parse(twoB()) as {
      data: { docdata: { b2b: { inv: object[] }[] } };
    };
    const inv = big.data.docdata.b2b[0]!.inv[0]!;
    big.data.docdata.b2b[0]!.inv = Array.from({ length: 4000 }, (_, i) => ({
      ...inv,
      inum: `BULK/${i}`,
    }));
    const r = (
      await as()
        .post('/reports/gst/gstr-2b', {
          content: JSON.stringify(big),
          from: '2026-10-01',
          to: '2026-10-31',
        })
        .expect(200)
    ).body as Result;
    expect(r.summary.missing_in_books!.count).toBeGreaterThan(3990);
    // Signed out: refused
    await http()
      .post('/api/v1/reports/gst/gstr-2b')
      .set('X-Organization-Id', org)
      .send({ content: twoB(), from: '2026-10-01', to: '2026-10-31' })
      .expect(401);
  });

  it('lists the GST and advance-tax due dates coming up, with the GSTR-3B tax to pay', async () => {
    const r = (await as('viewer').get('/reports/compliance').expect(200))
      .body as {
      today: string;
      items: {
        kind: string;
        due: string;
        daysLeft: number;
        amount?: number;
      }[];
    };
    const today = todayIn('Asia/Kolkata');
    expect(r.today).toBe(today);
    expect(r.items.map((i) => [i.kind, i.due])).toEqual(
      complianceDueDates(today, { gst: true }).map((i) => [i.kind, i.due]),
    );
    for (const i of r.items) {
      expect(i.daysLeft).toBe(
        Math.round((Date.parse(i.due) - Date.parse(today)) / 86_400_000),
      );
      if (i.kind === 'gstr3b') expect(typeof i.amount).toBe('number');
      else expect(i.amount).toBeUndefined();
    }
    expect(r.items.some((i) => i.kind === 'gstr3b')).toBe(true);
  });

  it('says what filing a late GST return costs: the late fee, nil or not, and interest on the cash tax', async () => {
    const gst = app.get(GstReturnsService);
    type Item = {
      kind: string;
      from: string;
      daysLeft: number;
      amount?: number;
      lateFee?: number;
      interest?: number;
    };
    const at = async (iso: string) =>
      ((await gst.compliance(org, new Date(iso))).items as Item[]).filter(
        (i) => i.kind === 'gstr3b' || i.kind === 'gstr1',
      );
    // October had bills: GSTR-3B due 20 November, five days late on the 25th: ₹50 a day
    const nov = await at('2026-11-25T06:00:00Z');
    const oct3b = nov.find(
      (i) => i.kind === 'gstr3b' && i.from === '2026-10-01',
    )!;
    expect(oct3b).toMatchObject({ daysLeft: -5, lateFee: 250_00, interest: 0 });
    // Not due yet: nothing to pay
    for (const i of nov.filter((x) => x.daysLeft >= 0))
      expect(i.lateFee).toBeUndefined();
    // July had nothing: a nil return, ₹20 a day
    const aug = await at('2026-08-25T06:00:00Z');
    expect(
      aug.find((i) => i.kind === 'gstr3b' && i.from === '2026-07-01'),
    ).toMatchObject({
      daysLeft: -5,
      lateFee: 100_00,
    });
  });
});
