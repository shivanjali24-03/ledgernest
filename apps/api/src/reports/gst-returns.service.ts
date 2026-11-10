import { BadRequestException, Injectable } from '@nestjs/common';
import {
  B2CL_THRESHOLD,
  billNumber,
  vendorCreditNumber,
  complianceDueDates,
  tdsDepositDue,
  type ComplianceItem,
  todayIn,
  creditNoteNumber,
  currencyDigits,
  findIndianState,
  gstSetOff,
  invoiceNumber,
  isGstin,
  parseQuantity,
  formatQuantity,
  Gstr2bError,
  parseGstr2b,
  reconcileGstr2b,
  splitTax,
  toBase,
  zeroHeads,
  type GstHeads,
  type Gstr2bBill,
} from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { TdsReportService } from './tds-report.service.js';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const head = (kind: string): keyof GstHeads | null =>
  kind === 'igst'
    ? 'igst'
    : kind === 'cgst'
      ? 'cgst'
      : kind === 'sgst' || kind === 'utgst'
        ? 'sgst'
        : kind === 'cess'
          ? 'cess'
          : null;
const add = (a: GstHeads, b: GstHeads, sign = 1) => {
  a.igst += sign * b.igst;
  a.cgst += sign * b.cgst;
  a.sgst += sign * b.sgst;
  a.cess += sign * b.cess;
};
type Rates = { rate: { id: string; kind: string; ratePpm: number } }[];

/**
 * GST returns for India, for a month or quarter. GSTR-3B comes from the books (tax posted on sales and
 * purchases, so credit notes and corrections count), with input credit set off the way the law orders it.
 * GSTR-1 comes from the documents: invoices and credit notes by customer GSTIN, unregistered buyers by state
 * and rate, exports, and an HSN summary.
 */
