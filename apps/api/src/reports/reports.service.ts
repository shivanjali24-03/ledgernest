import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AGING_BUCKETS,
  agingBucket,
  billNumber,
  compareCodes,
  csvCell,
  currencyDigits,
  daysBetween,
  formatRate,
  invoiceNumber,
  journalNumber,
  normaliseRate,
  NORMAL_SIDE,
  toBase,
  type AccountType,
  type AgingBucket,
  type AgingSide,
  type TaxKind,
  BS_SECTIONS,
  bsSectionOf,
  fiscalYearOf,
  fiscalYearSpan,
  PNL_SECTIONS,
  pnlColumns,
  pnlSectionOf,
  type BsSection,
  type PnlCompare,
  type PnlSection,
} from '@ledgernest/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Reports read only posted entries. Sums are computed by PostgreSQL over indexed columns,
 * so they stay fast with hundreds of thousands of lines.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every account's debits, credits and balance up to a day. Debits always equal credits. */
  async trialBalance(organizationId: string, asOf: string) {
    const [accounts, sums] = await Promise.all([
      this.prisma.account.findMany({
        where: { organizationId },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          archivedAt: true,
        },
      }),
      this.prisma.$queryRaw<
        { account_id: string; debit: bigint; credit: bigint }[]
      >`
        SELECT l.account_id, sum(l.debit)::bigint AS debit, sum(l.credit)::bigint AS credit
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.organization_id = ${organizationId}::uuid AND e.status = 'posted' AND e.date <= ${asDate(asOf)}::date
        GROUP BY l.account_id`,
    ]);
    const byAccount = new Map(
      sums.map((s) => [
        s.account_id,
        { debit: Number(s.debit), credit: Number(s.credit) },
      ]),
    );
    const rows = accounts
      .map((a) => {
        const s = byAccount.get(a.id) ?? { debit: 0, credit: 0 };
        const net = s.debit - s.credit;
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          type: a.type as AccountType,
          normalSide: NORMAL_SIDE[a.type as AccountType],
          archived: a.archivedAt !== null,
          debit: s.debit,
          credit: s.credit,
          balanceDebit: net > 0 ? net : 0,
          balanceCredit: net < 0 ? -net : 0,
        };
      })
      // Accounts with activity, plus active ones (so a new chart still shows its accounts at zero)
      .filter((r) => r.debit || r.credit || !r.archived)
      .sort((x, y) => compareCodes(x.code, y.code));
    const totals = rows.reduce(
      (t, r) => ({
        debit: t.debit + r.debit,
        credit: t.credit + r.credit,
        balanceDebit: t.balanceDebit + r.balanceDebit,
        balanceCredit: t.balanceCredit + r.balanceCredit,
      }),
      { debit: 0, credit: 0, balanceDebit: 0, balanceCredit: 0 },
    );
    return {
      asOf,
      rows,
      totals,
      balanced:
        totals.debit === totals.credit &&
        totals.balanceDebit === totals.balanceCredit,
    };
  }

  /** One account's posted lines in a date range, with the balance carried in and a running balance. */
  async ledger(
    organizationId: string,
    accountId: string,
    from: string,
    to: string,
  ) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, organizationId },
      select: { id: true, code: true, name: true, type: true, currency: true },
    });
    if (!account) throw new NotFoundException('Account not found.');
    const normal = NORMAL_SIDE[account.type as AccountType];
    // Balances are shown on the account's normal side: a positive bank balance is money in the bank
    const signed = (debit: number, credit: number) =>
      normal === 'debit' ? debit - credit : credit - debit;

    const [opening] = await this.prisma.$queryRaw<
      { debit: bigint | null; credit: bigint | null; foreign: bigint | null }[]
    >`
      SELECT sum(l.debit)::bigint AS debit, sum(l.credit)::bigint AS credit, sum(l.foreign_debit - l.foreign_credit)::bigint AS foreign
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.organization_id = ${organizationId}::uuid AND l.account_id = ${accountId}::uuid AND e.status = 'posted' AND e.date < ${asDate(from)}::date`;
    // One join in SQL: loading entries per line through the ORM would send every line id as a parameter
    const lines = await this.prisma.$queryRaw<
      {
        id: string;
        description: string | null;
        debit: bigint;
        credit: bigint;
        foreign_debit: bigint;
        foreign_credit: bigint;
        rate: string | null;
        entry_id: string;
        date: Date;
        number: number | null;
        memo: string | null;
        reference: string | null;
        year_name: string | null;
      }[]
    >`
      SELECT l.id, l.description, l.debit, l.credit, l.foreign_debit, l.foreign_credit, l.rate::text AS rate, e.id AS entry_id, e.date, e.number, e.memo, e.reference, y.name AS year_name
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      LEFT JOIN fiscal_years y ON y.id = e.fiscal_year_id
      WHERE l.organization_id = ${organizationId}::uuid AND l.account_id = ${accountId}::uuid AND e.status = 'posted'
        AND e.date BETWEEN ${asDate(from)}::date AND ${asDate(to)}::date
      ORDER BY e.date, e.number, l.line_no`;
    let balance = signed(
      Number(opening?.debit ?? 0),
      Number(opening?.credit ?? 0),
    );
    const openingBalance = balance;
    // Foreign-currency accounts also run their balance in that currency, on the same normal side
    let foreignBalance =
      (normal === 'debit' ? 1 : -1) * Number(opening?.foreign ?? 0);
    const openingForeign = foreignBalance;
    let debit = 0;
    let credit = 0;
    const rows = lines.map((l) => {
      const d = Number(l.debit);
      const c = Number(l.credit);
      debit += d;
      credit += c;
      balance += signed(d, c);
      const fd = Number(l.foreign_debit);
      const fc = Number(l.foreign_credit);
      foreignBalance += signed(fd, fc);
      const row = {
        lineId: l.id,
        entryId: l.entry_id,
        number:
          l.number && l.year_name ? journalNumber(l.year_name, l.number) : null,
        date: iso(l.date),
        memo: l.memo,
        reference: l.reference,
        description: l.description,
        debit: d,
        credit: c,
        balance,
      };
      return account.currency
        ? {
            ...row,
            foreignDebit: fd,
            foreignCredit: fc,
            rate: l.rate && normaliseRate(l.rate),
            foreignBalance,
          }
        : row;
    });
    return {
      account: { ...account, normalSide: normal },
      from,
      to,
      openingBalance,
      rows,
      totals: { debit, credit },
      closingBalance: balance,
      ...(account.currency && {
        foreign: {
          currency: account.currency,
          openingBalance: openingForeign,
          closingBalance: foreignBalance,
        },
      }),
    };
  }

  /**
   * Tax charged and paid in a date range, for filing. Each taxed line counts on the side its account is on:
   * income and other credits are outward supplies (output tax owed), expenses and assets are inward
   * supplies (input tax claimable). Credit notes and reversals run the other way and reduce the same figures.
   */
  async taxSummary(organizationId: string, from: string, to: string) {
    const range = { from: asDate(from), to: asDate(to) };
    const [groupSums, rateSums] = await Promise.all([
      this.prisma.$queryRaw<
        {
          group_id: string;
          role: 'input' | 'output';
          taxable_cr: bigint;
          tax_cr: bigint;
        }[]
      >`
        WITH src AS (
          SELECT l.entry_id, l.line_no, l.tax_group_id, a.type, l.debit, l.credit
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.entry_id
          JOIN accounts a ON a.id = l.account_id
          WHERE l.organization_id = ${organizationId}::uuid AND l.tax_group_id IS NOT NULL AND e.status = 'posted'
            AND e.date BETWEEN ${range.from}::date AND ${range.to}::date
        ), tax AS (
          SELECT t.entry_id, t.tax_source_line, sum(t.credit - t.debit) AS cr
          FROM journal_lines t
          WHERE t.organization_id = ${organizationId}::uuid AND t.tax_rate_id IS NOT NULL AND t.entry_id IN (SELECT entry_id FROM src)
          GROUP BY 1, 2
        )
        SELECT src.tax_group_id AS group_id,
               CASE WHEN src.type IN ('asset', 'expense') THEN 'input' ELSE 'output' END AS role,
               sum(src.credit - src.debit)::bigint AS taxable_cr,
               coalesce(sum(tax.cr), 0)::bigint AS tax_cr
        FROM src LEFT JOIN tax ON tax.entry_id = src.entry_id AND tax.tax_source_line = src.line_no
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<
        { rate_id: string; role: 'input' | 'output'; cr: bigint }[]
      >`
        SELECT t.tax_rate_id AS rate_id,
               CASE WHEN a.type IN ('asset', 'expense') THEN 'input' ELSE 'output' END AS role,
               sum(t.credit - t.debit)::bigint AS cr
        FROM journal_lines t
        JOIN journal_entries e ON e.id = t.entry_id
        JOIN journal_lines s ON s.entry_id = t.entry_id AND s.line_no = t.tax_source_line
        JOIN accounts a ON a.id = s.account_id
        WHERE t.organization_id = ${organizationId}::uuid AND t.tax_rate_id IS NOT NULL AND e.status = 'posted'
          AND e.date BETWEEN ${range.from}::date AND ${range.to}::date
        GROUP BY 1, 2`,
    ]);
    const groupIds = [...new Set(groupSums.map((g) => g.group_id))];
    const rateIds = [...new Set(rateSums.map((r) => r.rate_id))];
    const [groupRows, rateRows] = await Promise.all([
      this.prisma.taxGroup.findMany({
        where: { organizationId, id: { in: groupIds } },
        select: {
          id: true,
          name: true,
          supply: true,
          rates: { select: { rate: { select: { ratePpm: true } } } },
        },
      }),
      this.prisma.taxRate.findMany({
        where: { organizationId, id: { in: rateIds } },
        select: { id: true, name: true, kind: true, ratePpm: true },
      }),
    ]);

    // Output figures are credits; input figures are debits, so their sign flips
    const groups = groupRows
      .map((g) => {
        const sum = (role: 'input' | 'output') => {
          const r = groupSums.find(
            (x) => x.group_id === g.id && x.role === role,
          );
          const sign = role === 'output' ? 1 : -1;
          return {
            taxable: sign * Number(r?.taxable_cr ?? 0),
            tax: sign * Number(r?.tax_cr ?? 0),
          };
        };
        const totalPpm = g.rates.reduce((t, r) => t + r.rate.ratePpm, 0);
        return {
          id: g.id,
          name: g.name,
          supply: g.supply as 'intra' | 'inter' | null,
          totalPpm,
          total: formatRate(totalPpm),
          outward: sum('output'),
          inward: sum('input'),
        };
      })
      .sort((a, b) => a.totalPpm - b.totalPpm || a.name.localeCompare(b.name));
    const rates = rateRows
      .map((r) => {
        const output = Number(
          rateSums.find((x) => x.rate_id === r.id && x.role === 'output')?.cr ??
            0,
        );
        const input = -Number(
          rateSums.find((x) => x.rate_id === r.id && x.role === 'input')?.cr ??
            0,
        );
        return {
          id: r.id,
          name: r.name,
          kind: r.kind as TaxKind,
          rate: formatRate(r.ratePpm),
          ratePpm: r.ratePpm,
          output,
          input,
          net: output - input,
        };
      })
      .sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) ||
          a.ratePpm - b.ratePpm ||
          a.name.localeCompare(b.name),
      );
    const totals = {
      outwardTaxable: groups.reduce((t, g) => t + g.outward.taxable, 0),
      inwardTaxable: groups.reduce((t, g) => t + g.inward.taxable, 0),
      output: rates.reduce((t, r) => t + r.output, 0),
      input: rates.reduce((t, r) => t + r.input, 0),
      /** Owed to the government; negative = carried forward as credit */
      net: rates.reduce((t, r) => t + r.net, 0),
    };
    return { from, to, groups, rates, totals };
  }

  taxSummaryCsv(
    t: Awaited<ReturnType<ReportsService['taxSummary']>>,
    minor: (n: number) => string,
  ) {
    const rows: (string | null)[][] = [
      [
        'tax_group',
        'rate',
        'outward_taxable_value',
        'output_tax',
        'inward_taxable_value',
        'input_tax',
      ],
      ...t.groups.map((g) => [
        g.name,
        g.total,
        minor(g.outward.taxable),
        minor(g.outward.tax),
        minor(g.inward.taxable),
        minor(g.inward.tax),
      ]),
      [
        'Total',
        '',
        minor(t.totals.outwardTaxable),
        minor(t.totals.output),
        minor(t.totals.inwardTaxable),
        minor(t.totals.input),
      ],
      [],
      ['tax', 'rate', 'output_tax', 'input_tax', 'net_payable'],
      ...t.rates.map((r) => [
        r.name,
        r.rate,
        minor(r.output),
        minor(r.input),
        minor(r.net),
      ]),
      [
        'Total',
        '',
        minor(t.totals.output),
        minor(t.totals.input),
        minor(t.totals.net),
      ],
    ];
    return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }

  /** Amounts for CSV in the currency's own decimals (JPY has none, KWD three). */
  async decimals(organizationId: string) {
    const { baseCurrency } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    const digits =
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: baseCurrency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
    return (n: number) => (n / 10 ** digits).toFixed(digits);
  }

  /** The trial balance as CSV, safe to open in a spreadsheet. */
  trialBalanceCsv(
    tb: Awaited<ReturnType<ReportsService['trialBalance']>>,
    minor: (n: number) => string,
  ) {
    const header = [
      'code',
      'account',
      'type',
      'debits',
      'credits',
      'balance_debit',
      'balance_credit',
    ];
    const lines = tb.rows.map((r) =>
      [
        r.code,
        r.name,
        r.type,
        minor(r.debit),
        minor(r.credit),
        minor(r.balanceDebit),
        minor(r.balanceCredit),
      ]
        .map(csvCell)
        .join(','),
    );
    lines.push(
      [
        '',
        'Total',
        '',
        minor(tb.totals.debit),
        minor(tb.totals.credit),
        minor(tb.totals.balanceDebit),
        minor(tb.totals.balanceCredit),
      ]
        .map(csvCell)
        .join(','),
    );
    return `﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
  }

  ledgerCsv(
    l: Awaited<ReturnType<ReportsService['ledger']>>,
    minor: (n: number) => string,
  ) {
    const header = [
      'date',
      'number',
      'memo',
      'reference',
      'description',
      'debit',
      'credit',
      'balance',
    ];
    const rows = [
      ['', '', 'Opening balance', '', '', '', '', minor(l.openingBalance)],
      ...l.rows.map((r) => [
        r.date,
        r.number,
        r.memo,
        r.reference,
        r.description,
        minor(r.debit),
        minor(r.credit),
        minor(r.balance),
      ]),
      [
        '',
        '',
        'Closing balance',
        '',
        '',
        minor(l.totals.debit),
        minor(l.totals.credit),
        minor(l.closingBalance),
      ],
    ];
    return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }

  /**
   * Who owes what (receivables) or what we owe (payables) on a day, by how long it's been due. A document counts
   * once issued or recorded by then and not voided by then; what had been paid by then comes off. Amounts are in
   * each contact's currency, with totals in the base currency at the rates the documents were posted at.
   */
  async aging(organizationId: string, side: AgingSide, asOf: string) {
    const day = asDate(asOf);
    const { baseCurrency } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    const paidBy = {
      select: {
        amount: true,
        payment: {
          select: { date: true, voidEntry: { select: { date: true } } },
        },
      },
    } as const;
    const common = {
      contact: { select: { id: true, name: true } },
      number: true,
      dueDate: true,
      currency: true,
      rate: true,
      total: true,
      fiscalYear: { select: { name: true } },
      voidEntry: { select: { date: true } },
      allocations: paidBy,
    } as const;
    // Credit notes take what they credit off invoices; what's left is credit the customer holds
    const creditedBy = {
      select: {
        amount: true,
        date: true,
        creditNote: { select: { voidEntry: { select: { date: true } } } },
      },
    } as const;
    const live = (v: { date: Date } | null) => !v || v.date > day;
    const docs =
      side === 'receivables'
        ? (
            await this.prisma.invoice.findMany({
              where: {
                organizationId,
                status: { in: ['issued', 'void'] },
                issueDate: { lte: day },
              },
              select: {
                id: true,
                issueDate: true,
                credits: creditedBy,
                ...common,
              },
            })
          ).map((d) => ({
            ...d,
            date: d.issueDate,
            label: invoiceNumber(d.fiscalYear!.name, d.number!),
          }))
        : (
            await this.prisma.bill.findMany({
              where: {
                organizationId,
                status: { in: ['open', 'void'] },
                billDate: { lte: day },
              },
              select: {
                id: true,
                billDate: true,
                vendorReference: true,
                ...common,
              },
            })
          ).map((d) => ({
            ...d,
            date: d.billDate,
            label: billNumber(d.fiscalYear!.name, d.number!),
          }));
    const advances = await this.prisma.payment.findMany({
      where: {
        organizationId,
        kind: side === 'receivables' ? 'receipt' : 'payment',
        date: { lte: day },
        amount: { gt: this.prisma.payment.fields.allocated },
      },
      select: {
        contactId: true,
        currency: true,
        rate: true,
        amount: true,
        allocated: true,
        voidEntry: { select: { date: true } },
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
            currencyDigits(baseCurrency),
          )
        : minor;
    const zero = () =>
      Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<
        AgingBucket,
        number
      >;

    type Row = {
      contact: { id: string; name: string };
      currency: string | null;
      buckets: Record<AgingBucket, number>;
      total: number;
      advance: number;
      baseTotal: number;
      baseAdvance: number;
      documents: {
        id: string;
        number: string;
        vendorReference: string | null;
        date: string;
        dueDate: string;
        daysOverdue: number;
        bucket: AgingBucket;
        total: number;
        outstanding: number;
      }[];
    };
    const rows = new Map<string, Row>();
    const rowFor = (
      contact: { id: string; name: string },
      currency: string | null,
    ) => {
      const key = `${contact.id}:${currency ?? ''}`;
      if (!rows.has(key))
        rows.set(key, {
          contact,
          currency,
          buckets: zero(),
          total: 0,
          advance: 0,
          baseTotal: 0,
          baseAdvance: 0,
          documents: [],
        });
      return rows.get(key)!;
    };
    const totals = { buckets: zero(), total: 0, advance: 0 };
    for (const d of docs) {
      if (!live(d.voidEntry)) continue;
      const credited =
        'credits' in d
          ? d.credits
              .filter((c) => c.date <= day && live(c.creditNote.voidEntry))
              .reduce((s, c) => s + Number(c.amount), 0)
          : 0;
      const paid =
        d.allocations
          .filter((a) => a.payment.date <= day && live(a.payment.voidEntry))
          .reduce((s, a) => s + Number(a.amount), 0) + credited;
      const outstanding = Number(d.total) - paid;
      if (outstanding <= 0) continue;
      const due = iso(d.dueDate);
      const bucket = agingBucket(due, asOf);
      const r = rowFor(d.contact, d.currency);
      r.buckets[bucket] += outstanding;
      r.total += outstanding;
      const base = inBase(outstanding, d.currency, d.rate);
      r.baseTotal += base;
      totals.buckets[bucket] += base;
      totals.total += base;
      r.documents.push({
        id: d.id,
        number: d.label,
        vendorReference: 'vendorReference' in d ? d.vendorReference : null,
        date: iso(d.date),
        dueDate: due,
        daysOverdue: Math.max(0, daysBetween(due, asOf)),
        bucket,
        total: Number(d.total),
        outstanding,
      });
    }
    const credits =
      side === 'receivables'
        ? await this.prisma.creditNote.findMany({
            where: { organizationId, date: { lte: day } },
            select: {
              contactId: true,
              currency: true,
              rate: true,
              total: true,
              voidEntry: { select: { date: true } },
              applications: { select: { date: true, amount: true } },
            },
          })
        : [];
    const contacts = await this.prisma.contact.findMany({
      where: {
        organizationId,
        id: {
          in: [...new Set([...advances, ...credits].map((a) => a.contactId))],
        },
      },
      select: { id: true, name: true },
    });
    for (const a of advances) {
      if (!live(a.voidEntry)) continue;
      const left = Number(a.amount - a.allocated);
      const r = rowFor(
        contacts.find((c) => c.id === a.contactId)!,
        a.currency,
      );
      r.advance += left;
      const base = inBase(left, a.currency, a.rate);
      r.baseAdvance += base;
      totals.advance += base;
    }
    for (const n of credits) {
      if (!live(n.voidEntry)) continue;
      const left =
        Number(n.total) -
        n.applications
          .filter((a) => a.date <= day)
          .reduce((s, a) => s + Number(a.amount), 0);
      if (left <= 0) continue;
      const r = rowFor(
        contacts.find((c) => c.id === n.contactId)!,
        n.currency,
      );
      const base = inBase(left, n.currency, n.rate);
      r.advance += left;
      r.baseAdvance += base;
      totals.advance += base;
    }
    const list = [...rows.values()].sort(
      (x, y) =>
        x.contact.name.localeCompare(y.contact.name) ||
        (x.currency ?? '').localeCompare(y.currency ?? ''),
    );
    for (const r of list)
      r.documents.sort(
        (x, y) =>
          x.dueDate.localeCompare(y.dueDate) ||
          x.number.localeCompare(y.number),
      );
    return {
      side,
      asOf,
      baseCurrency,
      buckets: AGING_BUCKETS,
      contacts: list,
      totals: { ...totals, net: totals.total - totals.advance },
    };
  }

  /** The aging report as CSV: each document, a subtotal per contact (less advances), and the total in the base currency. */
  agingCsv(a: Awaited<ReturnType<ReportsService['aging']>>) {
    const fmt = (minor: number, currency: string) => {
      const digits = currencyDigits(currency);
      return (minor / 10 ** digits).toFixed(digits);
    };
    const header = [
      'contact',
      'document',
      'date',
      'due_date',
      'days_overdue',
      'currency',
      'current',
      '1_30',
      '31_60',
      '61_90',
      'over_90',
      'advance',
      'net',
    ];
    const rows: (string | number)[][] = [header];
    for (const c of a.contacts) {
      const cur = c.currency ?? a.baseCurrency;
      for (const d of c.documents)
        rows.push([
          c.contact.name,
          d.number,
          d.date,
          d.dueDate,
          d.daysOverdue,
          cur,
          ...AGING_BUCKETS.map((b) =>
            b === d.bucket ? fmt(d.outstanding, cur) : '',
          ),
          '',
          fmt(d.outstanding, cur),
        ]);
      rows.push([
        `${c.contact.name} total`,
        '',
        '',
        '',
        '',
        cur,
        ...AGING_BUCKETS.map((b) => fmt(c.buckets[b], cur)),
        fmt(c.advance, cur),
        fmt(c.total - c.advance, cur),
      ]);
    }
    rows.push([
      `Total (${a.baseCurrency})`,
      '',
      '',
      '',
      '',
      a.baseCurrency,
      ...AGING_BUCKETS.map((b) => fmt(a.totals.buckets[b], a.baseCurrency)),
      fmt(a.totals.advance, a.baseCurrency),
      fmt(a.totals.net, a.baseCurrency),
    ]);
    return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }

  /** Each account's debits and credits over some days (from = null: since the beginning), leaving out year-end closings if asked */
  private async sums(
    organizationId: string,
    from: string | null,
    to: string,
    withoutClosings: boolean,
  ) {
    const rows = await this.prisma.$queryRaw<
      { account_id: string; debit: bigint; credit: bigint }[]
    >`
      SELECT l.account_id, sum(l.debit)::bigint AS debit, sum(l.credit)::bigint AS credit
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.organization_id = ${organizationId}::uuid AND e.status = 'posted'
        AND e.date <= ${asDate(to)}::date AND (${from}::date IS NULL OR e.date >= ${from}::date)
        AND (NOT ${withoutClosings} OR e.id NOT IN (SELECT closing_entry_id FROM fiscal_years WHERE organization_id = ${organizationId}::uuid AND closing_entry_id IS NOT NULL))
      GROUP BY l.account_id`;
    return new Map(
      rows.map((r) => [r.account_id, Number(r.debit) - Number(r.credit)]),
    );
  }

  /** Accounts with their parents, ordered by code, each with how deep it sits */
  private async tree(organizationId: string) {
    const accounts = await this.prisma.account.findMany({
      where: { organizationId },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        subtype: true,
        parentId: true,
        archivedAt: true,
      },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const ancestors = (id: string) => {
      const out: string[] = [];
      for (let p = byId.get(id)?.parentId; p; p = byId.get(p)?.parentId)
        out.push(p);
      return out;
    };
    return {
      accounts: accounts.sort((x, y) => compareCodes(x.code, y.code)),
      ancestors,
    };
  }

  /**
   * Rows for a statement: every account with something in any column, parents carrying their sub-accounts'
   * totals. `sign` turns debit-minus-credit into the way the section reads (income and liabilities positive).
   */
  private rows<S extends string>(
    tree: Awaited<ReturnType<ReportsService['tree']>>,
    columns: Map<string, number>[],
    sectionOf: (type: string, subtype: string) => S | null,
    sign: (type: string) => 1 | -1,
  ) {
    const amounts = new Map<string, number[]>();
    const add = (id: string, k: number, v: number) => {
      const a = amounts.get(id) ?? columns.map(() => 0);
      a[k]! += v;
      amounts.set(id, a);
    };
    for (const a of tree.accounts) {
      if (!sectionOf(a.type, a.subtype)) continue;
      columns.forEach((col, k) => {
        const v = (col.get(a.id) ?? 0) * sign(a.type);
        if (!v) return;
        add(a.id, k, v);
        for (const p of tree.ancestors(a.id)) add(p, k, v);
      });
    }
    const parents = new Set(
      tree.accounts.map((a) => a.parentId).filter(Boolean),
    );
    return tree.accounts
      .filter(
        (a) =>
          sectionOf(a.type, a.subtype) &&
          amounts.get(a.id)?.some((v) => v !== 0),
      )
      .map((a) => ({
        section: sectionOf(a.type, a.subtype)!,
        accountId: a.id,
        code: a.code,
        name: a.name,
        depth: tree.ancestors(a.id).length,
        parentId: a.parentId,
        hasChildren: parents.has(a.id),
        amounts: amounts.get(a.id)!,
      }));
  }

  /**
   * The profit and loss for a period: revenue less cost of sales is gross profit, less operating expenses is
   * operating profit, then other income and expenses give the net profit. Year-end closings are left out (they
   * only move the profit to retained earnings). Optionally beside the previous period, last year, or by month.
   */
  async profitAndLoss(
    organizationId: string,
    from: string,
    to: string,
    compare: PnlCompare,
  ) {
    const columns = pnlColumns(from, to, compare);
    const [tree, ...sums] = await Promise.all([
      this.tree(organizationId),
      ...columns.map((c) => this.sums(organizationId, c.from, c.to, true)),
    ]);
    const rows = this.rows<PnlSection>(tree, sums, pnlSectionOf, (type) =>
      type === 'income' ? -1 : 1,
    );
    const total = (section: PnlSection) =>
      columns.map((_c, k) =>
        rows
          .filter((r) => r.section === section && r.depth === 0)
          .reduce((s, r) => s + r.amounts[k]!, 0),
      );
    const t = Object.fromEntries(
      PNL_SECTIONS.map((sec) => [sec, total(sec)]),
    ) as Record<PnlSection, number[]>;
    const gross = columns.map((_c, k) => t.revenue[k]! - t.costOfSales[k]!);
    const operating = columns.map(
      (_c, k) => gross[k]! - t.operatingExpenses[k]!,
    );
    const net = columns.map(
      (_c, k) => operating[k]! + t.otherIncome[k]! - t.otherExpenses[k]!,
    );
    return {
      from,
      to,
      compare,
      columns,
      sections: PNL_SECTIONS.map((sec) => ({
        section: sec,
        rows: rows.filter((r) => r.section === sec),
        total: t[sec],
      })),
      grossProfit: gross,
      operatingProfit: operating,
      netProfit: net,
    };
  }

  /**
   * The balance sheet on a day: assets against liabilities and equity. Profit not yet closed to retained
   * earnings shows in equity (this year's and any earlier year's), so the two sides always agree.
   */
  async balanceSheet(
    organizationId: string,
    asOf: string,
    compareAsOf?: string,
  ) {
    const dates = compareAsOf ? [asOf, compareAsOf] : [asOf];
    const { fiscalYearStartMonth } =
      await this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { fiscalYearStartMonth: true },
      });
    const [tree, ...sums] = await Promise.all([
      this.tree(organizationId),
      ...dates.map((d) => this.sums(organizationId, null, d, false)),
    ]);
    const rows = this.rows<BsSection>(tree, sums, bsSectionOf, (type) =>
      type === 'asset' ? 1 : -1,
    );
    const total = (section: BsSection) =>
      dates.map((_d, k) =>
        rows
          .filter((r) => r.section === section && r.depth === 0)
          .reduce((s, r) => s + r.amounts[k]!, 0),
      );
    // Income less expenses still in the income and expense accounts: this financial year's, and earlier years' not yet closed
    const unclosed = await Promise.all(
      dates.map(async (d) => {
        const yearStart = fiscalYearSpan(
          fiscalYearOf(d, fiscalYearStartMonth),
          fiscalYearStartMonth,
        ).startDate;
        const before = new Date(
          Date.parse(`${yearStart}T00:00:00Z`) - 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        const [all, earlier] = await Promise.all([
          this.sums(organizationId, null, d, false),
          this.sums(organizationId, null, before, false),
        ]);
        const profit = (m: Map<string, number>) =>
          -tree.accounts
            .filter((a) => a.type === 'income' || a.type === 'expense')
            .reduce((s, a) => s + (m.get(a.id) ?? 0), 0);
        return {
          thisYear: profit(all) - profit(earlier),
          earlierYears: profit(earlier),
          yearStart,
        };
      }),
    );
    const t = Object.fromEntries(
      BS_SECTIONS.map((sec) => [sec, total(sec)]),
    ) as Record<BsSection, number[]>;
    const assets = dates.map(
      (_d, k) => t.currentAssets[k]! + t.nonCurrentAssets[k]!,
    );
    const liabilities = dates.map(
      (_d, k) => t.currentLiabilities[k]! + t.nonCurrentLiabilities[k]!,
    );
    const equity = dates.map(
      (_d, k) =>
        t.equity[k]! + unclosed[k]!.thisYear + unclosed[k]!.earlierYears,
    );
    return {
      asOf,
      compareAsOf: compareAsOf ?? null,
      columns: dates,
      sections: BS_SECTIONS.map((sec) => ({
        section: sec,
        rows: rows.filter((r) => r.section === sec),
        total: t[sec],
      })),
      profitThisYear: unclosed.map((u) => u.thisYear),
      profitEarlierYears: unclosed.map((u) => u.earlierYears),
      yearStart: unclosed.map((u) => u.yearStart),
      totalAssets: assets,
      totalLiabilities: liabilities,
      totalEquity: equity,
      balanced: dates.map(
        (_d, k) => assets[k] === liabilities[k]! + equity[k]!,
      ),
    };
  }

  /** A statement as CSV: each account under its section, totals between, amounts in the base currency */
  pnlCsv(
    p: Awaited<ReturnType<ReportsService['profitAndLoss']>>,
    minor: (n: number) => string,
  ) {
    const head = [
      'section',
      'code',
      'account',
      ...p.columns.map((c) => `${c.from}..${c.to}`),
    ];
    const rows: (string | number)[][] = [head];
    const totals: Partial<Record<PnlSection, [string, number[]]>> = {
      costOfSales: ['Gross profit', p.grossProfit],
      operatingExpenses: ['Operating profit', p.operatingProfit],
    };
    for (const sec of p.sections) {
      for (const r of sec.rows)
        rows.push([
          sec.section,
          r.code,
          `${'  '.repeat(r.depth)}${r.name}`,
          ...r.amounts.map(minor),
        ]);
      rows.push([
        sec.section,
        '',
        `Total ${sec.section}`,
        ...sec.total.map(minor),
      ]);
      const after = totals[sec.section];
      if (after) rows.push(['', '', after[0], ...after[1].map(minor)]);
    }
    rows.push(['', '', 'Net profit', ...p.netProfit.map(minor)]);
    return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }

  bsCsv(
    b: Awaited<ReturnType<ReportsService['balanceSheet']>>,
    minor: (n: number) => string,
  ) {
    const rows: (string | number)[][] = [
      ['section', 'code', 'account', ...b.columns],
    ];
    for (const sec of b.sections) {
      for (const r of sec.rows)
        rows.push([
          sec.section,
          r.code,
          `${'  '.repeat(r.depth)}${r.name}`,
          ...r.amounts.map(minor),
        ]);
      if (sec.section === 'equity') {
        rows.push([
          'equity',
          '',
          'Profit for the year to date',
          ...b.profitThisYear.map(minor),
        ]);
        if (b.profitEarlierYears.some((v) => v))
          rows.push([
            'equity',
            '',
            'Earlier years not yet closed',
            ...b.profitEarlierYears.map(minor),
          ]);
        rows.push(['equity', '', 'Total equity', ...b.totalEquity.map(minor)]);
      } else
        rows.push([
          sec.section,
          '',
          `Total ${sec.section}`,
          ...sec.total.map(minor),
        ]);
      if (sec.section === 'nonCurrentAssets')
        rows.push(['', '', 'Total assets', ...b.totalAssets.map(minor)]);
      if (sec.section === 'nonCurrentLiabilities')
        rows.push([
          '',
          '',
          'Total liabilities',
          ...b.totalLiabilities.map(minor),
        ]);
    }
    rows.push([
      '',
      '',
      'Total liabilities and equity',
      ...b.columns.map((_c, k) =>
        minor(b.totalLiabilities[k]! + b.totalEquity[k]!),
      ),
    ]);
    return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }

  /**
   * Where the cash came from and went over a period, two ways. Indirect: net profit, depreciation added back,
   * changes in working capital, then investing (non-current assets) and financing (non-current liabilities
   * and equity). Direct: each movement of cash classified by the accounts on the other side of its entry
   * (split in proportion when there are several); moves between the business's own cash accounts cancel out.
   * Both add up to the change in cash, from the opening to the closing balance.
   */
  async cashFlow(organizationId: string, from: string, to: string) {
    const accounts = await this.prisma.account.findMany({
      where: { organizationId },
      select: { id: true, code: true, name: true, type: true, subtype: true },
    });
    const isCash = (a: { type: string; subtype: string }) =>
      a.type === 'asset' && (a.subtype === 'bank' || a.subtype === 'cash');
    const cashIds = accounts.filter(isCash).map((a) => a.id);
    const dayBefore = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const [moves, opening, closing] = await Promise.all([
      this.sums(organizationId, from, to, true),
      this.sums(organizationId, null, dayBefore, false),
      this.sums(organizationId, null, to, false),
    ]);
    const cashOf = (m: Map<string, number>) =>
      cashIds.reduce((s, id) => s + (m.get(id) ?? 0), 0);
    const change = (a: { id: string }) => moves.get(a.id) ?? 0;
    const netProfit = -accounts
      .filter((a) => a.type === 'income' || a.type === 'expense')
      .reduce((s, a) => s + change(a), 0);
    const depreciation = accounts
      .filter((a) => a.type === 'expense' && a.subtype === 'depreciation')
      .reduce((s, a) => s + change(a), 0);
    const row = (a: (typeof accounts)[number], amount: number) => ({
      accountId: a.id,
      code: a.code,
      name: a.name,
      amount,
    });
    const sorted = (rows: ReturnType<typeof row>[]) =>
      rows
        .filter((r) => r.amount !== 0)
        .sort((x, y) => compareCodes(x.code, y.code));
    // An asset going up uses cash; a liability or equity going up brings it in
    const effect = (a: (typeof accounts)[number]) => -change(a);
    const currentAsset = (a: (typeof accounts)[number]) =>
      a.type === 'asset' &&
      !isCash(a) &&
      bsSectionOf(a.type, a.subtype) === 'currentAssets';
    const workingCapital = sorted(
      accounts
        .filter(
          (a) =>
            currentAsset(a) ||
            (a.type === 'liability' &&
              bsSectionOf(a.type, a.subtype) === 'currentLiabilities'),
        )
        .map((a) => row(a, effect(a))),
    );
    const operating =
      netProfit +
      depreciation +
      workingCapital.reduce((s, r) => s + r.amount, 0);
    const investingRows = sorted(
      accounts
        .filter(
          (a) =>
            a.type === 'asset' &&
            bsSectionOf(a.type, a.subtype) === 'nonCurrentAssets',
        )
        .map((a) => row(a, effect(a))),
    );
    // Depreciation brought those assets down without any cash moving: it was added back above, so take it out here
    const investing =
      investingRows.reduce((s, r) => s + r.amount, 0) - depreciation;
    const financingRows = sorted(
      accounts
        .filter(
          (a) =>
            (a.type === 'liability' &&
              bsSectionOf(a.type, a.subtype) === 'nonCurrentLiabilities') ||
            a.type === 'equity',
        )
        .map((a) => row(a, effect(a))),
    );
    const financing = financingRows.reduce((s, r) => s + r.amount, 0);

    // Direct: the entries that moved cash, and what was on their other side
    const lines = cashIds.length
      ? await this.prisma.$queryRaw<
          { entry_id: string; account_id: string; net: bigint }[]
        >`
          SELECT l.entry_id, l.account_id, (l.debit - l.credit)::bigint AS net
          FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE l.organization_id = ${organizationId}::uuid AND e.status = 'posted' AND e.date >= ${asDate(from)}::date AND e.date <= ${asDate(to)}::date
            AND e.id IN (SELECT entry_id FROM journal_lines WHERE organization_id = ${organizationId}::uuid AND account_id = ANY(${cashIds}::uuid[]))
            AND e.id NOT IN (SELECT closing_entry_id FROM fiscal_years WHERE organization_id = ${organizationId}::uuid AND closing_entry_id IS NOT NULL)`
      : [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const DIRECT = [
      'customers',
      'otherReceipts',
      'vendors',
      'staff',
      'taxes',
      'otherPayments',
      'investing',
      'financing',
    ] as const;
    const direct = Object.fromEntries(DIRECT.map((k) => [k, 0])) as Record<
      (typeof DIRECT)[number],
      number
    >;
    const categoryOf = (
      a: (typeof accounts)[number],
      cashIn: boolean,
    ): (typeof DIRECT)[number] => {
      if (
        a.subtype === 'accounts_receivable' ||
        (a.type === 'income' && a.subtype === 'operating_income')
      )
        return 'customers';
      if (
        a.subtype === 'accounts_payable' ||
        a.subtype === 'credit_card' ||
        ['cost_of_sales', 'operating_expense', 'other_expense'].includes(
          a.subtype,
        )
      )
        return 'vendors';
      if (a.subtype === 'payroll') return 'staff';
      if (a.subtype === 'tax_payable') return 'taxes';
      const section = bsSectionOf(a.type, a.subtype);
      if (section === 'nonCurrentAssets') return 'investing';
      if (section === 'nonCurrentLiabilities' || section === 'equity')
        return 'financing';
      return cashIn ? 'otherReceipts' : 'otherPayments';
    };
    const entries = new Map<string, { account: string; net: number }[]>();
    for (const l of lines)
      entries.set(l.entry_id, [
        ...(entries.get(l.entry_id) ?? []),
        { account: l.account_id, net: Number(l.net) },
      ]);
    for (const ls of entries.values()) {
      const cash = ls
        .filter((l) => cashIds.includes(l.account))
        .reduce((s, l) => s + l.net, 0);
      const others = ls.filter(
        (l) => !cashIds.includes(l.account) && l.net !== 0,
      );
      if (!cash || !others.length) continue;
      const weight = others.reduce((s, l) => s + Math.abs(l.net), 0);
      // Shares are rounded; the last takes what's left so the entry's cash is counted exactly once
      let left = cash;
      others.forEach((l, k) => {
        const share =
          k === others.length - 1
            ? left
            : Math.round((cash * Math.abs(l.net)) / weight);
        left -= share;
        direct[categoryOf(byId.get(l.account)!, cash > 0)] += share;
      });
    }
    const directOperating =
      direct.customers +
      direct.otherReceipts +
      direct.vendors +
      direct.staff +
      direct.taxes +
      direct.otherPayments;
    return {
      from,
      to,
      openingCash: cashOf(opening),
      closingCash: cashOf(closing),
      netChange: cashOf(closing) - cashOf(opening),
      indirect: {
        netProfit,
        depreciation,
        workingCapital,
        operating,
        investingRows,
        investing,
        financingRows,
        financing,
        total: operating + investing + financing,
      },
      direct: {
        ...direct,
        operating: directOperating,
        total: directOperating + direct.investing + direct.financing,
      },
    };
  }

  cashFlowCsv(
    c: Awaited<ReturnType<ReportsService['cashFlow']>>,
    minor: (n: number) => string,
  ) {
    const rows: (string | number)[][] = [['section', 'line', 'amount']];
    const i = c.indirect;
    rows.push(['operating', 'Net profit', minor(i.netProfit)]);
    if (i.depreciation)
      rows.push(['operating', 'Depreciation', minor(i.depreciation)]);
    for (const r of i.workingCapital)
      rows.push([
        'operating',
        `Change in ${r.code} ${r.name}`,
        minor(r.amount),
      ]);
    rows.push([
      'operating',
      'Cash from operating activities',
      minor(i.operating),
    ]);
    for (const r of i.investingRows)
      rows.push(['investing', `${r.code} ${r.name}`, minor(r.amount)]);
    if (i.depreciation)
      rows.push([
        'investing',
        'Less depreciation (no cash)',
        minor(-i.depreciation),
      ]);
    rows.push([
      'investing',
      'Cash from investing activities',
      minor(i.investing),
    ]);
    for (const r of i.financingRows)
      rows.push(['financing', `${r.code} ${r.name}`, minor(r.amount)]);
    rows.push([
      'financing',
      'Cash from financing activities',
      minor(i.financing),
    ]);
    rows.push(
      ['', 'Net change in cash', minor(c.netChange)],
      ['', 'Cash at the start', minor(c.openingCash)],
      ['', 'Cash at the end', minor(c.closingCash)],
    );
    return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }
}
