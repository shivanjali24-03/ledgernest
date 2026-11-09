import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { currencyDigits, invoiceNumber, paymentNumber, todayIn, toBase, type PaymentKind } from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { rateOn, rateText } from '../currencies/rate-on.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type ReceiptIn = { contactId: string; date: string; bankAccountId: string; amount: number; rate: string | null; reference: string | null; notes: string | null; allocations: { invoiceId: string; amount: number }[] };

const refuse = (Ex: typeof ConflictException | typeof BadRequestException, message: string, reason: string, extra: object = {}) =>
  new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const entryLabel = (e: { number: number | null; fiscalYear: { name: string } | null } | null) => (e?.number && e.fiscalYear ? `JV/${e.fiscalYear.name.replace(/^FY\s*/, '').replace('–', '-')}/${String(e.number).padStart(4, '0')}` : null);

const select = {
  id: true,
  kind: true,
  number: true,
  status: true,
  date: true,
  currency: true,
  rate: true,
  amount: true,
  allocated: true,
  reference: true,
  notes: true,
  createdAt: true,
  voidedAt: true,
  fiscalYear: { select: { name: true } },
  contact: { select: { id: true, name: true } },
  bankAccount: { select: { id: true, code: true, name: true, currency: true } },
  journalEntry: { select: { id: true, number: true, fiscalYear: { select: { name: true } } } },
  voidEntry: { select: { id: true, number: true, fiscalYear: { select: { name: true } } } },
  allocations: { select: { amount: true, invoice: { select: { id: true, number: true, total: true, fiscalYear: { select: { name: true } } } } } },
} as const;
type Row = Prisma.PaymentGetPayload<{ select: typeof select }>;

