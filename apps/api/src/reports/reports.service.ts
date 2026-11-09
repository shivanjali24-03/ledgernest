import { Injectable, NotFoundException } from '@nestjs/common';
import { compareCodes, csvCell, formatRate, journalNumber, normaliseRate, NORMAL_SIDE, type AccountType, type TaxKind } from '@ledgernest/shared';
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
      this.prisma.account.findMany({ where: { organizationId }, select: { id: true, code: true, name: true, type: true, archivedAt: true } }),
      this.prisma.$queryRaw<{ account_id: string; debit: bigint; credit: bigint }[]>`
        SELECT l.account_id, sum(l.debit)::bigint AS debit, sum(l.credit)::bigint AS credit
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.organization_id = ${organizationId}::uuid AND e.status = 'posted' AND e.date <= ${asDate(asOf)}::date
        GROUP BY l.account_id`,
    ]);
    const byAccount = new Map(sums.map((s) => [s.account_id, { debit: Number(s.debit), credit: Number(s.credit) }]));
    const rows = accounts
      .map((a) => {
        const s = byAccount.get(a.id) ?? { debit: 0, credit: 0 };
        const net = s.debit - s.credit;
        return { accountId: a.id, code: a.code, name: a.name, type: a.type as AccountType, normalSide: NORMAL_SIDE[a.type as AccountType], archived: a.archivedAt !== null, debit: s.debit, credit: s.credit, balanceDebit: net > 0 ? net : 0, balanceCredit: net < 0 ? -net : 0 };
      })
      // Accounts with activity, plus active ones (so a new chart still shows its accounts at zero)
      .filter((r) => r.debit || r.credit || !r.archived)
      .sort((x, y) => compareCodes(x.code, y.code));
    const totals = rows.reduce((t, r) => ({ debit: t.debit + r.debit, credit: t.credit + r.credit, balanceDebit: t.balanceDebit + r.balanceDebit, balanceCredit: t.balanceCredit + r.balanceCredit }), { debit: 0, credit: 0, balanceDebit: 0, balanceCredit: 0 });
    return { asOf, rows, totals, balanced: totals.debit === totals.credit && totals.balanceDebit === totals.balanceCredit };
  }

  /** One account's posted lines in a date range, with the balance carried in and a running balance. */
  async ledger(organizationId: string, accountId: string, from: string, to: string) {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, organizationId }, select: { id: true, code: true, name: true, type: true, currency: true } });
    if (!account) throw new NotFoundException('Account not found.');
    const normal = NORMAL_SIDE[account.type as AccountType];
    // Balances are shown on the account's normal side: a positive bank balance is money in the bank
    const signed = (debit: number, credit: number) => (normal === 'debit' ? debit - credit : credit - debit);

    const [opening] = await this.prisma.$queryRaw<{ debit: bigint | null; credit: bigint | null; foreign: bigint | null }[]>`
      SELECT sum(l.debit)::bigint AS debit, sum(l.credit)::bigint AS credit, sum(l.foreign_debit - l.foreign_credit)::bigint AS foreign
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.organization_id = ${organizationId}::uuid AND l.account_id = ${accountId}::uuid AND e.status = 'posted' AND e.date < ${asDate(from)}::date`;
    // One join in SQL: loading entries per line through the ORM would send every line id as a parameter
    const lines = await this.prisma.$queryRaw<{ id: string; description: string | null; debit: bigint; credit: bigint; foreign_debit: bigint; foreign_credit: bigint; rate: string | null; entry_id: string; date: Date; number: number | null; memo: string | null; reference: string | null; year_name: string | null }[]>`
      SELECT l.id, l.description, l.debit, l.credit, l.foreign_debit, l.foreign_credit, l.rate::text AS rate, e.id AS entry_id, e.date, e.number, e.memo, e.reference, y.name AS year_name
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      LEFT JOIN fiscal_years y ON y.id = e.fiscal_year_id
      WHERE l.organization_id = ${organizationId}::uuid AND l.account_id = ${accountId}::uuid AND e.status = 'posted'
        AND e.date BETWEEN ${asDate(from)}::date AND ${asDate(to)}::date
      ORDER BY e.date, e.number, l.line_no`;
    let balance = signed(Number(opening?.debit ?? 0), Number(opening?.credit ?? 0));
    const openingBalance = balance;
    // Foreign-currency accounts also run their balance in that currency, on the same normal side
    let foreignBalance = (normal === 'debit' ? 1 : -1) * Number(opening?.foreign ?? 0);
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
      const row = { lineId: l.id, entryId: l.entry_id, number: l.number && l.year_name ? journalNumber(l.year_name, l.number) : null, date: iso(l.date), memo: l.memo, reference: l.reference, description: l.description, debit: d, credit: c, balance };
      return account.currency ? { ...row, foreignDebit: fd, foreignCredit: fc, rate: l.rate && normaliseRate(l.rate), foreignBalance } : row;
    });
    return {
      account: { ...account, normalSide: normal },
      from,
      to,
      openingBalance,
      rows,
      totals: { debit, credit },
      closingBalance: balance,
      ...(account.currency && { foreign: { currency: account.currency, openingBalance: openingForeign, closingBalance: foreignBalance } }),
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
      this.prisma.$queryRaw<{ group_id: string; role: 'input' | 'output'; taxable_cr: bigint; tax_cr: bigint }[]>`
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
      this.prisma.$queryRaw<{ rate_id: string; role: 'input' | 'output'; cr: bigint }[]>`
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
      this.prisma.taxGroup.findMany({ where: { organizationId, id: { in: groupIds } }, select: { id: true, name: true, supply: true, rates: { select: { rate: { select: { ratePpm: true } } } } } }),
      this.prisma.taxRate.findMany({ where: { organizationId, id: { in: rateIds } }, select: { id: true, name: true, kind: true, ratePpm: true } }),
    ]);

    // Output figures are credits; input figures are debits, so their sign flips
    const groups = groupRows
      .map((g) => {
        const sum = (role: 'input' | 'output') => {
          const r = groupSums.find((x) => x.group_id === g.id && x.role === role);
          const sign = role === 'output' ? 1 : -1;
          return { taxable: sign * Number(r?.taxable_cr ?? 0), tax: sign * Number(r?.tax_cr ?? 0) };
        };
        const totalPpm = g.rates.reduce((t, r) => t + r.rate.ratePpm, 0);
        return { id: g.id, name: g.name, supply: g.supply as 'intra' | 'inter' | null, totalPpm, total: formatRate(totalPpm), outward: sum('output'), inward: sum('input') };
      })
      .sort((a, b) => a.totalPpm - b.totalPpm || a.name.localeCompare(b.name));
    const rates = rateRows
      .map((r) => {
        const output = Number(rateSums.find((x) => x.rate_id === r.id && x.role === 'output')?.cr ?? 0);
        const input = -Number(rateSums.find((x) => x.rate_id === r.id && x.role === 'input')?.cr ?? 0);
        return { id: r.id, name: r.name, kind: r.kind as TaxKind, rate: formatRate(r.ratePpm), ratePpm: r.ratePpm, output, input, net: output - input };
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.ratePpm - b.ratePpm || a.name.localeCompare(b.name));
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

  taxSummaryCsv(t: Awaited<ReturnType<ReportsService['taxSummary']>>, minor: (n: number) => string) {
    const rows: (string | null)[][] = [
      ['tax_group', 'rate', 'outward_taxable_value', 'output_tax', 'inward_taxable_value', 'input_tax'],
      ...t.groups.map((g) => [g.name, g.total, minor(g.outward.taxable), minor(g.outward.tax), minor(g.inward.taxable), minor(g.inward.tax)]),
      ['Total', '', minor(t.totals.outwardTaxable), minor(t.totals.output), minor(t.totals.inwardTaxable), minor(t.totals.input)],
      [],
      ['tax', 'rate', 'output_tax', 'input_tax', 'net_payable'],
      ...t.rates.map((r) => [r.name, r.rate, minor(r.output), minor(r.input), minor(r.net)]),
      ['Total', '', minor(t.totals.output), minor(t.totals.input), minor(t.totals.net)],
    ];
    return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }

  /** Amounts for CSV in the currency's own decimals (JPY has none, KWD three). */
  async decimals(organizationId: string) {
    const { baseCurrency } = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { baseCurrency: true } });
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: baseCurrency }).resolvedOptions().maximumFractionDigits ?? 2;
    return (n: number) => (n / 10 ** digits).toFixed(digits);
  }

  /** The trial balance as CSV, safe to open in a spreadsheet. */
  trialBalanceCsv(tb: Awaited<ReturnType<ReportsService['trialBalance']>>, minor: (n: number) => string) {
    const header = ['code', 'account', 'type', 'debits', 'credits', 'balance_debit', 'balance_credit'];
    const lines = tb.rows.map((r) => [r.code, r.name, r.type, minor(r.debit), minor(r.credit), minor(r.balanceDebit), minor(r.balanceCredit)].map(csvCell).join(','));
    lines.push(['', 'Total', '', minor(tb.totals.debit), minor(tb.totals.credit), minor(tb.totals.balanceDebit), minor(tb.totals.balanceCredit)].map(csvCell).join(','));
    return `﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
  }

  ledgerCsv(l: Awaited<ReturnType<ReportsService['ledger']>>, minor: (n: number) => string) {
    const header = ['date', 'number', 'memo', 'reference', 'description', 'debit', 'credit', 'balance'];
    const rows = [['', '', 'Opening balance', '', '', '', '', minor(l.openingBalance)], ...l.rows.map((r) => [r.date, r.number, r.memo, r.reference, r.description, minor(r.debit), minor(r.credit), minor(r.balance)]), ['', '', 'Closing balance', '', '', minor(l.totals.debit), minor(l.totals.credit), minor(l.closingBalance)]];
    return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }
}
