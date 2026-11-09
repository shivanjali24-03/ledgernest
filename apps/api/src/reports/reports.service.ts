import { Injectable, NotFoundException } from '@nestjs/common';
import { compareCodes, csvCell, journalNumber, NORMAL_SIDE, type AccountType } from '@ledgernest/shared';
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
    const account = await this.prisma.account.findFirst({ where: { id: accountId, organizationId }, select: { id: true, code: true, name: true, type: true } });
    if (!account) throw new NotFoundException('Account not found.');
    const normal = NORMAL_SIDE[account.type as AccountType];
    // Balances are shown on the account's normal side: a positive bank balance is money in the bank
    const signed = (debit: number, credit: number) => (normal === 'debit' ? debit - credit : credit - debit);

    const [opening] = await this.prisma.$queryRaw<{ debit: bigint | null; credit: bigint | null }[]>`
      SELECT sum(l.debit)::bigint AS debit, sum(l.credit)::bigint AS credit
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.organization_id = ${organizationId}::uuid AND l.account_id = ${accountId}::uuid AND e.status = 'posted' AND e.date < ${asDate(from)}::date`;
    // One join in SQL: loading entries per line through the ORM would send every line id as a parameter
    const lines = await this.prisma.$queryRaw<{ id: string; description: string | null; debit: bigint; credit: bigint; entry_id: string; date: Date; number: number | null; memo: string | null; reference: string | null; year_name: string | null }[]>`
      SELECT l.id, l.description, l.debit, l.credit, e.id AS entry_id, e.date, e.number, e.memo, e.reference, y.name AS year_name
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      LEFT JOIN fiscal_years y ON y.id = e.fiscal_year_id
      WHERE l.organization_id = ${organizationId}::uuid AND l.account_id = ${accountId}::uuid AND e.status = 'posted'
        AND e.date BETWEEN ${asDate(from)}::date AND ${asDate(to)}::date
      ORDER BY e.date, e.number, l.line_no`;
    let balance = signed(Number(opening?.debit ?? 0), Number(opening?.credit ?? 0));
    const openingBalance = balance;
    let debit = 0;
    let credit = 0;
    const rows = lines.map((l) => {
      const d = Number(l.debit);
      const c = Number(l.credit);
      debit += d;
      credit += c;
      balance += signed(d, c);
      return { lineId: l.id, entryId: l.entry_id, number: l.number && l.year_name ? journalNumber(l.year_name, l.number) : null, date: iso(l.date), memo: l.memo, reference: l.reference, description: l.description, debit: d, credit: c, balance };
    });
    return { account: { ...account, normalSide: normal }, from, to, openingBalance, rows, totals: { debit, credit }, closingBalance: balance };
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
