import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  currencyDigits,
  splitTax,
  todayIn,
  toBase,
  type BankTransactionKind,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { bankMoneySchema, bankTransferSchema } from '@ledgernest/shared';
import type { Actor, Tenant } from '../access/types.js';
import { ensureFxAccount } from '../accounts/system-accounts.js';
import { ApprovalGate } from '../approvals/approval-gate.js';
import { AuditService } from '../audit/audit.service.js';
import { rateOn, rateText } from '../currencies/rate-on.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReportsService } from '../reports/reports.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type MoneyIn = z.output<typeof bankMoneySchema>;
type TransferIn = z.output<typeof bankTransferSchema>;

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const entryRef = {
  select: { id: true, number: true, fiscalYear: { select: { name: true } } },
} as const;
const entryLabel = (
  e: { number: number | null; fiscalYear: { name: string } | null } | null,
) =>
  e?.number && e.fiscalYear
    ? `JV/${e.fiscalYear.name.replace(/^FY\s*/, '').replace('–', '-')}/${String(e.number).padStart(4, '0')}`
    : null;
const accountRef = {
  select: { id: true, code: true, name: true, currency: true },
} as const;

const select = {
  id: true,
  kind: true,
  status: true,
  date: true,
  reference: true,
  description: true,
  currency: true,
  amount: true,
  toCurrency: true,
  toAmount: true,
  rate: true,
  taxInclusive: true,
  lines: true,
  createdAt: true,
  voidedAt: true,
  bankAccount: accountRef,
  toAccount: accountRef,
  contact: { select: { id: true, name: true } },
  journalEntry: entryRef,
  voidEntry: entryRef,
} as const;
type Row = Prisma.BankTransactionGetPayload<{ select: typeof select }>;

