import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  creditNoteNumber,
  currencyDigits,
  formatQuantity,
  invoiceAmounts,
  invoiceNumber,
  journalNumber,
  parseQuantity,
  splitTax,
  todayIn,
  toBase,
  type CreditApplyInput,
  type CreditNoteInput,
  type CreditRefundInput,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { ensureFxAccount } from '../accounts/system-accounts.js';
import { AuditService } from '../audit/audit.service.js';
import { rateOn, rateText } from '../currencies/rate-on.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const entryRef = {
  select: {
    id: true,
    number: true,
    date: true,
    fiscalYear: { select: { name: true } },
  },
} as const;
const entryLabel = (
  e: { number: number | null; fiscalYear: { name: string } | null } | null,
) =>
  e?.number && e.fiscalYear ? journalNumber(e.fiscalYear.name, e.number) : null;
const invoiceRef = {
  select: { id: true, number: true, fiscalYear: { select: { name: true } } },
} as const;
const invoiceLabel = (i: {
  number: number | null;
  fiscalYear: { name: string } | null;
}) =>
  i.number && i.fiscalYear ? invoiceNumber(i.fiscalYear.name, i.number) : null;

const select = {
  id: true,
  number: true,
  status: true,
  date: true,
  currency: true,
  rate: true,
  reason: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  applied: true,
  createdAt: true,
  voidedAt: true,
  fiscalYear: { select: { name: true } },
  contact: { select: { id: true, name: true } },
  invoice: invoiceRef,
  receivableAccount: { select: { id: true, code: true, name: true } },
  journalEntry: entryRef,
  voidEntry: entryRef,
  lines: {
    orderBy: { lineNo: 'asc' as const },
    select: {
      id: true,
      lineNo: true,
      invoiceLineId: true,
      description: true,
      quantity: true,
      unitPrice: true,
      discountPpm: true,
      amount: true,
      taxAmount: true,
      account: { select: { id: true, code: true, name: true } },
      taxGroup: {
        select: {
          id: true,
          name: true,
          rates: {
            orderBy: { position: 'asc' as const },
            select: {
              rate: { select: { id: true, name: true, ratePpm: true } },
            },
          },
        },
      },
    },
  },
  applications: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      date: true,
      amount: true,
      rate: true,
      reference: true,
      invoice: invoiceRef,
      journalEntry: entryRef,
      bankAccount: { select: { id: true, code: true, name: true } },
    },
  },
} as const;
type Row = Prisma.CreditNoteGetPayload<{ select: typeof select }>;