@Injectable()
export class GstReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tds: TdsReportService,
  ) {}

  private async india(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        country: true,
        region: true,
        taxId: true,
        baseCurrency: true,
        legalName: true,
        name: true,
      },
    });
    if (org.country !== 'IN')
      throw new BadRequestException({
        message: 'GST returns are for organisations in India.',
        details: { reason: 'not_india' },
      });
    return { ...org, stateCode: findIndianState(org.region)?.code ?? null };
  }

  async gstr3b(organizationId: string, from: string, to: string) {
    const org = await this.india(organizationId);
    const range = [asDate(from), asDate(to)] as const;
    const [taxes, values] = await Promise.all([
      this.prisma.$queryRaw<
        { kind: string; role: 'input' | 'output'; cr: bigint }[]
      >`
        SELECT r.kind, CASE WHEN a.type IN ('asset', 'expense') THEN 'input' ELSE 'output' END AS role, sum(t.credit - t.debit)::bigint AS cr
        FROM journal_lines t
        JOIN journal_entries e ON e.id = t.entry_id
        JOIN tax_rates r ON r.id = t.tax_rate_id
        JOIN journal_lines s ON s.entry_id = t.entry_id AND s.line_no = t.tax_source_line
        JOIN accounts a ON a.id = s.account_id
        WHERE t.organization_id = ${organizationId}::uuid AND e.status = 'posted' AND e.date BETWEEN ${range[0]}::date AND ${range[1]}::date
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<
        {
          taxed_out: bigint | null;
          untaxed_out: bigint | null;
          taxed_in: bigint | null;
        }[]
      >`
        SELECT sum(CASE WHEN l.tax_group_id IS NOT NULL AND a.type IN ('income', 'liability', 'equity') THEN l.credit - l.debit END)::bigint AS taxed_out,
               sum(CASE WHEN l.tax_group_id IS NULL AND l.tax_rate_id IS NULL AND a.type = 'income' AND a.subtype = 'operating_income' THEN l.credit - l.debit END)::bigint AS untaxed_out,
               sum(CASE WHEN l.tax_group_id IS NOT NULL AND a.type IN ('asset', 'expense') THEN l.debit - l.credit END)::bigint AS taxed_in
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
        WHERE l.organization_id = ${organizationId}::uuid AND e.status = 'posted' AND e.date BETWEEN ${range[0]}::date AND ${range[1]}::date
          AND e.id NOT IN (SELECT closing_entry_id FROM fiscal_years WHERE organization_id = ${organizationId}::uuid AND closing_entry_id IS NOT NULL)`,
    ]);
    const output = zeroHeads();
    const itc = zeroHeads();
    for (const t of taxes) {
      const h = head(t.kind);
      if (!h) continue;
      if (t.role === 'output') output[h] += Number(t.cr);
      else itc[h] -= Number(t.cr);
    }
    const v = values[0]!;
    const setOff = gstSetOff(
      {
        igst: Math.max(output.igst, 0),
        cgst: Math.max(output.cgst, 0),
        sgst: Math.max(output.sgst, 0),
        cess: Math.max(output.cess, 0),
      },
      {
        igst: Math.max(itc.igst, 0),
        cgst: Math.max(itc.cgst, 0),
        sgst: Math.max(itc.sgst, 0),
        cess: Math.max(itc.cess, 0),
      },
    );
    return {
      from,
      to,
      gstin: org.taxId,
      /** 3.1(a): outward taxable supplies and the tax on them */
      outward: { taxable: Number(v.taxed_out ?? 0), ...output },
      /** 3.1(c)/(e): outward supplies with no GST (nil-rated, exempt, non-GST) */
      outwardUntaxed: Number(v.untaxed_out ?? 0),
      /** 4(A)(5): input tax credit on purchases */
      itc,
      inwardTaxable: Number(v.taxed_in ?? 0),
      /** 6.1: how the credit is used, what's paid in cash, and what's carried forward */
      setOff,
      payable: setOff.cash,
      carriedForward: setOff.carriedForward,
    };
  }

  async gstr1(organizationId: string, from: string, to: string) {
    const org = await this.india(organizationId);
    const lineSelect = {
      quantity: true,
      amount: true,
      item: { select: { hsnSac: true, unit: true } },
      taxGroup: {
        select: {
          rates: {
            select: {
              rate: { select: { id: true, kind: true, ratePpm: true } },
            },
          },
        },
      },
    } as const;
    const [invoices, notes] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          status: { in: ['issued', 'void'] },
          issueDate: { gte: asDate(from), lte: asDate(to) },
        },
        orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
        select: {
          id: true,
          number: true,
          issueDate: true,
          total: true,
          currency: true,
          rate: true,
          placeOfSupply: true,
          status: true,
          fiscalYear: { select: { name: true } },
          voidEntry: { select: { date: true } },
          contact: { select: { name: true, taxId: true } },
          lines: { select: lineSelect },
        },
      }),
      this.prisma.creditNote.findMany({
        where: { organizationId, date: { gte: asDate(from), lte: asDate(to) } },
        orderBy: [{ date: 'asc' }, { number: 'asc' }],
        select: {
          id: true,
          number: true,
          date: true,
          total: true,
          currency: true,
          rate: true,
          status: true,
          fiscalYear: { select: { name: true } },
          voidEntry: { select: { date: true } },
          contact: { select: { name: true, taxId: true } },
          invoice: {
            select: {
              number: true,
              issueDate: true,
              placeOfSupply: true,
              fiscalYear: { select: { name: true } },
            },
          },
          // A credit note line's item is its invoice line's
          lines: {
            select: {
              quantity: true,
              amount: true,
              taxGroup: lineSelect.taxGroup,
              invoiceLine: { select: { item: lineSelect.item } },
            },
          },
        },
      }),
    ]);
    const live = (d: { status: string; voidEntry: { date: Date } | null }) =>
      d.status !== 'void' || (!!d.voidEntry && d.voidEntry.date > asDate(to));
    const inBase = (
      minor: number,
      currency: string | null,
      rate: { toString(): string } | null,
    ) =>
      currency && rate
        ? toBase(
            minor,
            rate.toString(),
            currencyDigits(currency),
            currencyDigits(org.baseCurrency),
          )
        : minor;
    /** A line's taxable value and tax by head, in the base currency, and its GST rate */
    const split = (
      l: { amount: bigint; taxGroup: { rates: Rates } | null },
      currency: string | null,
      rate: { toString(): string } | null,
    ) => {
      const net = Number(l.amount);
      const rates = l.taxGroup?.rates ?? [];
      const parts = splitTax(
        net,
        false,
        rates.map((r) => ({ rateId: r.rate.id, ratePpm: r.rate.ratePpm })),
      ).taxes;
      const heads = zeroHeads();
      parts.forEach((p, k) => {
        const h = head(rates[k]!.rate.kind);
        if (h) heads[h] += inBase(p.amount, currency, rate);
      });
      const gstRate =
        rates
          .filter((r) =>
            ['igst', 'cgst', 'sgst', 'utgst'].includes(r.rate.kind),
          )
          .reduce((s, r) => s + r.rate.ratePpm, 0) / 10_000;
      return { taxable: inBase(net, currency, rate), heads, gstRate };
    };
    type RateRow = { rate: number; taxable: number } & GstHeads;
    const byRate = (
      lines: { amount: bigint; taxGroup: { rates: Rates } | null }[],
      currency: string | null,
      rate: { toString(): string } | null,
    ) => {
      const m = new Map<number, RateRow>();
      for (const l of lines) {
        const s = split(l, currency, rate);
        const r = m.get(s.gstRate) ?? {
          rate: s.gstRate,
          taxable: 0,
          ...zeroHeads(),
        };
        r.taxable += s.taxable;
        add(r, s.heads);
        m.set(s.gstRate, r);
      }
      return [...m.values()].sort((a, b) => a.rate - b.rate);
    };

    const b2b: {
      gstin: string;
      name: string;
      number: string;
      date: string;
      value: number;
      placeOfSupply: string | null;
      items: RateRow[];
    }[] = [];
    const b2cl: {
      number: string;
      date: string;
      value: number;
      placeOfSupply: string | null;
      items: RateRow[];
    }[] = [];
    const b2cs = new Map<
      string,
      { placeOfSupply: string | null; type: 'intra' | 'inter' } & RateRow
    >();
    const exports: {
      number: string;
      date: string;
      value: number;
      currency: string | null;
      items: RateRow[];
    }[] = [];
    const hsn = new Map<
      string,
      {
        hsn: string;
        unit: string | null;
        rate: number;
        quantity: bigint;
        taxable: number;
      } & GstHeads
    >();
    const addHsn = (
      l: (typeof invoices)[number]['lines'][number],
      s: ReturnType<typeof split>,
      sign: 1 | -1,
    ) => {
      const key = `${l.item?.hsnSac ?? ''}|${s.gstRate}`;
      const h = hsn.get(key) ?? {
        hsn: l.item?.hsnSac ?? '',
        unit: l.item?.unit ?? null,
        rate: s.gstRate,
        quantity: 0n,
        taxable: 0,
        ...zeroHeads(),
      };
      h.quantity += BigInt(sign) * parseQuantity(l.quantity.toFixed(4))!;
      h.taxable += sign * s.taxable;
      add(h, s.heads, sign);
      hsn.set(key, h);
    };
    let cancelled = 0;
    const numbers: string[] = [];
    for (const i of invoices) {
      const label = invoiceNumber(i.fiscalYear!.name, i.number!);
      numbers.push(label);
      if (!live(i)) {
        cancelled++;
        continue;
      }
      const items = byRate(i.lines, i.currency, i.rate);
      const value = inBase(Number(i.total), i.currency, i.rate);
      for (const l of i.lines) addHsn(l, split(l, i.currency, i.rate), 1);
      const doc = { number: label, date: iso(i.issueDate), value, items };
      if (i.contact.taxId && isGstin(i.contact.taxId))
        b2b.push({
          gstin: i.contact.taxId.toUpperCase(),
          name: i.contact.name,
          placeOfSupply: i.placeOfSupply,
          ...doc,
        });
      else if (!i.placeOfSupply) exports.push({ ...doc, currency: i.currency });
      else {
        const inter =
          items.some((r) => r.igst) ||
          (!!org.stateCode && i.placeOfSupply !== org.stateCode);
        if (inter && value > B2CL_THRESHOLD)
          b2cl.push({ placeOfSupply: i.placeOfSupply, ...doc });
        else
          for (const r of items) {
            const key = `${i.placeOfSupply}|${r.rate}`;
            const row = b2cs.get(key) ?? {
              placeOfSupply: i.placeOfSupply,
              type: inter ? ('inter' as const) : ('intra' as const),
              rate: r.rate,
              taxable: 0,
              ...zeroHeads(),
            };
            row.taxable += r.taxable;
            add(row, r);
            b2cs.set(key, row);
          }
      }
    }
    const cdnr: {
      gstin: string;
      name: string;
      number: string;
      date: string;
      invoice: string | null;
      value: number;
      items: RateRow[];
    }[] = [];
    const cdnur: {
      name: string;
      number: string;
      date: string;
      invoice: string | null;
      value: number;
      items: RateRow[];
    }[] = [];
    let notesCancelled = 0;
    for (const n of notes) {
      if (!live(n)) {
        notesCancelled++;
        continue;
      }
      for (const l of n.lines)
        addHsn(
          { ...l, item: l.invoiceLine.item },
          split(l, n.currency, n.rate),
          -1,
        );
      const doc = {
        number: creditNoteNumber(n.fiscalYear.name, n.number),
        date: iso(n.date),
        invoice:
          n.invoice.number && n.invoice.fiscalYear
            ? invoiceNumber(n.invoice.fiscalYear.name, n.invoice.number)
            : null,
        value: inBase(Number(n.total), n.currency, n.rate),
        items: byRate(n.lines, n.currency, n.rate),
      };
      if (n.contact.taxId && isGstin(n.contact.taxId))
        cdnr.push({
          gstin: n.contact.taxId.toUpperCase(),
          name: n.contact.name,
          ...doc,
        });
      else cdnur.push({ name: n.contact.name, ...doc });
    }
    const total = (rows: { items: RateRow[] }[]) => {
      const t = { taxable: 0, ...zeroHeads() };
      for (const r of rows)
        for (const x of r.items) {
          t.taxable += x.taxable;
          add(t, x);
        }
      return t;
    };
    const b2csRows = [...b2cs.values()].sort(
      (a, b) =>
        (a.placeOfSupply ?? '').localeCompare(b.placeOfSupply ?? '') ||
        a.rate - b.rate,
    );
    return {
      from,
      to,
      gstin: org.taxId,
      legalName: org.legalName ?? org.name,
      b2b,
      b2cl,
      b2cs: b2csRows,
      exports,
      cdnr,
      cdnur,
      hsn: [...hsn.values()]
        .filter((h) => h.taxable || h.quantity)
        .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate)
        .map((h) => ({
          ...h,
          quantity: formatQuantity(h.quantity < 0n ? -h.quantity : h.quantity),
          returned: h.quantity < 0n,
        })),
      totals: {
        b2b: total(b2b),
        b2cl: total(b2cl),
        b2cs: total(b2csRows.map((r) => ({ items: [r] }))),
        exports: total(exports),
        cdnr: total(cdnr),
        cdnur: total(cdnur),
      },
      documents: {
        invoices: {
          first: numbers[0] ?? null,
          last: numbers.at(-1) ?? null,
          total: numbers.length,
          cancelled,
        },
        creditNotes: { total: notes.length, cancelled: notesCancelled },
      },
    };
  }

  /** GSTR-1 as CSV (one section per block) or as JSON shaped like the portal's (amounts in rupees) */
  gstr1Export(
    g: Awaited<ReturnType<GstReturnsService['gstr1']>>,
    format: 'csv' | 'json',
    minor: (n: number) => string,
  ) {
    const rupees = (n: number) => Number(minor(n));
    const items = (rows: ({ rate: number; taxable: number } & GstHeads)[]) =>
      rows.map((r, k) => ({
        num: k + 1,
        itm_det: {
          rt: r.rate,
          txval: rupees(r.taxable),
          iamt: rupees(r.igst),
          camt: rupees(r.cgst),
          samt: rupees(r.sgst),
          csamt: rupees(r.cess),
        },
      }));
    const dmy = (d: string) =>
      `${d.slice(8)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
    if (format === 'json') {
      const byCustomer = new Map<string, typeof g.b2b>();
      for (const i of g.b2b)
        byCustomer.set(i.gstin, [...(byCustomer.get(i.gstin) ?? []), i]);
      return JSON.stringify(
        {
          gstin: g.gstin,
          fp: `${g.to.slice(5, 7)}${g.to.slice(0, 4)}`,
          b2b: [...byCustomer].map(([ctin, inv]) => ({
            ctin,
            inv: inv.map((i) => ({
              inum: i.number,
              idt: dmy(i.date),
              val: rupees(i.value),
              pos: i.placeOfSupply,
              rchrg: 'N',
              inv_typ: 'R',
              itms: items(i.items),
            })),
          })),
          b2cl: g.b2cl.map((i) => ({
            pos: i.placeOfSupply,
            inv: [
              {
                inum: i.number,
                idt: dmy(i.date),
                val: rupees(i.value),
                itms: items(i.items),
              },
            ],
          })),
          b2cs: g.b2cs.map((r) => ({
            sply_ty: r.type === 'inter' ? 'INTER' : 'INTRA',
            pos: r.placeOfSupply,
            typ: 'OE',
            rt: r.rate,
            txval: rupees(r.taxable),
            iamt: rupees(r.igst),
            camt: rupees(r.cgst),
            samt: rupees(r.sgst),
            csamt: rupees(r.cess),
          })),
          exp: g.exports.length
            ? [
                {
                  exp_typ: 'WOPAY',
                  inv: g.exports.map((i) => ({
                    inum: i.number,
                    idt: dmy(i.date),
                    val: rupees(i.value),
                    itms: items(i.items).map((x) => x.itm_det),
                  })),
                },
              ]
            : [],
          cdnr: g.cdnr.map((n) => ({
            ctin: n.gstin,
            nt: [
              {
                ntty: 'C',
                nt_num: n.number,
                nt_dt: dmy(n.date),
                val: rupees(n.value),
                itms: items(n.items),
              },
            ],
          })),
          hsn: {
            data: g.hsn.map((h, k) => ({
              num: k + 1,
              hsn_sc: h.hsn,
              uqc: h.unit ?? 'NA',
              qty: Number(h.quantity),
              rt: h.rate,
              txval: rupees(h.taxable),
              iamt: rupees(h.igst),
              camt: rupees(h.cgst),
              samt: rupees(h.sgst),
              csamt: rupees(h.cess),
            })),
          },
        },
        null,
        2,
      );
    }
    const rows: (string | number)[][] = [
      [
        'section',
        'gstin',
        'name',
        'document',
        'date',
        'place_of_supply',
        'rate',
        'taxable_value',
        'igst',
        'cgst',
        'sgst',
        'cess',
      ],
    ];
    const push = (
      section: string,
      gstin: string,
      name: string,
      doc: string,
      date: string,
      pos: string | null,
      r: { rate: number; taxable: number } & GstHeads,
    ) =>
      rows.push([
        section,
        gstin,
        name,
        doc,
        date,
        pos ?? '',
        r.rate,
        minor(r.taxable),
        minor(r.igst),
        minor(r.cgst),
        minor(r.sgst),
        minor(r.cess),
      ]);
    for (const i of g.b2b)
      for (const r of i.items)
        push('b2b', i.gstin, i.name, i.number, i.date, i.placeOfSupply, r);
    for (const i of g.b2cl)
      for (const r of i.items)
        push('b2cl', '', '', i.number, i.date, i.placeOfSupply, r);
    for (const r of g.b2cs) push('b2cs', '', '', '', '', r.placeOfSupply, r);
    for (const i of g.exports)
      for (const r of i.items)
        push('exports', '', '', i.number, i.date, null, r);
    for (const n of g.cdnr)
      for (const r of n.items)
        push('cdnr', n.gstin, n.name, n.number, n.date, null, r);
    for (const n of g.cdnur)
      for (const r of n.items)
        push('cdnur', '', n.name, n.number, n.date, null, r);
    for (const h of g.hsn)
      rows.push([
        'hsn',
        '',
        h.hsn,
        h.unit ?? '',
        h.quantity,
        '',
        h.rate,
        minor(h.taxable),
        minor(h.igst),
        minor(h.cgst),
        minor(h.sgst),
        minor(h.cess),
      ]);
    const cell = (v: string | number) => {
      const s = String(v);
      return /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)
        ? `"'${s}"`
        : `"${s.replace(/"/g, '""')}"`;
    };
    return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
  }

  /**
   * GSTR-2B against the books: the portal's JSON matched to bills dated in the range (recorded, or voided after it),
   * with their GST by head in the base currency. Nothing is stored; the file is read and the result returned.
   */
  async gstr2b(
    organizationId: string,
    content: string,
    from: string,
    to: string,
  ) {
    const org = await this.india(organizationId);
    let file;
    try {
      file = parseGstr2b(content);
    } catch (e) {
      if (e instanceof Gstr2bError)
        throw new BadRequestException({
          message:
            e.reason === 'not_json'
              ? 'That file isn’t JSON. Download GSTR-2B from the GST portal as JSON.'
              : e.reason === 'too_many'
                ? 'That file has too many documents to match at once.'
                : 'That doesn’t look like GSTR-2B. Download it from the GST portal (Returns → GSTR-2B → Download JSON).',
          details: {
            reason: e.reason === 'not_json' ? 'not_json' : 'not_gstr2b',
          },
        });
      throw e;
    }
    const rows = await this.prisma.bill.findMany({
      where: {
        organizationId,
        status: { in: ['open', 'void'] },
        billDate: { gte: asDate(from), lte: asDate(to) },
      },
      orderBy: [{ billDate: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        status: true,
        vendorReference: true,
        billDate: true,
        currency: true,
        rate: true,
        total: true,
        fiscalYear: { select: { name: true } },
        voidEntry: { select: { date: true } },
        contact: { select: { name: true, legalName: true, taxId: true } },
        lines: {
          select: {
            amount: true,
            taxGroup: {
              select: {
                rates: {
                  select: {
                    rate: { select: { id: true, kind: true, ratePpm: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const inBase = (
      minor: number,
      currency: string | null,
      rate: { toString(): string } | null,
    ) =>
      currency && rate
        ? toBase(
            minor,
            rate.toString(),
            currencyDigits(currency),
            currencyDigits(org.baseCurrency),
          )
        : minor;
    const bills: Gstr2bBill[] = rows
      .filter(
        (b) =>
          b.status !== 'void' ||
          (!!b.voidEntry && b.voidEntry.date > asDate(to)),
      )
      .map((b) => {
        const heads = zeroHeads();
        let taxable = 0;
        for (const l of b.lines) {
          const rates = l.taxGroup?.rates ?? [];
          taxable += inBase(Number(l.amount), b.currency, b.rate);
          splitTax(
            Number(l.amount),
            false,
            rates.map((r) => ({ rateId: r.rate.id, ratePpm: r.rate.ratePpm })),
          ).taxes.forEach((t, k) => {
            const h = head(rates[k]!.rate.kind);
            if (h) heads[h] += inBase(t.amount, b.currency, b.rate);
          });
        }
        return {
          id: b.id,
          number:
            b.number && b.fiscalYear
              ? billNumber(b.fiscalYear.name, b.number)
              : null,
          vendorReference: b.vendorReference,
          vendorName: b.contact.legalName ?? b.contact.name,
          vendorGstin:
            b.contact.taxId && isGstin(b.contact.taxId)
              ? b.contact.taxId.toUpperCase()
              : null,
          date: iso(b.billDate),
          taxable,
          heads,
          total: inBase(Number(b.total), b.currency, b.rate),
        };
      });
    // Our debit notes, to match the suppliers' credit notes in the file by the number they carry
    const notes = await this.prisma.vendorCredit.findMany({
      where: {
        organizationId,
        status: 'issued',
        date: { gte: asDate(from), lte: asDate(to) },
      },
      select: {
        id: true,
        number: true,
        date: true,
        vendorReference: true,
        total: true,
        fiscalYear: { select: { name: true } },
        contact: { select: { name: true, legalName: true, taxId: true } },
        lines: {
          select: {
            amount: true,
            taxGroup: {
              select: {
                rates: {
                  select: {
                    rate: { select: { id: true, kind: true, ratePpm: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const debitNotes: Gstr2bBill[] = notes.map((n) => {
      const heads = zeroHeads();
      let taxable = 0;
      for (const l of n.lines) {
        const rates = l.taxGroup?.rates ?? [];
        taxable += Number(l.amount);
        splitTax(
          Number(l.amount),
          false,
          rates.map((r) => ({ rateId: r.rate.id, ratePpm: r.rate.ratePpm })),
        ).taxes.forEach((t, k) => {
          const h = head(rates[k]!.rate.kind);
          if (h) heads[h] += t.amount;
        });
      }
      return {
        id: n.id,
        kind: 'debit_note',
        number: vendorCreditNumber(n.fiscalYear.name, n.number),
        vendorReference: n.vendorReference,
        vendorName: n.contact.legalName ?? n.contact.name,
        vendorGstin:
          n.contact.taxId && isGstin(n.contact.taxId)
            ? n.contact.taxId.toUpperCase()
            : null,
        date: iso(n.date),
        taxable,
        heads,
        total: Number(n.total),
      };
    });
    const result = reconcileGstr2b(file.docs, bills, 100, debitNotes);
    return {
      gstin: file.gstin,
      period: file.period,
      /** The file is for another GSTIN than the organisation's */
      otherGstin:
        !!file.gstin && !!org.taxId && file.gstin !== org.taxId.toUpperCase(),
      from,
      to,
      ...result,
    };
  }

  /**
   * The statutory due dates coming up (and just missed), each with days left; GSTR-3B with the tax it would put
   * in cash from the books so far. Organisations outside India have none.
   */
  async compliance(organizationId: string, now = new Date()) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { country: true, taxId: true, timeZone: true },
    });
    if (org.country !== 'IN') return { today: null, items: [] };
    const today = todayIn(org.timeZone, now);
    const items: ComplianceItem[] = complianceDueDates(today, {
      gst: !!org.taxId,
    });
    // TDS kept back in the last few months, due by the 7th of the next
    const back = new Date(Date.parse(`${today}T00:00:00Z`));
    back.setUTCMonth(back.getUTCMonth() - 3, 1);
    const tdsByMonth = await this.tds.byMonth(
      organizationId,
      back.toISOString().slice(0, 10),
      today,
    );
    const tdsAmounts = new Map<string, number>();
    for (const [month, amount] of tdsByMonth) {
      const due = tdsDepositDue(month);
      const days0 = Math.round(
        (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      );
      if (days0 < -10 || days0 > 45) continue;
      const [y, m] = month.split('-').map(Number) as [number, number];
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      items.push({ kind: 'tds', from: `${month}-01`, to: end, due });
      tdsAmounts.set(`${month}-01`, amount);
    }
    items.sort(
      (a, b) => a.due.localeCompare(b.due) || a.kind.localeCompare(b.kind),
    );
    const days = (due: string) =>
      Math.round(
        (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      );
    return {
      today,
      items: await Promise.all(
        items.map(async (i) => {
          let amount: number | undefined;
          if (i.kind === 'tds') amount = tdsAmounts.get(i.from);
          if (i.kind === 'gstr3b') {
            const r = await this.gstr3b(organizationId, i.from, i.to);
            amount =
              r.payable.igst + r.payable.cgst + r.payable.sgst + r.payable.cess;
          }
          return {
            ...i,
            daysLeft: days(i.due),
            ...(amount === undefined ? {} : { amount }),
          };
        }),
      ),
    };
  }
}
