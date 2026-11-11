import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  billNumber,
  currencyDigits,
  invoiceNumber,
  paymentNumber,
  todayIn,
  toBase,
  type PaymentKind,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { ApprovalGate } from '../approvals/approval-gate.js';
import { AuditService } from '../audit/audit.service.js';
import { rateOn, rateText } from '../currencies/rate-on.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../integrations/webhooks.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type SettleIn = {
  contactId: string;
  date: string;
  bankAccountId: string;
  amount: number;
  rate: string | null;
  reference: string | null;
  notes: string | null;
  allocations: { documentId: string; amount: number }[];
  /** Vendor payments only: tax deducted at source, kept back from the bank */
  tds?: {
    section: string;
    ratePpm: number;
    base: number;
    amount: number;
    accountId: string;
  } | null;
};

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const entryLabel = (
  e: { number: number | null; fiscalYear: { name: string } | null } | null,
) =>
  e?.number && e.fiscalYear
    ? `JV/${e.fiscalYear.name.replace(/^FY\s*/, '').replace('–', '-')}/${String(e.number).padStart(4, '0')}`
    : null;

const doc = {
  select: {
    id: true,
    number: true,
    total: true,
    fiscalYear: { select: { name: true } },
  },
} as const;
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
  tdsSection: true,
  tdsRatePpm: true,
  tdsBase: true,
  tdsAmount: true,
  tdsAccount: { select: { id: true, code: true, name: true } },
  reference: true,
  notes: true,
  createdAt: true,
  voidedAt: true,
  fiscalYear: { select: { name: true } },
  contact: { select: { id: true, name: true } },
  bankAccount: { select: { id: true, code: true, name: true, currency: true } },
  journalEntry: {
    select: { id: true, number: true, fiscalYear: { select: { name: true } } },
  },
  voidEntry: {
    select: { id: true, number: true, fiscalYear: { select: { name: true } } },
  },
  allocations: {
    select: {
      amount: true,
      invoice: { select: { ...doc.select, fullNumber: true } },
      bill: { select: { ...doc.select, vendorReference: true } },
    },
  },
} as const;
type Row = Prisma.PaymentGetPayload<{ select: typeof select }>;