/**
 * Credit notes correct issued invoices. Each posts the opposite of the lines it takes back, at the invoice's own
 * rate, so income and output tax come down and so does what the customer owes. The credit goes onto the invoice
 * first; what's left is the customer's, to put on another invoice or pay back.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
  ) {}

  /** Invoices first (credit changes what they have left to pay), then payments: the order everything takes them in */
  private async lock(tx: Tx, organizationId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoices:' + organizationId}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payments:' + organizationId}))`;
  }

  private async today(organizationId: string) {
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    return todayIn(timeZone);
  }

  private view(c: Row) {
    const breakdown = new Map<string, number>();
    for (const l of c.lines) {
      if (!l.taxGroup) continue;
      const parts = splitTax(
        Number(l.amount),
        false,
        l.taxGroup.rates.map((r) => ({
          rateId: r.rate.id,
          ratePpm: r.rate.ratePpm,
        })),
      ).taxes;
      parts.forEach((p, k) =>
        breakdown.set(
          l.taxGroup!.rates[k]!.rate.name,
          (breakdown.get(l.taxGroup!.rates[k]!.rate.name) ?? 0) + p.amount,
        ),
      );
    }
    const live = c.status === 'issued';
    return {
      id: c.id,
      number: creditNoteNumber(c.fiscalYear.name, c.number),
      status: c.status as 'issued' | 'void',
      date: iso(c.date),
      contact: c.contact,
      invoice: { id: c.invoice.id, number: invoiceLabel(c.invoice) },
      currency: c.currency,
      rate: c.rate && rateText(c.rate),
      reason: c.reason,
      receivableAccount: c.receivableAccount,
      subtotal: Number(c.subtotal),
      taxTotal: Number(c.taxTotal),
      total: Number(c.total),
      applied: Number(c.applied),
      /** Credit still to apply or refund */
      remaining: live ? Number(c.total - c.applied) : 0,
      taxBreakdown: [...breakdown].map(([name, amount]) => ({ name, amount })),
      journalEntry: {
        id: c.journalEntry.id,
        number: entryLabel(c.journalEntry),
      },
      voidEntry: c.voidEntry && {
        id: c.voidEntry.id,
        number: entryLabel(c.voidEntry),
      },
      lines: c.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        invoiceLineId: l.invoiceLineId,
        description: l.description,
        quantity: formatQuantity(parseQuantity(l.quantity.toFixed(4))!),
        unitPrice: Number(l.unitPrice),
        discount: l.discountPpm / 10_000,
        amount: Number(l.amount),
        taxAmount: Number(l.taxAmount),
        account: l.account,
        taxGroup: l.taxGroup && { id: l.taxGroup.id, name: l.taxGroup.name },
      })),
      applications: c.applications.map((a) =>
        a.invoice
          ? {
              id: a.id,
              kind: 'invoice' as const,
              date: iso(a.date),
              amount: Number(a.amount),
              invoice: { id: a.invoice.id, number: invoiceLabel(a.invoice) },
            }
          : {
              id: a.id,
              kind: 'refund' as const,
              date: iso(a.date),
              amount: Number(a.amount),
              rate: a.rate && rateText(a.rate),
              reference: a.reference,
              bankAccount: a.bankAccount,
              journalEntry: a.journalEntry && {
                id: a.journalEntry.id,
                number: entryLabel(a.journalEntry),
              },
            },
      ),
      createdAt: c.createdAt,
      voidedAt: c.voidedAt,
    };
  }

  private async find(
    tx: Tx | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const c = await tx.creditNote.findFirst({
      where: { id, organizationId },
      select,
    });
    if (!c) throw new NotFoundException('Credit note not found.');
    return c;
  }

  async get(organizationId: string, id: string) {
    return this.view(await this.find(this.prisma, organizationId, id));
  }

  async list(
    organizationId: string,
    q: {
      contactId?: string;
      invoiceId?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const where: Prisma.CreditNoteWhereInput = {
      organizationId,
      ...(q.contactId && { contactId: q.contactId }),
      ...(q.invoiceId && { invoiceId: q.invoiceId }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.creditNote.count({ where }),
      this.prisma.creditNote.findMany({
        where,
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
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

  /** What an invoice's lines can still be credited: their quantity less what live credit notes already took back */
  async creditable(organizationId: string, invoiceId: string) {
    const i = await this.prisma.invoice.findFirst({
      where: { organizationId, id: invoiceId },
      select: {
        status: true,
        lines: {
          orderBy: { lineNo: 'asc' },
          select: {
            id: true,
            quantity: true,
            credited: {
              where: { creditNote: { status: 'issued' } },
              select: { quantity: true },
            },
          },
        },
      },
    });
    if (!i) throw new NotFoundException('Invoice not found.');
    return i.lines.map((l) => {
      const left =
        parseQuantity(l.quantity.toFixed(4))! -
        l.credited.reduce(
          (s, c) => s + parseQuantity(c.quantity.toFixed(4))!,
          0n,
        );
      return {
        invoiceLineId: l.id,
        quantity: formatQuantity(left > 0n ? left : 0n),
      };
    });
  }

  /** Issues a credit note against an invoice and applies it there, up to what the invoice still has to be paid. */
  async create(
    input: Required<Omit<CreditNoteInput, 'reason'>> & {
      reason: string | null;
    },
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const inv = await tx.invoice.findFirst({
        where: { organizationId, id: input.invoiceId },
        select: {
          id: true,
          status: true,
          issueDate: true,
          currency: true,
          rate: true,
          total: true,
          amountPaid: true,
          receivableAccountId: true,
          number: true,
          fiscalYear: { select: { name: true } },
          contact: { select: { id: true, name: true } },
          lines: {
            select: {
              id: true,
              description: true,
              quantity: true,
              unitPrice: true,
              discountPpm: true,
              accountId: true,
              taxGroupId: true,
              taxGroup: {
                select: {
                  rates: {
                    orderBy: { position: 'asc' },
                    select: { rate: { select: { id: true, ratePpm: true } } },
                  },
                },
              },
              credited: {
                where: { creditNote: { status: 'issued' } },
                select: { quantity: true },
              },
            },
          },
        },
      });
      if (!inv)
        throw refuse(
          BadRequestException,
          'That invoice doesn’t exist.',
          'invoice_not_found',
          { field: 'invoiceId' },
        );
      if (inv.status !== 'issued')
        throw refuse(
          ConflictException,
          'Only issued invoices can be credited.',
          'invoice_not_issued',
        );
      if (input.date < iso(inv.issueDate))
        throw refuse(
          BadRequestException,
          'A credit note can’t be dated before its invoice.',
          'before_invoice',
          { field: 'date' },
        );
      const seen = new Set<string>();
      const lines = input.lines.map((l, n) => {
        const src = inv.lines.find((x) => x.id === l.invoiceLineId);
        if (!src || seen.has(src.id))
          throw refuse(
            BadRequestException,
            `Line ${n + 1} isn’t a line of this invoice.`,
            'line_not_found',
            { line: n + 1 },
          );
        seen.add(src.id);
        const left =
          parseQuantity(src.quantity.toFixed(4))! -
          src.credited.reduce(
            (s, c) => s + parseQuantity(c.quantity.toFixed(4))!,
            0n,
          );
        if (parseQuantity(l.quantity)! > left)
          throw refuse(
            ConflictException,
            `That’s more than is left to credit on line ${n + 1} (${formatQuantity(left > 0n ? left : 0n)}).`,
            'over_credited',
            { line: n + 1, left: formatQuantity(left > 0n ? left : 0n) },
          );
        return { src, quantity: formatQuantity(parseQuantity(l.quantity)!) };
      });
      const amounts = invoiceAmounts(
        lines.map((l) => ({
          quantity: l.quantity,
          unitPrice: Number(l.src.unitPrice),
          discountPpm: l.src.discountPpm,
          rates: (l.src.taxGroup?.rates ?? []).map((r) => ({
            rateId: r.rate.id,
            ratePpm: r.rate.ratePpm,
          })),
        })),
      );
      if (amounts.total <= 0)
        throw refuse(
          BadRequestException,
          'A credit note must be for more than nothing.',
          'zero_total',
        );

      const year = await tx.fiscalYear.findFirst({
        where: {
          organizationId,
          startDate: { lte: asDate(input.date) },
          endDate: { gte: asDate(input.date) },
        },
        select: { id: true, name: true },
      });
      if (!year)
        throw refuse(
          ConflictException,
          'There is no financial year for this date. Add it under Financial years.',
          'no_period',
        );
      const last = await tx.creditNote.aggregate({
        where: { organizationId, fiscalYearId: year.id },
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;
      const label = creditNoteNumber(year.name, number);

      // The invoice's entry the other way round, at the rate it was posted at, so nothing is left as an exchange difference
      const { baseCurrency } = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { baseCurrency: true },
      });
      const rate = inv.rate && rateText(inv.rate);
      const base = (minor: number) =>
        rate
          ? toBase(
              minor,
              rate,
              currencyDigits(inv.currency!),
              currencyDigits(baseCurrency),
            )
          : minor;
      const income = lines.map((l, n) => ({
        accountId: l.src.accountId!,
        description: l.src.description,
        debit: base(amounts.lines[n]!.net),
        credit: 0,
        taxGroupId: l.src.taxGroupId,
        taxInclusive: false,
      }));
      const receivable = inv.currency
        ? {
            accountId: inv.receivableAccountId!,
            description: label,
            debit: 0,
            credit: 0,
            currency: inv.currency,
            foreignDebit: 0,
            foreignCredit: amounts.total,
            rate,
          }
        : {
            accountId: inv.receivableAccountId!,
            description: label,
            debit: 0,
            credit: amounts.total,
          };
      const entryLines: Record<string, unknown>[] = [
        ...income.filter((l) => l.debit > 0),
        receivable,
      ];
      if (inv.currency) {
        const parts = income.reduce(
          (s, l, n) =>
            s +
            l.debit +
            (lines[n]!.src.taxGroup
              ? splitTax(
                  l.debit,
                  false,
                  lines[n]!.src.taxGroup!.rates.map((r) => ({
                    rateId: r.rate.id,
                    ratePpm: r.rate.ratePpm,
                  })),
                ).taxes.reduce((t, x) => t + x.amount, 0)
              : 0),
          0,
        );
        const diff = base(amounts.total) - parts;
        if (diff)
          entryLines.push({
            accountId: await ensureFxAccount(tx, organizationId, 'fx_realised'),
            description: `${label} rounding`,
            debit: diff > 0 ? diff : 0,
            credit: diff < 0 ? -diff : 0,
          });
      }
      const invLabel = invoiceLabel(inv)!;
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: input.date,
          memo: `Credit note ${label} · ${inv.contact.name} · ${invLabel}`,
          reference: label,
          lines: entryLines as never,
        },
        ctx.actor.userId,
      );

      const onInvoice = Math.min(
        amounts.total,
        Number(inv.total - inv.amountPaid),
      );
      const note = await tx.creditNote.create({
        data: {
          organizationId,
          number,
          fiscalYearId: year.id,
          contactId: inv.contact.id,
          invoiceId: inv.id,
          date: asDate(input.date),
          currency: inv.currency,
          rate: inv.rate,
          reason: input.reason,
          receivableAccountId: inv.receivableAccountId!,
          subtotal: BigInt(amounts.subtotal),
          taxTotal: BigInt(amounts.tax),
          total: BigInt(amounts.total),
          applied: BigInt(onInvoice),
          journalEntryId: entry.id,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await tx.creditNoteLine.createMany({
        data: lines.map((l, n) => ({
          organizationId,
          creditNoteId: note.id,
          lineNo: n + 1,
          invoiceLineId: l.src.id,
          description: l.src.description,
          quantity: l.quantity,
          unitPrice: l.src.unitPrice,
          discountPpm: l.src.discountPpm,
          taxGroupId: l.src.taxGroupId,
          accountId: l.src.accountId!,
          amount: BigInt(amounts.lines[n]!.net),
          taxAmount: BigInt(amounts.lines[n]!.tax),
        })),
      });
      if (onInvoice > 0) {
        await tx.creditApplication.create({
          data: {
            organizationId,
            creditNoteId: note.id,
            invoiceId: inv.id,
            date: asDate(input.date),
            amount: BigInt(onInvoice),
            createdById: ctx.actor.userId,
          },
        });
        await tx.invoice.update({
          where: { id: inv.id },
          data: { amountPaid: { increment: BigInt(onInvoice) } },
        });
      }
      await this.audit.record(
        {
          action: 'org.credit_note.issue',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'credit_note',
          entityId: note.id,
          after: {
            number: label,
            invoice: invLabel,
            contact: inv.contact.name,
            total: amounts.total,
            currency: inv.currency,
            onInvoice,
            entry: entry.number,
          },
          req: ctx.req,
        },
        tx,
      );
      return note.id;
    });
    return this.get(organizationId, id);
  }

  /** Puts remaining credit onto another open invoice of the same customer, in the same currency and receivable. */
  async apply(id: string, input: CreditApplyInput, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const date = input.date ?? (await this.today(organizationId));
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const c = await this.find(tx, organizationId, id);
      if (c.status !== 'issued')
        throw refuse(
          ConflictException,
          'This credit note is void.',
          'credit_note_void',
        );
      const inv = await tx.invoice.findFirst({
        where: { organizationId, id: input.invoiceId },
        select: {
          id: true,
          status: true,
          contactId: true,
          currency: true,
          receivableAccountId: true,
          total: true,
          amountPaid: true,
          issueDate: true,
          number: true,
          fiscalYear: { select: { name: true } },
        },
      });
      if (!inv || inv.contactId !== c.contact.id)
        throw refuse(
          BadRequestException,
          'That invoice belongs to another customer.',
          'invoice_not_found',
          { field: 'invoiceId' },
        );
      if (inv.status !== 'issued')
        throw refuse(
          ConflictException,
          'Only issued invoices can take credit.',
          'invoice_not_issued',
        );
      if (
        inv.currency !== c.currency ||
        inv.receivableAccountId !== c.receivableAccount.id
      )
        throw refuse(
          BadRequestException,
          'That invoice is in another currency or receivable account.',
          'invoice_currency',
        );
      if (input.amount > Number(c.total - c.applied))
        throw refuse(
          ConflictException,
          'That’s more credit than is left on this note.',
          'over_applied',
        );
      if (input.amount > Number(inv.total - inv.amountPaid))
        throw refuse(
          ConflictException,
          'That’s more than the invoice has left to pay.',
          'over_allocated',
        );
      await tx.creditApplication.create({
        data: {
          organizationId,
          creditNoteId: id,
          invoiceId: inv.id,
          date: asDate(date < iso(inv.issueDate) ? iso(inv.issueDate) : date),
          amount: BigInt(input.amount),
          createdById: ctx.actor.userId,
        },
      });
      await tx.invoice.update({
        where: { id: inv.id },
        data: { amountPaid: { increment: BigInt(input.amount) } },
      });
      await tx.creditNote.update({
        where: { id },
        data: { applied: { increment: BigInt(input.amount) } },
      });
      await this.audit.record(
        {
          action: 'org.credit_note.apply',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'credit_note',
          entityId: id,
          after: {
            number: creditNoteNumber(c.fiscalYear.name, c.number),
            invoice: invoiceLabel(inv),
            amount: input.amount,
          },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  /** Pays remaining credit back to the customer from a bank or cash account. A foreign refund realises its exchange difference. */
  async refund(
    id: string,
    input: Omit<Required<CreditRefundInput>, 'rate' | 'reference'> & {
      rate: string | null;
      reference: string | null;
    },
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const c = await this.find(tx, organizationId, id);
      if (c.status !== 'issued')
        throw refuse(
          ConflictException,
          'This credit note is void.',
          'credit_note_void',
        );
      if (input.amount > Number(c.total - c.applied))
        throw refuse(
          ConflictException,
          'That’s more credit than is left on this note.',
          'over_applied',
        );
      if (input.date < iso(c.date))
        throw refuse(
          BadRequestException,
          'A refund can’t be dated before its credit note.',
          'before_credit_note',
          { field: 'date' },
        );
      const bank = await tx.account.findFirst({
        where: { organizationId, id: input.bankAccountId },
        select: {
          id: true,
          type: true,
          subtype: true,
          currency: true,
          archivedAt: true,
        },
      });
      if (
        !bank ||
        bank.type !== 'asset' ||
        !['bank', 'cash'].includes(bank.subtype) ||
        bank.archivedAt
      )
        throw refuse(
          BadRequestException,
          'Choose an active bank or cash account.',
          'bank_invalid',
          { field: 'bankAccountId' },
        );
      if (bank.currency && bank.currency !== c.currency)
        throw refuse(
          BadRequestException,
          `This account is kept in ${bank.currency}; the credit is in ${c.currency ?? 'the base currency'}.`,
          'bank_currency',
          { field: 'bankAccountId' },
        );
      const { baseCurrency } = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { baseCurrency: true },
      });
      let rate: string | null = null;
      if (c.currency) {
        rate =
          input.rate ??
          (await rateOn(tx, organizationId, c.currency, input.date))?.rate ??
          null;
        if (!rate)
          throw refuse(
            BadRequestException,
            `There is no ${c.currency} rate on or before ${input.date}. Add one under Currencies, or type the rate.`,
            'no_rate',
            { currency: c.currency, date: input.date },
          );
      }
      const label = creditNoteNumber(c.fiscalYear.name, c.number);
      const inBase = (minor: number) =>
        c.currency
          ? toBase(
              minor,
              rate!,
              currencyDigits(c.currency),
              currencyDigits(baseCurrency),
            )
          : minor;
      // Money out of the bank against the customer's receivable, which the credit had left in credit
      const receivable = c.currency
        ? {
            accountId: c.receivableAccount.id,
            description: `${label} refund`,
            debit: 0,
            credit: 0,
            currency: c.currency,
            foreignDebit: input.amount,
            foreignCredit: 0,
            rate,
          }
        : {
            accountId: c.receivableAccount.id,
            description: `${label} refund`,
            debit: input.amount,
            credit: 0,
          };
      const bankLine = bank.currency
        ? {
            accountId: bank.id,
            description: `${label} refund`,
            debit: 0,
            credit: 0,
            currency: bank.currency,
            foreignDebit: 0,
            foreignCredit: input.amount,
            rate,
          }
        : {
            accountId: bank.id,
            description: `${label} refund`,
            debit: 0,
            credit: inBase(input.amount),
          };
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: input.date,
          memo: `Refund of ${label} · ${c.contact.name}`,
          reference: input.reference ?? label,
          lines: [receivable, bankLine] as never,
        },
        ctx.actor.userId,
      );
      await tx.creditApplication.create({
        data: {
          organizationId,
          creditNoteId: id,
          journalEntryId: entry.id,
          bankAccountId: bank.id,
          date: asDate(input.date),
          amount: BigInt(input.amount),
          rate,
          reference: input.reference,
          createdById: ctx.actor.userId,
        },
      });
      await tx.creditNote.update({
        where: { id },
        data: { applied: { increment: BigInt(input.amount) } },
      });
      await this.audit.record(
        {
          action: 'org.credit_note.refund',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'credit_note',
          entityId: id,
          after: {
            number: label,
            amount: input.amount,
            currency: c.currency,
            entry: entry.number,
          },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  /** Voids a credit note that hasn't been refunded: its entry is reversed and the invoices it went onto are owed again. */
  async void(id: string, input: { date?: string; reason?: string }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const today = await this.today(organizationId);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const c = await this.find(tx, organizationId, id);
      if (c.status === 'void')
        throw refuse(
          ConflictException,
          'This credit note is already void.',
          'already_void',
        );
      if (c.applications.some((a) => !a.invoice))
        throw refuse(
          ConflictException,
          'Some of this credit was refunded. It can’t be voided.',
          'has_refunds',
        );
      const label = creditNoteNumber(c.fiscalYear.name, c.number);
      const r = await this.journals.reverseInTx(
        tx,
        organizationId,
        c.journalEntry.id,
        ctx.actor.userId,
        {
          date: input.date ?? today,
          memo: `${label} voided${input.reason ? `: ${input.reason}` : ''}`,
        },
      );
      for (const a of c.applications)
        await tx.invoice.update({
          where: { id: a.invoice!.id },
          data: { amountPaid: { decrement: a.amount } },
        });
      await tx.creditNote.update({
        where: { id },
        data: { status: 'void', voidEntryId: r.id, voidedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'org.credit_note.void',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'credit_note',
          entityId: id,
          after: {
            number: label,
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