/** Bank and cash accounts: what's in them, what moved, and money in or out that isn't an invoice or bill. */
@Injectable()
export class BankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
    private readonly reports: ReportsService,
    private readonly approvals: ApprovalGate,
  ) {}

  private view(t: Row) {
    return {
      id: t.id,
      kind: t.kind as BankTransactionKind,
      status: t.status as 'posted' | 'void',
      date: iso(t.date),
      reference: t.reference,
      description: t.description,
      bankAccount: t.bankAccount,
      toAccount: t.toAccount,
      contact: t.contact,
      currency: t.currency,
      amount: Number(t.amount),
      toCurrency: t.toCurrency,
      toAmount: t.toAmount === null ? null : Number(t.toAmount),
      rate: t.rate && rateText(t.rate),
      taxInclusive: t.taxInclusive,
      lines: (t.lines ?? []) as {
        accountId: string;
        amount: number;
        taxGroupId: string | null;
        description: string | null;
      }[],
      journalEntry: {
        id: t.journalEntry.id,
        number: entryLabel(t.journalEntry),
      },
      voidEntry: t.voidEntry && {
        id: t.voidEntry.id,
        number: entryLabel(t.voidEntry),
      },
      createdAt: t.createdAt,
    };
  }

  /** An active bank or cash account of this organisation */
  private async bankAccount(
    db: Tx | PrismaService,
    organizationId: string,
    id: string,
    field = 'bankAccountId',
  ) {
    const a = await db.account.findFirst({
      where: { organizationId, id },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        subtype: true,
        currency: true,
        archivedAt: true,
      },
    });
    if (!a || a.type !== 'asset' || !['bank', 'cash'].includes(a.subtype))
      throw refuse(
        BadRequestException,
        'Choose a bank or cash account.',
        'bank_invalid',
        { field },
      );
    if (a.archivedAt)
      throw refuse(
        BadRequestException,
        'This account is archived.',
        'account_archived',
        { field },
      );
    return a;
  }

  /** Every bank and cash account with its balance (in its own currency too), and when money last moved. */
  async accounts(organizationId: string) {
    const accounts = await this.prisma.account.findMany({
      where: {
        organizationId,
        type: 'asset',
        subtype: { in: ['bank', 'cash'] },
      },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        subtype: true,
        currency: true,
        archivedAt: true,
        parentId: true,
      },
    });
    const sums = await this.prisma.$queryRaw<
      {
        account_id: string;
        balance: bigint;
        foreign: bigint;
        last: Date | null;
        recent: bigint;
      }[]
    >`
      SELECT l.account_id,
             sum(l.debit - l.credit)::bigint AS balance,
             coalesce(sum(l.foreign_debit - l.foreign_credit), 0)::bigint AS foreign,
             max(e.date) AS last,
             count(*) FILTER (WHERE e.date > current_date - 30)::bigint AS recent
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.organization_id = ${organizationId}::uuid AND e.status = 'posted' AND l.account_id = ANY(${accounts.map((a) => a.id)}::uuid[])
      GROUP BY l.account_id`;
    const by = new Map(sums.map((s) => [s.account_id, s]));
    return accounts
      .map((a) => {
        const s = by.get(a.id);
        return {
          id: a.id,
          code: a.code,
          name: a.name,
          subtype: a.subtype as 'bank' | 'cash',
          currency: a.currency,
          archived: !!a.archivedAt,
          hasChildren: accounts.some((c) => c.parentId === a.id),
          balance: Number(s?.balance ?? 0),
          foreignBalance: a.currency ? Number(s?.foreign ?? 0) : null,
          lastActivity: s?.last ? iso(s.last) : null,
          recentMovements: Number(s?.recent ?? 0),
        };
      })
      .filter((a) => !a.archived || a.balance !== 0);
  }

  /** What moved through one account between two days, with balances: the ledger, read as a bank statement */
  async activity(
    organizationId: string,
    accountId: string,
    from: string,
    to: string,
  ) {
    await this.bankAccount(
      this.prisma,
      organizationId,
      accountId,
      'accountId',
    ).catch((e: unknown) => {
      if (
        (e as { response?: { details?: { reason?: string } } }).response
          ?.details?.reason === 'account_archived'
      )
        return;
      throw e;
    });
    return this.reports.ledger(organizationId, accountId, from, to);
  }

  async list(
    organizationId: string,
    q: {
      bankAccountId?: string;
      kind?: BankTransactionKind;
      page: number;
      pageSize: number;
    },
  ) {
    const where: Prisma.BankTransactionWhereInput = {
      organizationId,
      ...(q.kind && { kind: q.kind }),
      ...(q.bankAccountId && {
        OR: [
          { bankAccountId: q.bankAccountId },
          { toAccountId: q.bankAccountId },
        ],
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.bankTransaction.count({ where }),
      this.prisma.bankTransaction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => this.view(r)),
    };
  }

  async get(organizationId: string, id: string) {
    const t = await this.prisma.bankTransaction.findFirst({
      where: { organizationId, id },
      select,
    });
    if (!t) throw new NotFoundException('Transaction not found.');
    return this.view(t);
  }

  /** Spends or receives money: the bank against each line's account, with its tax worked out like any journal line. */
  /**
   * Money spent or received. Spending from the app is held for an approver when a rule covers it; recording
   * what a bank statement shows (fromStatement) isn't, as the money has already gone.
   */
  async money(
    input: MoneyIn,
    ctx: Ctx,
    opts: { approved?: boolean; fromStatement?: boolean } = {},
  ) {
    const organizationId = ctx.tenant.organizationId;
    const spend = input.kind === 'spend';
    if (spend && !opts.fromStatement) {
      const bank = await this.prisma.account.findFirst({
        where: { organizationId, id: input.bankAccountId },
        select: { name: true, currency: true },
      });
      if (bank)
        await this.approvals.check(
          'bank_spend',
          {
            documentId: null,
            amount: await this.approvals.inBase(
              organizationId,
              input.lines.reduce((s, l) => s + l.amount, 0),
              bank.currency,
              input.date,
              input.rate,
            ),
            summary: `Money spent from ${bank.name}${input.description ? `: ${input.description}` : ''}`,
            payload: input as unknown as Prisma.InputJsonValue,
          },
          ctx,
          opts,
        );
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const bank = await this.bankAccount(
        tx,
        organizationId,
        input.bankAccountId,
      );
      if (
        input.contactId &&
        !(await tx.contact.findFirst({
          where: { organizationId, id: input.contactId },
          select: { id: true },
        }))
      )
        throw refuse(
          BadRequestException,
          'That contact doesn’t exist.',
          'contact_not_found',
          { field: 'contactId' },
        );
      const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
      const accounts = await tx.account.findMany({
        where: { organizationId, id: { in: accountIds } },
        select: { id: true, subtype: true, archivedAt: true, currency: true },
      });
      input.lines.forEach((l, n) => {
        const a = accounts.find((x) => x.id === l.accountId);
        if (!a)
          throw refuse(
            BadRequestException,
            `Line ${n + 1}: that account doesn’t exist.`,
            'account_not_found',
            { line: n + 1 },
          );
        if (a.id === bank.id)
          throw refuse(
            BadRequestException,
            `Line ${n + 1}: money can’t go to the account it comes from.`,
            'same_account',
            { line: n + 1 },
          );
        if (a.archivedAt)
          throw refuse(
            BadRequestException,
            `Line ${n + 1}: that account is archived.`,
            'account_archived',
            { line: n + 1 },
          );
        // Customers and vendors are settled through invoices, bills and their payments, so balances stay right
        if (['accounts_receivable', 'accounts_payable'].includes(a.subtype))
          throw refuse(
            BadRequestException,
            `Line ${n + 1}: record a receipt or payment for customers and vendors.`,
            'use_documents',
            { line: n + 1 },
          );
        if (a.currency && a.currency !== bank.currency)
          throw refuse(
            BadRequestException,
            `Line ${n + 1}: that account is kept in ${a.currency}.`,
            'account_currency',
            { line: n + 1 },
          );
      });
      if (bank.currency && input.lines.some((l) => l.taxGroupId))
        throw refuse(
          BadRequestException,
          'Tax can only be charged on money in the base currency.',
          'tax_foreign',
        );
      const groupIds = [
        ...new Set(
          input.lines.map((l) => l.taxGroupId).filter((g): g is string => !!g),
        ),
      ];
      const groups = await tx.taxGroup.findMany({
        where: { organizationId, id: { in: groupIds } },
        select: {
          id: true,
          archivedAt: true,
          rates: {
            orderBy: { position: 'asc' },
            select: { rate: { select: { id: true, ratePpm: true } } },
          },
        },
      });
      if (groups.length !== groupIds.length || groups.some((g) => g.archivedAt))
        throw refuse(
          BadRequestException,
          'Choose an active tax group.',
          'tax_group_invalid',
        );
      // What leaves (or arrives in) the bank: each line, plus its tax unless the amounts include it
      const gross = (l: MoneyIn['lines'][number]) => {
        const g = groups.find((x) => x.id === l.taxGroupId);
        if (!g || input.taxInclusive) return l.amount;
        return (
          l.amount +
          splitTax(
            l.amount,
            false,
            g.rates.map((r) => ({
              rateId: r.rate.id,
              ratePpm: r.rate.ratePpm,
            })),
          ).taxes.reduce((s, t) => s + t.amount, 0)
        );
      };
      const total = input.lines.reduce((s, l) => s + gross(l), 0);

      const { baseCurrency } = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { baseCurrency: true },
      });
      let rate: string | null = null;
      if (bank.currency) {
        rate =
          input.rate ??
          (await rateOn(tx, organizationId, bank.currency, input.date))?.rate ??
          null;
        if (!rate)
          throw refuse(
            BadRequestException,
            `There is no ${bank.currency} rate on or before ${input.date}. Add one under Currencies, or type the rate.`,
            'no_rate',
            { currency: bank.currency, date: input.date },
          );
      }
      const base = (minor: number) =>
        bank.currency
          ? toBase(
              minor,
              rate!,
              currencyDigits(bank.currency),
              currencyDigits(baseCurrency),
            )
          : minor;
      const side = (minor: number, debit: boolean) =>
        debit ? { debit: minor, credit: 0 } : { debit: 0, credit: minor };
      const memo =
        input.description ?? (spend ? 'Money spent' : 'Money received');
      const lines: Record<string, unknown>[] = input.lines.map((l) => ({
        accountId: l.accountId,
        description: l.description ?? memo,
        ...side(base(l.amount), spend),
        taxGroupId: l.taxGroupId,
        taxInclusive: !!l.taxGroupId && input.taxInclusive,
        costCentreId: l.costCentreId,
      }));
      const bankLine = bank.currency
        ? {
            accountId: bank.id,
            description: memo,
            debit: 0,
            credit: 0,
            currency: bank.currency,
            foreignDebit: spend ? 0 : total,
            foreignCredit: spend ? total : 0,
            rate,
          }
        : { accountId: bank.id, description: memo, ...side(total, !spend) };
      if (bank.currency) {
        // Converting each line and the total separately can differ by a paisa: book it as an exchange difference
        const diff =
          base(total) - input.lines.reduce((s, l) => s + base(l.amount), 0);
        if (diff)
          lines.push({
            accountId: await ensureFxAccount(tx, organizationId, 'fx_realised'),
            description: 'Rounding',
            ...side(Math.abs(diff), spend ? diff > 0 : diff < 0),
          });
      }
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: input.date,
          memo,
          reference: input.reference,
          lines: (spend ? [...lines, bankLine] : [bankLine, ...lines]) as never,
        },
        ctx.actor.userId,
      );
      const t = await tx.bankTransaction.create({
        data: {
          organizationId,
          kind: input.kind,
          bankAccountId: bank.id,
          date: asDate(input.date),
          contactId: input.contactId,
          reference: input.reference,
          description: input.description,
          currency: bank.currency,
          amount: BigInt(total),
          rate,
          taxInclusive: input.taxInclusive,
          lines: input.lines as unknown as Prisma.InputJsonValue,
          journalEntryId: entry.id,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: spend ? 'org.banking.spend' : 'org.banking.receive',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bank_transaction',
          entityId: t.id,
          after: {
            account: `${bank.code} ${bank.name}`,
            amount: total,
            currency: bank.currency,
            entry: entry.number,
            description: input.description,
          },
          req: ctx.req,
        },
        tx,
      );
      return t.id;
    });
    return this.get(organizationId, id);
  }

  /**
   * Moves money between two bank or cash accounts. In one currency it's the same amount out and in. Between
   * currencies, each side is valued at its own rate to the base currency, and what's left over is an exchange
   * difference: a loss when what arrived is worth less than what left.
   */
  async transfer(input: TransferIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      const from = await this.bankAccount(
        tx,
        organizationId,
        input.fromAccountId,
        'fromAccountId',
      );
      const to = await this.bankAccount(
        tx,
        organizationId,
        input.toAccountId,
        'toAccountId',
      );
      const same = from.currency === to.currency;
      if (!same && !input.toAmount)
        throw refuse(
          BadRequestException,
          `The accounts are in different currencies: enter what arrived in ${to.currency ?? 'the base currency'}.`,
          'to_amount_required',
          { field: 'toAmount' },
        );
      if (same && input.toAmount !== null && input.toAmount !== input.amount)
        throw refuse(
          BadRequestException,
          'Both accounts are in the same currency, so the same amount arrives.',
          'to_amount_differs',
          { field: 'toAmount' },
        );
      const toAmount = same ? input.amount : input.toAmount!;
      const { baseCurrency } = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { baseCurrency: true },
      });
      const rateFor = async (
        currency: string | null,
        given: string | null,
        field: string,
      ) => {
        if (!currency) return null;
        const r =
          given ??
          (await rateOn(tx, organizationId, currency, input.date))?.rate ??
          null;
        if (!r)
          throw refuse(
            BadRequestException,
            `There is no ${currency} rate on or before ${input.date}. Add one under Currencies, or type the rate.`,
            'no_rate',
            { currency, date: input.date, field },
          );
        return r;
      };
      const fromRate = await rateFor(from.currency, input.fromRate, 'fromRate');
      const toRate = same
        ? fromRate
        : await rateFor(to.currency, input.toRate, 'toRate');
      const inBase = (
        minor: number,
        currency: string | null,
        rate: string | null,
      ) =>
        currency
          ? toBase(
              minor,
              rate!,
              currencyDigits(currency),
              currencyDigits(baseCurrency),
            )
          : minor;
      const outBase = inBase(input.amount, from.currency, fromRate);
      const inBaseValue = inBase(toAmount, to.currency, toRate);
      const memo = input.description ?? `Transfer ${from.code} → ${to.code}`;
      const leg = (
        a: typeof from,
        minor: number,
        rate: string | null,
        debit: boolean,
      ) =>
        a.currency
          ? {
              accountId: a.id,
              description: memo,
              debit: 0,
              credit: 0,
              currency: a.currency,
              foreignDebit: debit ? minor : 0,
              foreignCredit: debit ? 0 : minor,
              rate,
            }
          : {
              accountId: a.id,
              description: memo,
              debit: debit ? minor : 0,
              credit: debit ? 0 : minor,
            };
      const lines: Record<string, unknown>[] = [
        leg(to, toAmount, toRate, true),
        leg(from, input.amount, fromRate, false),
      ];
      const diff = outBase - inBaseValue;
      if (diff)
        lines.push({
          accountId: await ensureFxAccount(tx, organizationId, 'fx_realised'),
          description: `${memo}: exchange difference`,
          debit: diff > 0 ? diff : 0,
          credit: diff < 0 ? -diff : 0,
        });
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: input.date,
          memo,
          reference: input.reference,
          lines: lines as never,
        },
        ctx.actor.userId,
      );
      // The rate the bank applied, as 1 foreign unit in the other currency (base per foreign when one side is base)
      const units = (minor: number, currency: string | null) =>
        minor / 10 ** currencyDigits(currency ?? baseCurrency);
      const sent = units(input.amount, from.currency);
      const got = units(toAmount, to.currency);
      const cross = same
        ? null
        : (!from.currency ? sent / got : got / sent).toFixed(6);
      const t = await tx.bankTransaction.create({
        data: {
          organizationId,
          kind: 'transfer',
          bankAccountId: from.id,
          toAccountId: to.id,
          date: asDate(input.date),
          reference: input.reference,
          description: input.description,
          currency: from.currency,
          amount: BigInt(input.amount),
          toCurrency: to.currency,
          toAmount: BigInt(toAmount),
          rate: cross,
          journalEntryId: entry.id,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: 'org.banking.transfer',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bank_transaction',
          entityId: t.id,
          after: {
            from: `${from.code} ${from.name}`,
            to: `${to.code} ${to.name}`,
            amount: input.amount,
            currency: from.currency,
            toAmount,
            toCurrency: to.currency,
            exchangeDifference: diff,
            entry: entry.number,
          },
          req: ctx.req,
        },
        tx,
      );
      return t.id;
    });
    return this.get(organizationId, id);
  }

  /** Voids a bank transaction: its entry is reversed (on the day given, default today) and it stays on record. */
  async void(id: string, input: { date?: string; reason?: string }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    await this.prisma.$transaction(async (tx) => {
      const t = await tx.bankTransaction.findFirst({
        where: { organizationId, id },
        select: {
          id: true,
          kind: true,
          status: true,
          journalEntryId: true,
          description: true,
        },
      });
      if (!t) throw new NotFoundException('Transaction not found.');
      if (t.status === 'void')
        throw refuse(
          ConflictException,
          'This is already void.',
          'already_void',
        );
      const r = await this.journals.reverseInTx(
        tx,
        organizationId,
        t.journalEntryId,
        ctx.actor.userId,
        {
          date: input.date ?? todayIn(timeZone),
          memo: `${t.description ?? 'Bank transaction'} voided${input.reason ? `: ${input.reason}` : ''}`,
        },
      );
      await tx.bankTransaction.update({
        where: { id },
        data: { status: 'void', voidEntryId: r.id, voidedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'org.banking.void',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bank_transaction',
          entityId: id,
          after: {
            kind: t.kind,
            reversal: r.number,
            reason: input.reason ?? null,
          },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }
}