/**
 * Receipts from customers, allocated to their invoices. Posting debits the bank and credits each invoice's
 * receivable (what isn't allocated stays with the customer as an advance), updates what each invoice has had
 * paid, and, for a foreign currency, lets the journals work out the realised exchange difference.
 * Voiding reverses the entry and gives the invoices their balances back.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
  ) {}

  /** Invoices first (receipts change what they've had paid), then payments: always in this order */
  private async lock(tx: Tx, organizationId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoices:' + organizationId}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payments:' + organizationId}))`;
  }

  private view(p: Row) {
    return {
      id: p.id,
      kind: p.kind as PaymentKind,
      number: paymentNumber(p.kind as PaymentKind, p.fiscalYear.name, p.number),
      status: p.status as 'posted' | 'void',
      date: iso(p.date),
      contact: p.contact,
      bankAccount: p.bankAccount,
      currency: p.currency,
      rate: p.rate && rateText(p.rate),
      amount: Number(p.amount),
      allocated: Number(p.allocated),
      unallocated: Number(p.amount - p.allocated),
      reference: p.reference,
      notes: p.notes,
      journalEntry: { id: p.journalEntry.id, number: entryLabel(p.journalEntry) },
      voidEntry: p.voidEntry && { id: p.voidEntry.id, number: entryLabel(p.voidEntry) },
      allocations: p.allocations.map((a) => ({ invoiceId: a.invoice.id, invoiceNumber: a.invoice.number && a.invoice.fiscalYear ? invoiceNumber(a.invoice.fiscalYear.name, a.invoice.number) : null, amount: Number(a.amount) })),
      createdAt: p.createdAt,
    };
  }

  private async find(tx: Tx | PrismaService, organizationId: string, id: string) {
    const p = await tx.payment.findFirst({ where: { id, organizationId }, select });
    if (!p) throw new NotFoundException('Payment not found.');
    return p;
  }

  async get(organizationId: string, id: string) {
    return this.view(await this.find(this.prisma, organizationId, id));
  }

  async list(organizationId: string, q: { kind?: PaymentKind; contactId?: string; page: number; pageSize: number }) {
    const where: Prisma.PaymentWhereInput = { organizationId, ...(q.kind && { kind: q.kind }), ...(q.contactId && { contactId: q.contactId }) };
    const [total, rows] = await Promise.all([this.prisma.payment.count({ where }), this.prisma.payment.findMany({ where, orderBy: [{ date: 'desc' }, { number: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, select })]);
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((r) => this.view(r)) };
  }

  /** The customer's issued invoices with something left to pay, oldest due first: what a receipt can settle. */
  async openInvoices(organizationId: string, contactId: string) {
    const rows = await this.prisma.invoice.findMany({
      where: { organizationId, contactId, status: 'issued', amountPaid: { lt: this.prisma.invoice.fields.total } },
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      select: { id: true, number: true, issueDate: true, dueDate: true, currency: true, total: true, amountPaid: true, fiscalYear: { select: { name: true } } },
    });
    return rows.map((i) => ({ id: i.id, number: invoiceNumber(i.fiscalYear!.name, i.number!), issueDate: iso(i.issueDate), dueDate: iso(i.dueDate), currency: i.currency, total: Number(i.total), balance: Number(i.total - i.amountPaid) }));
  }

  async receive(input: ReceiptIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const contact = await tx.contact.findFirst({ where: { organizationId, id: input.contactId }, select: { id: true, name: true, isCustomer: true, archivedAt: true, currency: true } });
      if (!contact) throw refuse(BadRequestException, 'That customer doesn’t exist.', 'contact_not_found', { field: 'contactId' });
      if (!contact.isCustomer) throw refuse(BadRequestException, 'This contact isn’t a customer.', 'not_customer', { field: 'contactId' });
      const currency = contact.currency;

      const bank = await tx.account.findFirst({ where: { organizationId, id: input.bankAccountId }, select: { id: true, type: true, subtype: true, currency: true, archivedAt: true } });
      if (!bank || bank.type !== 'asset' || !['bank', 'cash'].includes(bank.subtype) || bank.archivedAt) throw refuse(BadRequestException, 'Choose an active bank or cash account.', 'bank_invalid', { field: 'bankAccountId' });
      if (bank.currency && bank.currency !== currency) throw refuse(BadRequestException, `This account is kept in ${bank.currency}; the customer pays in ${currency ?? 'the base currency'}.`, 'bank_currency', { field: 'bankAccountId' });

      // The invoices it settles: this customer's, issued, in their currency, and no more than each one's balance
      const invoices = await tx.invoice.findMany({ where: { organizationId, id: { in: input.allocations.map((a) => a.invoiceId) } }, select: { id: true, contactId: true, status: true, currency: true, total: true, amountPaid: true, receivableAccountId: true } });
      for (const a of input.allocations) {
        const i = invoices.find((x) => x.id === a.invoiceId);
        if (!i || i.contactId !== contact.id) throw refuse(BadRequestException, 'An allocation is for an invoice of another customer.', 'invoice_not_found');
        if (i.status !== 'issued') throw refuse(ConflictException, 'Only issued invoices can be paid.', 'invoice_not_issued');
        if (i.currency !== currency) throw refuse(BadRequestException, 'An invoice is in a different currency.', 'invoice_currency');
        if (BigInt(a.amount) > i.total - i.amountPaid) throw refuse(ConflictException, 'That’s more than the invoice has left to pay.', 'over_allocated', { invoiceId: i.id });
      }
      const allocated = input.allocations.reduce((s, a) => s + a.amount, 0);
      const unallocated = input.amount - allocated;

      const { baseCurrency } = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { baseCurrency: true } });
      let rate: string | null = null;
      if (currency) {
        rate = input.rate ?? (await rateOn(tx, organizationId, currency, input.date))?.rate ?? null;
        if (!rate) throw refuse(BadRequestException, `There is no ${currency} rate on or before ${input.date}. Add one under Currencies, or type the rate.`, 'no_rate', { currency, date: input.date });
      }
      // A line on a receivable (or a bank kept in the same foreign currency) is entered in that currency
      const foreignLine = (accountId: string, side: 'debit' | 'credit', minor: number, description: string) =>
        currency ? { accountId, description, debit: 0, credit: 0, currency, foreignDebit: side === 'debit' ? minor : 0, foreignCredit: side === 'credit' ? minor : 0, rate } : { accountId, description, debit: side === 'debit' ? minor : 0, credit: side === 'credit' ? minor : 0 };

      const year = await tx.fiscalYear.findFirst({ where: { organizationId, startDate: { lte: asDate(input.date) }, endDate: { gte: asDate(input.date) } }, select: { id: true, name: true } });
      if (!year) throw refuse(ConflictException, 'There is no financial year for this date. Add it under Financial years.', 'no_period');
      const last = await tx.payment.aggregate({ where: { organizationId, kind: 'receipt', fiscalYearId: year.id }, _max: { number: true } });
      const number = (last._max.number ?? 0) + 1;
      const label = paymentNumber('receipt', year.name, number);

      const lines = [
        bank.currency ? foreignLine(bank.id, 'debit', input.amount, label) : { accountId: bank.id, description: label, debit: currency ? toBase(input.amount, rate!, currencyDigits(currency), currencyDigits(baseCurrency)) : input.amount, credit: 0 },
      ];
      const byReceivable = new Map<string, number>();
      for (const a of input.allocations) {
        const r = invoices.find((x) => x.id === a.invoiceId)!.receivableAccountId!;
        byReceivable.set(r, (byReceivable.get(r) ?? 0) + a.amount);
      }
      if (unallocated > 0) {
        // What isn't allocated waits on the customer's receivable as an advance
        const advance = await tx.account.findFirst({ where: { organizationId, subtype: 'accounts_receivable', currency, archivedAt: null }, orderBy: { code: 'asc' }, select: { id: true } });
        if (!advance) throw refuse(ConflictException, `There is no receivable account${currency ? ` kept in ${currency}` : ''} for the unallocated amount.`, 'no_receivable_account');
        byReceivable.set(advance.id, (byReceivable.get(advance.id) ?? 0) + unallocated);
      }
      for (const [accountId, minor] of byReceivable) lines.push(foreignLine(accountId, 'credit', minor, label));
      // A bank in the base currency taking a foreign receipt: its rupees must match the receivable side at the same rate
      if (currency && !bank.currency) {
        const credits = [...byReceivable.values()].reduce((s, m) => s + toBase(m, rate!, currencyDigits(currency), currencyDigits(baseCurrency)), 0);
        lines[0] = { ...lines[0]!, debit: credits };
      }

      const entry = await this.journals.postEntryInTx(tx, organizationId, { date: input.date, memo: `Receipt ${label} · ${contact.name}`, reference: input.reference ?? label, lines }, ctx.actor.userId);
      const p = await tx.payment.create({
        data: { organizationId, kind: 'receipt', number, fiscalYearId: year.id, contactId: contact.id, date: asDate(input.date), bankAccountId: bank.id, currency, rate, amount: BigInt(input.amount), allocated: BigInt(allocated), reference: input.reference, notes: input.notes, journalEntryId: entry.id, createdById: ctx.actor.userId },
        select: { id: true },
      });
      if (input.allocations.length) await tx.paymentAllocation.createMany({ data: input.allocations.map((a) => ({ organizationId, paymentId: p.id, invoiceId: a.invoiceId, amount: BigInt(a.amount) })) });
      for (const a of input.allocations) await tx.invoice.update({ where: { id: a.invoiceId }, data: { amountPaid: { increment: BigInt(a.amount) } } });
      await this.audit.record({ action: 'org.payment.receive', actorId: ctx.actor.userId, organizationId, entityType: 'payment', entityId: p.id, after: { number: label, contact: contact.name, amount: input.amount, currency, allocated, entry: entry.number }, req: ctx.req }, tx);
      return p.id;
    });
    return this.get(organizationId, id);
  }

  /** Voids a payment: its entry is reversed today and the invoices it settled are open again. */
  async void(id: string, input: { reason?: string }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timeZone: true } });
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const p = await this.find(tx, organizationId, id);
      if (p.status === 'void') throw refuse(ConflictException, 'This payment is already void.', 'already_void');
      const label = paymentNumber(p.kind as PaymentKind, p.fiscalYear.name, p.number);
      const r = await this.journals.reverseInTx(tx, organizationId, p.journalEntry.id, ctx.actor.userId, { date: todayIn(timeZone), memo: `${label} voided${input.reason ? `: ${input.reason}` : ''}` });
      for (const a of p.allocations) await tx.invoice.update({ where: { id: a.invoice.id }, data: { amountPaid: { decrement: a.amount } } });
      await tx.payment.update({ where: { id }, data: { status: 'void', voidEntryId: r.id, voidedAt: new Date() } });
      await this.audit.record({ action: 'org.payment.void', actorId: ctx.actor.userId, organizationId, entityType: 'payment', entityId: id, after: { number: label, reversal: r.number, reason: input.reason ?? null }, req: ctx.req }, tx);
    });
    return this.get(organizationId, id);
  }
}
