import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { gstinCheckChar } from '@ledgernest/shared';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';
import { MailService } from '../src/mail/mail.service.js';

const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;

type DebitNote = {
  id: string;
  number: string;
  status: string;
  total: number;
  applied: number;
  remaining: number;
  vendorReference: string | null;
  journalEntry: { id: string };
  taxBreakdown: { name: string; amount: number }[];
  applications: { kind: string; amount: number }[];
};

describe('Debit notes to vendors (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const run = randomUUID().slice(0, 8);
  const users: Record<string, string> = {};
  const acc: Record<string, string> = {};
  let org = '';
  let gst18 = '';
  let sharma = '';
  let bill = { id: '', lines: [] as { id: string }[] };

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
  const record = async (lines: object[], billDate = '2026-10-05') => {
    const b = (
      await as()
        .post('/bills', {
          contactId: sharma,
          vendorReference: `SOS/${randomUUID().slice(0, 4)}`,
          billDate,
          lines,
        })
        .expect(201)
    ).body as { id: string; lines: { id: string }[] };
    await as().post(`/bills/${b.id}/record`).expect(200);
    // The lines as recorded
    return (await as().get(`/bills/${b.id}`).expect(200)).body as {
      id: string;
      lines: { id: string }[];
    };
  };
  const balanceOf = async (id: string) =>
    ((await as().get(`/bills/${id}`).expect(200)).body as { balance: number })
      .balance;
  const tb = async (accountId: string) => {
    const rows = (
      (await as().get('/reports/trial-balance?asOf=2026-10-31').expect(200))
        .body as {
        rows: {
          accountId: string;
          balanceDebit: number;
          balanceCredit: number;
        }[];
      }
    ).rows;
    const r = rows.find((x) => x.accountId === accountId);
    return r ? r.balanceDebit - r.balanceCredit : 0;
  };

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
          name: `Debit notes ${run}`,
          slug: `debit-notes-${run}`,
          country: 'IN',
          region: 'Maharashtra',
          fiscalYearStartMonth: 4,
          taxId: gstin('27AAPFN1234C1Z'),
        },
      })
    ).id;
    for (const [key, role] of [
      ['owner', 'owner'],
      ['auditor', 'auditor'],
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
      ['bank', { code: '1100', type: 'asset', subtype: 'bank' }],
      [
        'creditors',
        { code: '2000', type: 'liability', subtype: 'accounts_payable' },
      ],
      [
        'furniture',
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
    sharma = (
      await as()
        .post('/contacts', {
          name: 'Sharma Office Supplies',
          isVendor: true,
          isCustomer: false,
          taxId: gstin('27ABZPS6519M1Z'),
        })
        .expect(201)
    ).body.id;
    // Four chairs at ₹5,000 and two lamps at ₹1,000, GST 18%: ₹25,960
    bill = await record([
      {
        description: 'Office chair',
        quantity: 4,
        unitPrice: 5_000_00,
        taxGroupId: gst18,
        accountId: acc.furniture,
      },
      {
        description: 'Desk lamp',
        quantity: 2,
        unitPrice: 1_000_00,
        taxGroupId: gst18,
        accountId: acc.furniture,
      },
    ]);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: org } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${run}@test.ledgernest.local` } },
    });
    await app.close();
  });

  let chair: DebitNote;

  it('sends a chair back: the bill owes less, the expense and its input GST come down', async () => {
    expect(
      (
        await as().get(`/debit-notes/creditable/${bill.id}`).expect(200)
      ).body.map((l: { quantity: string }) => l.quantity),
    ).toEqual(['4', '2']);
    const furnitureBefore = await tb(acc.furniture);
    chair = (
      await as()
        .post('/debit-notes', {
          billId: bill.id,
          date: '2026-10-12',
          vendorReference: 'SOS-CN-7',
          reason: 'One chair arrived broken',
          lines: [{ billLineId: bill.lines[0]!.id, quantity: '1' }],
        })
        .expect(201)
    ).body as DebitNote;
    expect(chair).toMatchObject({
      number: 'DN/2026-27/0001',
      status: 'issued',
      total: 5_900_00,
      applied: 5_900_00,
      remaining: 0,
      vendorReference: 'SOS-CN-7',
    });
    expect(chair.taxBreakdown.map((t) => [t.name, t.amount])).toEqual([
      ['CGST 9%', 450_00],
      ['SGST 9%', 450_00],
    ]);
    expect(await balanceOf(bill.id)).toBe(25_960_00 - 5_900_00);
    expect((await tb(acc.furniture)) - furnitureBefore).toBe(-5_000_00);
    // Only three chairs are left to send back
    expect(
      (
        await as()
          .post('/debit-notes', {
            billId: bill.id,
            date: '2026-10-12',
            lines: [{ billLineId: bill.lines[0]!.id, quantity: '4' }],
          })
          .expect(409)
      ).body.details,
    ).toMatchObject({ reason: 'over_credited', left: '3' });
    // Not before the bill, and not by an auditor
    await as()
      .post('/debit-notes', {
        billId: bill.id,
        date: '2026-10-01',
        lines: [{ billLineId: bill.lines[1]!.id, quantity: '1' }],
      })
      .expect(400);
    await as('auditor')
      .post('/debit-notes', {
        billId: bill.id,
        date: '2026-10-12',
        lines: [{ billLineId: bill.lines[1]!.id, quantity: '1' }],
      })
      .expect(403);
    // The bill lists it
    const b = (await as().get(`/bills/${bill.id}`).expect(200)).body as {
      debitNotes: { number: string }[];
      credits: { amount: number }[];
    };
    expect(b.debitNotes.map((n) => n.number)).toEqual(['DN/2026-27/0001']);
    expect(b.credits.map((c) => c.amount)).toEqual([5_900_00]);
  });

  let lamps: DebitNote;

  it('gives the vendor the debit note as a PDF, against their own bill number', async () => {
    const r = await as()
      .get(`/debit-notes/${chair.id}/pdf`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(r.headers['content-disposition']).toContain(
      'debit-note-dn-2026-27-0001.pdf',
    );
    const text = (r.body as Buffer).toString('latin1');
    expect(text).toContain('(Debit note DN/2026-27/0001) Tj');
    expect(text).toMatch(
      /\(Date 2026-10-12 · Against your bill SOS\/[0-9a-f]{4} dated 2026-10-05 · Your credit note SOS-CN-7\) Tj/,
    );
    expect(text).toContain('(Reason: One chair arrived broken) Tj');
    expect(text).toContain(
      '(Amount in words: Indian Rupees Five Thousand Nine Hundred Only) Tj',
    );
    expect(text).toContain('(Authorised signatory) Tj');
  });

  it('emails the debit note to the vendor as a PDF', async () => {
    process.env.SMTP_URL = 'json';
    try {
      expect(
        (await as().post(`/debit-notes/${chair.id}/email`, {}).expect(400)).body
          .details,
      ).toMatchObject({ reason: 'no_email' });
      await as()
        .post(`/debit-notes/${chair.id}/email`, {
          email: 'billing@sharma.example',
        })
        .expect(200);
      expect(app.get(MailService).captured.at(-1)).toMatchObject({
        to: ['billing@sharma.example'],
        attachments: ['debit-note-dn-2026-27-0001.pdf'],
      });
      expect(app.get(MailService).capturedText.at(-1)).toMatch(
        /against your bill SOS\/[0-9a-f]{4}/,
      );
    } finally {
      delete process.env.SMTP_URL;
    }
  });

  it('keeps credit with the vendor once the bill is paid, then puts it on another bill and takes a refund', async () => {
    await as()
      .post('/payments/payments', {
        contactId: sharma,
        date: '2026-10-15',
        bankAccountId: acc.bank,
        amount: 20_060_00,
        allocations: [{ billId: bill.id, amount: 20_060_00 }],
      })
      .expect(201);
    lamps = (
      await as()
        .post('/debit-notes', {
          billId: bill.id,
          date: '2026-10-18',
          lines: [{ billLineId: bill.lines[1]!.id, quantity: '2' }],
        })
        .expect(201)
    ).body as DebitNote;
    expect(lamps).toMatchObject({
      total: 2_360_00,
      applied: 0,
      remaining: 2_360_00,
    });
    const next = await record(
      [
        {
          description: 'Filing cabinet',
          quantity: 1,
          unitPrice: 8_000_00,
          accountId: acc.furniture,
        },
      ],
      '2026-10-20',
    );
    lamps = (
      await as()
        .post(`/debit-notes/${lamps.id}/apply`, {
          billId: next.id,
          amount: 1_000_00,
          date: '2026-10-20',
        })
        .expect(200)
    ).body as DebitNote;
    expect(await balanceOf(next.id)).toBe(7_000_00);
    const bankBefore = await tb(acc.bank);
    lamps = (
      await as()
        .post(`/debit-notes/${lamps.id}/refund`, {
          date: '2026-10-25',
          bankAccountId: acc.bank,
          amount: 1_360_00,
          reference: 'NEFT from Sharma',
        })
        .expect(200)
    ).body as DebitNote;
    expect(lamps).toMatchObject({ remaining: 0 });
    expect(lamps.applications.map((a) => [a.kind, a.amount])).toEqual([
      ['bill', 1_000_00],
      ['refund', 1_360_00],
    ]);
    expect((await tb(acc.bank)) - bankBefore).toBe(1_360_00);
    await as()
      .post(`/debit-notes/${lamps.id}/refund`, {
        date: '2026-10-25',
        bankAccountId: acc.bank,
        amount: 1_00,
      })
      .expect(409);
  });

  it('shows in payables aging and the vendor’s statement, and takes the input GST off GSTR-3B', async () => {
    const aging = (
      await as().get('/reports/aging?side=payables&asOf=2026-10-31').expect(200)
    ).body as { contacts: { total: number; advance: number }[] };
    // The cabinet bill, less the credit put on it
    expect(aging.contacts).toEqual([
      expect.objectContaining({ total: 7_000_00, advance: 0 }),
    ]);
    const statement = (
      await as()
        .get(
          `/reports/statement?contactId=${sharma}&side=payables&from=2026-10-01&to=2026-10-31`,
        )
        .expect(200)
    ).body as {
      sections: {
        closing: number;
        lines: { kind: string; number: string }[];
      }[];
    };
    const kinds = statement.sections[0]!.lines.map((l) => l.kind);
    expect(kinds.filter((k) => k === 'debit_note')).toHaveLength(2);
    expect(kinds).toContain('refund');
    expect(statement.sections[0]!.closing).toBe(7_000_00);
    const g = (
      await as()
        .get('/reports/gst/gstr-3b?from=2026-10-01&to=2026-10-31')
        .expect(200)
    ).body as { itc: { cgst: number; sgst: number } };
    // Bill ₹1,980 each of CGST and SGST, less ₹450 + ₹180 on the debit notes
    expect(g.itc).toMatchObject({ cgst: 1_350_00, sgst: 1_350_00 });
  });

  it('matches the supplier’s credit note in GSTR-2B to the debit note, and flags one not in the books', async () => {
    const credit = (ntnum: string, txval: number) => ({
      ntnum,
      typ: 'C',
      dt: '12-10-2026',
      val: txval * 1.18,
      rev: 'N',
      itcavl: 'Y',
      items: [
        { txval, igst: 0, cgst: txval * 0.09, sgst: txval * 0.09, cess: 0 },
      ],
    });
    const r = (
      await as()
        .post('/reports/gst/gstr-2b', {
          from: '2026-10-01',
          to: '2026-10-31',
          content: JSON.stringify({
            data: {
              gstin: gstin('27AAPFN1234C1Z'),
              rtnprd: '102026',
              docdata: {
                cdnr: [
                  {
                    ctin: gstin('27ABZPS6519M1Z'),
                    trdnm: 'SHARMA OFFICE SUPPLIES',
                    nt: [credit('SOS/CN/7', 5000), credit('SOS-CN-9', 800)],
                  },
                ],
              },
            },
          }),
        })
        .expect(200)
    ).body as {
      rows: {
        status: string;
        doc: { number: string } | null;
        bill: { kind?: string; number: string | null } | null;
      }[];
    };
    const row = (n: string) => r.rows.find((x) => x.doc?.number === n)!;
    expect(row('SOS/CN/7')).toMatchObject({
      status: 'matched',
      bill: { kind: 'debit_note', number: 'DN/2026-27/0001' },
    });
    // Their credit note with no debit note here: input credit to give back
    expect(row('SOS-CN-9')).toMatchObject({
      status: 'missing_in_books',
      bill: null,
    });
  });

  it('voids a debit note the vendor hasn’t refunded, and keeps its entry from being reversed by hand', async () => {
    await as()
      .post(`/journals/${chair.journalEntry.id}/reverse`, {})
      .expect(409);
    expect(
      (await as().post(`/debit-notes/${lamps.id}/void`, {}).expect(409)).body
        .details,
    ).toMatchObject({ reason: 'has_refunds' });
    const before = await balanceOf(bill.id);
    const v = (
      await as()
        .post(`/debit-notes/${chair.id}/void`, { reason: 'Chair was fine' })
        .expect(200)
    ).body as DebitNote;
    expect(v).toMatchObject({ status: 'void', remaining: 0 });
    expect((await balanceOf(bill.id)) - before).toBe(5_900_00);
    const list = (
      await as().get(`/debit-notes?contactId=${sharma}`).expect(200)
    ).body as { total: number; items: { number: string }[] };
    expect(list.items.map((i) => i.number)).toEqual([
      'DN/2026-27/0002',
      'DN/2026-27/0001',
    ]);
    const actions = await prisma.auditLog.findMany({
      where: { organizationId: org, entityType: 'vendor_credit' },
      select: { action: true },
    });
    expect(new Set(actions.map((a) => a.action))).toEqual(
      new Set([
        'org.vendor_credit.issue',
        'org.vendor_credit.apply',
        'org.vendor_credit.refund',
        'org.vendor_credit.void',
        'org.debit_note.email',
      ]),
    );
  });
});