/**
 * Receipts from customers settle their invoices; payments to vendors settle their bills. Both are the same
 * movement mirrored: the bank against each document's receivable or payable, with whatever isn't allocated left
 * with the contact as an advance. Documents' paid amounts follow, and for a foreign currency the journals work
 * out the realised exchange difference. Voiding reverses the entry and reopens the documents.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
    private readonly approvals: ApprovalGate,
    private readonly webhooks: WebhooksService,
  ) {}

  /** Documents first (payments change what they've had paid), then payments: always in this order */
  private async lock(tx: Tx, organizationId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoices:' + organizationId}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'bills:' + organizationId}))`;
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
      /** Tax deducted at source: kept back from the bank, owed to the government on its account */
      tds: p.tdsSection
        ? {
            section: p.tdsSection,
            ratePpm: p.tdsRatePpm!,
            base: Number(p.tdsBase),
            amount: Number(p.tdsAmount),
            account: p.tdsAccount,
          }
        : null,
      /** What actually left (or reached) the bank */
      bankAmount: Number(p.amount - p.tdsAmount),
      reference: p.reference,
      notes: p.notes,
      journalEntry: {
        id: p.journalEntry.id,
        number: entryLabel(p.journalEntry),
      },
      voidEntry: p.voidEntry && {
        id: p.voidEntry.id,
        number: entryLabel(p.voidEntry),
      },
      allocations: p.allocations.map((a) =>
        a.invoice
          ? {
              kind: 'invoice' as const,
              invoiceId: a.invoice.id,
              documentId: a.invoice.id,
              invoiceNumber:
                a.invoice.number && a.invoice.fiscalYear
                  ? (a.invoice.fullNumber ??
                    invoiceNumber(a.invoice.fiscalYear.name, a.invoice.number))
                  : null,
              documentNumber:
                a.invoice.number && a.invoice.fiscalYear
                  ? (a.invoice.fullNumber ??
                    invoiceNumber(a.invoice.fiscalYear.name, a.invoice.number))
                  : null,
              amount: Number(a.amount),
            }
          : {
              kind: 'bill' as const,
              billId: a.bill!.id,
              documentId: a.bill!.id,
              documentNumber:
                a.bill!.number && a.bill!.fiscalYear
                  ? billNumber(a.bill!.fiscalYear.name, a.bill!.number)
                  : null,
              /** The vendor's own number for it */
              vendorReference: a.bill!.vendorReference,
              amount: Number(a.amount),
            },
      ),
      createdAt: p.createdAt,
    };
  }

  private async find(
    tx: Tx | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const p = await tx.payment.findFirst({
      where: { id, organizationId },
      select,
    });
    if (!p) throw new NotFoundException('Payment not found.');
    return p;
  }

  async get(organizationId: string, id: string) {
    return this.view(await this.find(this.prisma, organizationId, id));
  }

  async list(
    organizationId: string,
    q: {
      kind?: PaymentKind;
      contactId?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const where: Prisma.PaymentWhereInput = {
      organizationId,
      ...(q.kind && { kind: q.kind }),
      ...(q.contactId && { contactId: q.contactId }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
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

  /** The customer's issued invoices with something left to pay, oldest due first: what a receipt can settle. */
  async openInvoices(organizationId: string, contactId: string) {
    const rows = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        contactId,
        status: 'issued',
        amountPaid: { lt: this.prisma.invoice.fields.total },
      },
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        issueDate: true,
        dueDate: true,
        currency: true,
        subtotal: true,
        total: true,
        amountPaid: true,
        fiscalYear: { select: { name: true } },
        fullNumber: true,
      },
    });
    return rows.map((i) => ({
      id: i.id,
      number: i.fullNumber ?? invoiceNumber(i.fiscalYear!.name, i.number!),
      issueDate: iso(i.issueDate),
      dueDate: iso(i.dueDate),
      currency: i.currency,
      subtotal: Number(i.subtotal),
      total: Number(i.total),
      balance: Number(i.total - i.amountPaid),
    }));
  }

  /** The vendor's recorded bills with something left to pay, oldest due first: what a payment can settle. */
  async openBills(organizationId: string, contactId: string) {
    const rows = await this.prisma.bill.findMany({
      where: {
        organizationId,
        contactId,
        status: 'open',
        amountPaid: { lt: this.prisma.bill.fields.total },
      },
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        billDate: true,
        dueDate: true,
        currency: true,
        subtotal: true,
        total: true,
        amountPaid: true,
        vendorReference: true,
        fiscalYear: { select: { name: true } },
      },
    });
    return rows.map((b) => ({
      /** Before GST: what TDS is usually worked out on */
      subtotal: Number(b.subtotal),
      id: b.id,
      number: billNumber(b.fiscalYear!.name, b.number!),
      vendorReference: b.vendorReference,
      issueDate: iso(b.billDate),
      dueDate: iso(b.dueDate),
      currency: b.currency,
      total: Number(b.total),
      balance: Number(b.total - b.amountPaid),
    }));
  }

  receive(
    input: Omit<SettleIn, 'allocations'> & {
      allocations: { invoiceId: string; amount: number }[];
    },
    ctx: Ctx,
  ) {
    return this.settle(
      'receipt',
      {
        ...input,
        allocations: input.allocations.map((a) => ({
          documentId: a.invoiceId,
          amount: a.amount,
        })),
      },
      ctx,
    );
  }

  /** Pays a vendor. Payments an approval rule covers are held for an approver first, as entered. */
  async pay(
    input: Omit<SettleIn, 'allocations'> & {
      allocations: { billId: string; amount: number }[];
    },
    ctx: Ctx,
    opts: { approved?: boolean } = {},
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: { organizationId: ctx.tenant.organizationId, id: input.contactId },
      select: { name: true, currency: true },
    });
    if (contact)
      await this.approvals.check(
        'payment',
        {
          documentId: null,
          amount: await this.approvals.inBase(
            ctx.tenant.organizationId,
            input.amount,
            contact.currency,
            input.date,
            input.rate,
          ),
          summary: `Payment to ${contact.name}${input.reference ? ` · ${input.reference}` : ''}`,
          payload: input as unknown as Prisma.InputJsonValue,
        },
        ctx,
        opts,
      );
    return this.settle(
      'payment',
      {
        ...input,
        allocations: input.allocations.map((a) => ({
          documentId: a.billId,
          amount: a.amount,
        })),
      },
      ctx,
    );
  }

  private async settle(kind: PaymentKind, input: SettleIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const receipt = kind === 'receipt';
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const contact = await tx.contact.findFirst({
        where: { organizationId, id: input.contactId },
        select: {
          id: true,
          name: true,
          isCustomer: true,
          isVendor: true,
          currency: true,
        },
      });
      if (!contact)
        throw refuse(
          BadRequestException,
          'That contact doesn’t exist.',
          'contact_not_found',
          { field: 'contactId' },
        );
      if (receipt && !contact.isCustomer)
        throw refuse(
          BadRequestException,
          'This contact isn’t a customer.',
          'not_customer',
          { field: 'contactId' },
        );
      if (!receipt && !contact.isVendor)
        throw refuse(
          BadRequestException,
          'This contact isn’t a vendor.',
          'not_vendor',
          { field: 'contactId' },
        );
      const currency = contact.currency;

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
      if (bank.currency && bank.currency !== currency)
        throw refuse(
          BadRequestException,
          `This account is kept in ${bank.currency}; the contact deals in ${currency ?? 'the base currency'}.`,
          'bank_currency',
          { field: 'bankAccountId' },
        );

      // TDS, in rupees (the base currency): kept back from a vendor and owed on a tax liability, or kept back by a
      // customer and claimed back from a current asset such as TDS receivable
      const tds = input.tds ?? null;
      if (tds) {
        if (currency)
          throw refuse(
            BadRequestException,
            `TDS is for ${receipt ? 'receipts' : 'payments'} in the base currency.`,
            'tds_currency',
            { field: 'tds' },
          );
        if (tds.amount >= input.amount)
          throw refuse(
            BadRequestException,
            `TDS has to be less than the ${receipt ? 'receipt' : 'payment'}.`,
            'tds_too_much',
            { field: 'tds' },
          );
        const on = await tx.account.findFirst({
          where: { organizationId, id: tds.accountId },
          select: { type: true, subtype: true, archivedAt: true },
        });
        const fits = receipt
          ? on?.type === 'asset' &&
            ['current_asset', 'other_asset'].includes(on.subtype)
          : on?.type === 'liability' &&
            ['tax_payable', 'current_liability'].includes(on.subtype);
        if (!on || !fits || on.archivedAt)
          throw refuse(
            BadRequestException,
            receipt
              ? 'Choose an active current asset account for the TDS, like TDS receivable.'
              : 'Choose an active tax liability account for the TDS, like TDS payable.',
            'tds_account',
            { field: 'tds' },
          );
      }

      // The documents it settles: this contact's, current, in their currency, and no more than each one's balance
      const ids = input.allocations.map((a) => a.documentId);
      const docs = receipt
        ? (
            await tx.invoice.findMany({
              where: { organizationId, id: { in: ids } },
              select: {
                id: true,
                contactId: true,
                status: true,
                currency: true,
                total: true,
                amountPaid: true,
                receivableAccountId: true,
              },
            })
          ).map((d) => ({
            ...d,
            open: d.status === 'issued',
            accountId: d.receivableAccountId,
          }))
        : (
            await tx.bill.findMany({
              where: { organizationId, id: { in: ids } },
              select: {
                id: true,
                contactId: true,
                status: true,
                currency: true,
                total: true,
                amountPaid: true,
                payableAccountId: true,
              },
            })
          ).map((d) => ({
            ...d,
            open: d.status === 'open',
            accountId: d.payableAccountId,
          }));
      for (const a of input.allocations) {
        const d = docs.find((x) => x.id === a.documentId);
        if (!d || d.contactId !== contact.id)
          throw refuse(
            BadRequestException,
            `An allocation is for ${receipt ? 'an invoice' : 'a bill'} of another contact.`,
            receipt ? 'invoice_not_found' : 'bill_not_found',
          );
        if (!d.open)
          throw refuse(
            ConflictException,
            receipt
              ? 'Only issued invoices can be paid.'
              : 'Only recorded bills can be paid.',
            receipt ? 'invoice_not_issued' : 'bill_not_open',
          );
        if (d.currency !== currency)
          throw refuse(
            BadRequestException,
            `${receipt ? 'An invoice' : 'A bill'} is in a different currency.`,
            receipt ? 'invoice_currency' : 'bill_currency',
          );
        if (BigInt(a.amount) > d.total - d.amountPaid)
          throw refuse(
            ConflictException,
            `That’s more than the ${receipt ? 'invoice' : 'bill'} has left to pay.`,
            'over_allocated',
            { documentId: d.id },
          );
      }
      const allocated = input.allocations.reduce((s, a) => s + a.amount, 0);
      const unallocated = input.amount - allocated;

      const { baseCurrency } = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { baseCurrency: true },
      });
      let rate: string | null = null;
      if (currency) {
        rate =
          input.rate ??
          (await rateOn(tx, organizationId, currency, input.date))?.rate ??
          null;
        if (!rate)
          throw refuse(
            BadRequestException,
            `There is no ${currency} rate on or before ${input.date}. Add one under Currencies, or type the rate.`,
            'no_rate',
            { currency, date: input.date },
          );
      }
      const inBase = (minor: number) =>
        currency
          ? toBase(
              minor,
              rate!,
              currencyDigits(currency),
              currencyDigits(baseCurrency),
            )
          : minor;
      // Receivables and payables (and banks in the same foreign currency) take the amount in that currency
      const line = (
        accountId: string,
        side: 'debit' | 'credit',
        minor: number,
        description: string,
        foreign: boolean,
      ) =>
        foreign && currency
          ? {
              accountId,
              description,
              debit: 0,
              credit: 0,
              currency,
              foreignDebit: side === 'debit' ? minor : 0,
              foreignCredit: side === 'credit' ? minor : 0,
              rate,
            }
          : {
              accountId,
              description,
              debit: side === 'debit' ? minor : 0,
              credit: side === 'credit' ? minor : 0,
            };

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
      const last = await tx.payment.aggregate({
        where: { organizationId, kind, fiscalYearId: year.id },
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;
      const label = paymentNumber(kind, year.name, number);

      const byAccount = new Map<string, number>();
      for (const a of input.allocations) {
        const accountId = docs.find((x) => x.id === a.documentId)!.accountId!;
        byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + a.amount);
      }
      if (unallocated > 0) {
        // What isn't allocated waits with the contact as an advance
        const advance = await tx.account.findFirst({
          where: {
            organizationId,
            subtype: receipt ? 'accounts_receivable' : 'accounts_payable',
            currency,
            archivedAt: null,
          },
          orderBy: { code: 'asc' },
          select: { id: true },
        });
        if (!advance)
          throw refuse(
            ConflictException,
            `There is no ${receipt ? 'receivable' : 'payable'} account${currency ? ` kept in ${currency}` : ''} for the unallocated amount.`,
            receipt ? 'no_receivable_account' : 'no_payable_account',
          );
        byAccount.set(
          advance.id,
          (byAccount.get(advance.id) ?? 0) + unallocated,
        );
      }
      // Money in: bank debit, documents credit. Money out: the other way round.
      const docSide = receipt ? 'credit' : 'debit';
      const bankSide = receipt ? 'debit' : 'credit';
      const docLines = [...byAccount].map(([accountId, minor]) =>
        line(accountId, docSide, minor, label, true),
      );
      // A bank in the base currency carries the rupees of the document side at the same rate
      // With TDS the bank pays less, and the rest is owed to the government
      const kept = tds?.amount ?? 0;
      const bankLine = bank.currency
        ? line(bank.id, bankSide, input.amount, label, true)
        : line(
            bank.id,
            bankSide,
            [...byAccount.values()].reduce((s, m) => s + inBase(m), 0) - kept,
            label,
            false,
          );
      // Kept back by us: owed (credit); kept back by the customer: to claim back (debit)
      const tdsLine = tds
        ? [
            line(
              tds.accountId,
              receipt ? 'debit' : 'credit',
              kept,
              `TDS ${tds.section} · ${label}`,
              false,
            ),
          ]
        : [];
      const lines = receipt
        ? [bankLine, ...tdsLine, ...docLines]
        : [...docLines, bankLine, ...tdsLine];

      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: input.date,
          memo: `${receipt ? 'Receipt' : 'Payment'} ${label} · ${contact.name}`,
          reference: input.reference ?? label,
          lines,
        },
        ctx.actor.userId,
      );
      const p = await tx.payment.create({
        data: {
          organizationId,
          kind,
          number,
          fiscalYearId: year.id,
          contactId: contact.id,
          date: asDate(input.date),
          bankAccountId: bank.id,
          currency,
          rate,
          amount: BigInt(input.amount),
          allocated: BigInt(allocated),
          ...(tds
            ? {
                tdsSection: tds.section,
                tdsRatePpm: tds.ratePpm,
                tdsBase: BigInt(tds.base),
                tdsAmount: BigInt(tds.amount),
                tdsAccountId: tds.accountId,
              }
            : {}),
          reference: input.reference,
          notes: input.notes,
          journalEntryId: entry.id,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      if (input.allocations.length)
        await tx.paymentAllocation.createMany({
          data: input.allocations.map((a) => ({
            organizationId,
            paymentId: p.id,
            ...(receipt
              ? { invoiceId: a.documentId }
              : { billId: a.documentId }),
            amount: BigInt(a.amount),
          })),
        });
      for (const a of input.allocations) {
        if (receipt)
          await tx.invoice.update({
            where: { id: a.documentId },
            data: { amountPaid: { increment: BigInt(a.amount) } },
          });
        else
          await tx.bill.update({
            where: { id: a.documentId },
            data: { amountPaid: { increment: BigInt(a.amount) } },
          });
      }
      await this.audit.record(
        {
          action: receipt ? 'org.payment.receive' : 'org.payment.pay',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'payment',
          entityId: p.id,
          after: {
            number: label,
            contact: contact.name,
            amount: input.amount,
            currency,
            allocated,
            ...(tds
              ? { tds: { section: tds.section, amount: tds.amount } }
              : {}),
            entry: entry.number,
          },
          req: ctx.req,
        },
        tx,
      );
      return p.id;
    });
    const done = await this.get(organizationId, id);
    void this.webhooks.emit(
      organizationId,
      kind === 'receipt' ? 'payment.received' : 'payment.made',
      done,
      ctx.actor.userId,
    );
    return done;
  }

  /** Voids a receipt or payment: its entry is reversed today and the documents it settled are open again. */
  async void(id: string, input: { reason?: string }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const p = await this.find(tx, organizationId, id);
      if (p.status === 'void')
        throw refuse(
          ConflictException,
          'This payment is already void.',
          'already_void',
        );
      const label = paymentNumber(
        p.kind as PaymentKind,
        p.fiscalYear.name,
        p.number,
      );
      const r = await this.journals.reverseInTx(
        tx,
        organizationId,
        p.journalEntry.id,
        ctx.actor.userId,
        {
          date: todayIn(timeZone),
          memo: `${label} voided${input.reason ? `: ${input.reason}` : ''}`,
        },
      );
      for (const a of p.allocations) {
        if (a.invoice)
          await tx.invoice.update({
            where: { id: a.invoice.id },
            data: { amountPaid: { decrement: a.amount } },
          });
        if (a.bill)
          await tx.bill.update({
            where: { id: a.bill.id },
            data: { amountPaid: { decrement: a.amount } },
          });
      }
      await tx.payment.update({
        where: { id },
        data: { status: 'void', voidEntryId: r.id, voidedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'org.payment.void',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'payment',
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
    const done = await this.get(organizationId, id);
    void this.webhooks.emit(
      organizationId,
      'payment.voided',
      done,
      ctx.actor.userId,
    );
    return done;
  }
}
