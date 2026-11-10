import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  billNumber,
  formatQuantity,
  invoiceAmounts,
  journalNumber,
  parseQuantity,
  splitTax,
  todayIn,
  vendorCreditNumber,
  type VendorCreditApplyInput,
  type VendorCreditInput,
  type VendorCreditRefundInput,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JournalsService } from '../journals/journals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NumberingService } from '../numbering/numbering.service.js';

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
  select: { id: true, number: true, fiscalYear: { select: { name: true } } },
} as const;
const entryLabel = (
  e: { number: number | null; fiscalYear: { name: string } | null } | null,
) =>
  e?.number && e.fiscalYear ? journalNumber(e.fiscalYear.name, e.number) : null;
const billRef = {
  select: {
    id: true,
    number: true,
    vendorReference: true,
    fiscalYear: { select: { name: true } },
  },
} as const;
const billLabel = (b: {
  number: number | null;
  fiscalYear: { name: string } | null;
}) =>
  b.number && b.fiscalYear ? billNumber(b.fiscalYear.name, b.number) : null;

const select = {
  id: true,
  number: true,
  status: true,
  date: true,
  vendorReference: true,
  reason: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  applied: true,
  createdAt: true,
  voidedAt: true,
  fiscalYear: { select: { name: true } },
  fullNumber: true,
  contact: { select: { id: true, name: true } },
  bill: billRef,
  payableAccount: { select: { id: true, code: true, name: true } },
  journalEntry: entryRef,
  voidEntry: entryRef,
  lines: {
    orderBy: { lineNo: 'asc' as const },
    select: {
      id: true,
      lineNo: true,
      billLineId: true,
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
      reference: true,
      bill: billRef,
      journalEntry: entryRef,
      bankAccount: { select: { id: true, code: true, name: true } },
    },
  },
} as const;
type Row = Prisma.VendorCreditGetPayload<{ select: typeof select }>;

/**
 * Debit notes correct recorded bills: goods sent back, or a price the supplier cut. Each posts the opposite of the
 * bill lines it takes back, so expenses (or assets) and input tax come down and so does what's owed to the vendor.
 * The credit goes onto the bill first; what's left is the vendor's to settle, on another bill or as a refund.
 *
 * For now: bills in the base currency, and lines without goods tracked in stock (record a stock adjustment for those).
 */
@Injectable()
export class VendorCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
    private readonly numbering: NumberingService,
  ) {}

  /** Bills first (credit changes what they have left to pay), then payments: the order everything takes them in */
  private async lock(tx: Tx, organizationId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'bills:' + organizationId}))`;
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
      splitTax(
        Number(l.amount),
        false,
        l.taxGroup.rates.map((r) => ({
          rateId: r.rate.id,
          ratePpm: r.rate.ratePpm,
        })),
      ).taxes.forEach((p, k) => {
        const name = l.taxGroup!.rates[k]!.rate.name;
        breakdown.set(name, (breakdown.get(name) ?? 0) + p.amount);
      });
    }
    const live = c.status === 'issued';
    return {
      id: c.id,
      number: c.fullNumber ?? vendorCreditNumber(c.fiscalYear.name, c.number),
      status: c.status as 'issued' | 'void',
      date: iso(c.date),
      contact: c.contact,
      bill: {
        id: c.bill.id,
        number: billLabel(c.bill),
        vendorReference: c.bill.vendorReference,
      },
      vendorReference: c.vendorReference,
      reason: c.reason,
      payableAccount: c.payableAccount,
      subtotal: Number(c.subtotal),
      taxTotal: Number(c.taxTotal),
      total: Number(c.total),
      applied: Number(c.applied),
      /** Credit still to apply or have refunded */
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
        billLineId: l.billLineId,
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
        a.bill
          ? {
              id: a.id,
              kind: 'bill' as const,
              date: iso(a.date),
              amount: Number(a.amount),
              bill: { id: a.bill.id, number: billLabel(a.bill) },
            }
          : {
              id: a.id,
              kind: 'refund' as const,
              date: iso(a.date),
              amount: Number(a.amount),
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
    const c = await tx.vendorCredit.findFirst({
      where: { id, organizationId },
      select,
    });
    if (!c) throw new NotFoundException('Debit note not found.');
    return c;
  }

  async get(organizationId: string, id: string) {
    return this.view(await this.find(this.prisma, organizationId, id));
  }

  async list(
    organizationId: string,
    q: { contactId?: string; billId?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.VendorCreditWhereInput = {
      organizationId,
      ...(q.contactId && { contactId: q.contactId }),
      ...(q.billId && { billId: q.billId }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.vendorCredit.count({ where }),
      this.prisma.vendorCredit.findMany({
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

  /** What a bill's lines can still be credited: their quantity less what live debit notes already took back */
  async creditable(organizationId: string, billId: string) {
    const b = await this.prisma.bill.findFirst({
      where: { organizationId, id: billId },
      select: {
        lines: {
          orderBy: { lineNo: 'asc' },
          select: {
            id: true,
            quantity: true,
            item: { select: { trackStock: true } },
            credited: {
              where: { vendorCredit: { status: 'issued' } },
              select: { quantity: true },
            },
          },
        },
      },
    });
    if (!b) throw new NotFoundException('Bill not found.');
    return b.lines.map((l) => {
      const left =
        parseQuantity(l.quantity.toFixed(4))! -
        l.credited.reduce(
          (s, c) => s + parseQuantity(c.quantity.toFixed(4))!,
          0n,
        );
      return {
        billLineId: l.id,
        quantity: formatQuantity(left > 0n ? left : 0n),
        /** Goods tracked in stock go back with a stock adjustment instead */
        stock: !!l.item?.trackStock,
      };
    });
  }

  /** Raises a debit note against a bill and applies it there, up to what the bill still has to be paid. */
  async create(
    input: Required<Omit<VendorCreditInput, 'reason' | 'vendorReference'>> & {
      reason: string | null;
      vendorReference: string | null;
    },
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const bill = await tx.bill.findFirst({
        where: { organizationId, id: input.billId },
        select: {
          id: true,
          status: true,
          billDate: true,
          currency: true,
          total: true,
          amountPaid: true,
          payableAccountId: true,
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
              costCentreId: true,
              item: { select: { trackStock: true } },
              taxGroup: {
                select: {
                  rates: {
                    orderBy: { position: 'asc' },
                    select: { rate: { select: { id: true, ratePpm: true } } },
                  },
                },
              },
              credited: {
                where: { vendorCredit: { status: 'issued' } },
                select: { quantity: true },
              },
            },
          },
        },
      });
      if (!bill)
        throw refuse(
          BadRequestException,
          'That bill doesn’t exist.',
          'bill_not_found',
          {
            field: 'billId',
          },
        );
      if (bill.status !== 'open')
        throw refuse(
          ConflictException,
          'Only recorded bills can be credited.',
          'bill_not_open',
        );
      if (bill.currency)
        throw refuse(
          BadRequestException,
          'Debit notes are for bills in the base currency for now.',
          'bill_currency',
        );
      if (input.date < iso(bill.billDate))
        throw refuse(
          BadRequestException,
          'A debit note can’t be dated before its bill.',
          'before_bill',
          { field: 'date' },
        );
      const seen = new Set<string>();
      const lines = input.lines.map((l, n) => {
        const src = bill.lines.find((x) => x.id === l.billLineId);
        if (!src || seen.has(src.id))
          throw refuse(
            BadRequestException,
            `Line ${n + 1} isn’t a line of this bill.`,
            'line_not_found',
            { line: n + 1 },
          );
        seen.add(src.id);
        if (src.item?.trackStock)
          throw refuse(
            BadRequestException,
            `Line ${n + 1} is goods kept in stock: send them back with a stock adjustment.`,
            'stock_line',
            { line: n + 1 },
          );
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
          'A debit note must be for more than nothing.',
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
      const {
        seriesId,
        number,
        fullNumber: label,
      } = await this.numbering.allocate(
        tx,
        organizationId,
        'debit_note',
        input.seriesId,
        year,
      );
      const billLabelText = billLabel(bill)!;

      // A composition dealer took no input tax credit on the bill, so its GST comes back off the cost
      const noCredit =
        (
          await tx.organization.findUniqueOrThrow({
            where: { id: organizationId },
            select: { gstScheme: true },
          })
        ).gstScheme === 'composition';
      // The bill's entry the other way round: less owed to the vendor, the expense and its input tax credited back
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: input.date,
          memo: `Debit note ${label} · ${bill.contact.name} · ${billLabelText}`,
          reference: input.vendorReference ?? label,
          lines: [
            {
              accountId: bill.payableAccountId!,
              description: label,
              debit: amounts.total,
              credit: 0,
            },
            ...lines
              .map((l, n) => ({
                accountId: l.src.accountId!,
                description: l.src.description,
                debit: 0,
                credit:
                  amounts.lines[n]!.net +
                  (noCredit ? amounts.lines[n]!.tax : 0),
                taxGroupId: noCredit ? null : l.src.taxGroupId,
                taxInclusive: false,
                costCentreId: l.src.costCentreId,
              }))
              .filter((l) => l.credit > 0),
          ] as never,
        },
        ctx.actor.userId,
      );
      const onBill = Math.min(
        amounts.total,
        Number(bill.total - bill.amountPaid),
      );
      const note = await tx.vendorCredit.create({
        data: {
          organizationId,
          number,
          seriesId,
          fullNumber: label,
          fiscalYearId: year.id,
          contactId: bill.contact.id,
          billId: bill.id,
          date: asDate(input.date),
          vendorReference: input.vendorReference,
          reason: input.reason,
          payableAccountId: bill.payableAccountId!,
          subtotal: BigInt(amounts.subtotal),
          taxTotal: BigInt(amounts.tax),
          total: BigInt(amounts.total),
          applied: BigInt(onBill),
          journalEntryId: entry.id,
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await tx.vendorCreditLine.createMany({
        data: lines.map((l, n) => ({
          organizationId,
          vendorCreditId: note.id,
          lineNo: n + 1,
          billLineId: l.src.id,
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
      if (onBill > 0) {
        await tx.vendorCreditApplication.create({
          data: {
            organizationId,
            vendorCreditId: note.id,
            billId: bill.id,
            date: asDate(input.date),
            amount: BigInt(onBill),
            createdById: ctx.actor.userId,
          },
        });
        await tx.bill.update({
          where: { id: bill.id },
          data: { amountPaid: { increment: BigInt(onBill) } },
        });
      }
      await this.audit.record(
        {
          action: 'org.vendor_credit.issue',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'vendor_credit',
          entityId: note.id,
          after: {
            number: label,
            bill: billLabelText,
            contact: bill.contact.name,
            total: amounts.total,
            onBill,
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

  /** Puts remaining credit onto another recorded bill of the same vendor, on the same payable account */
  async apply(id: string, input: VendorCreditApplyInput, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const date = input.date ?? (await this.today(organizationId));
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const c = await this.find(tx, organizationId, id);
      if (c.status !== 'issued')
        throw refuse(
          ConflictException,
          'This debit note is void.',
          'vendor_credit_void',
        );
      const bill = await tx.bill.findFirst({
        where: { organizationId, id: input.billId },
        select: {
          id: true,
          status: true,
          contactId: true,
          currency: true,
          payableAccountId: true,
          total: true,
          amountPaid: true,
          billDate: true,
          number: true,
          fiscalYear: { select: { name: true } },
        },
      });
      if (!bill || bill.contactId !== c.contact.id)
        throw refuse(
          BadRequestException,
          'That bill belongs to another vendor.',
          'bill_not_found',
          {
            field: 'billId',
          },
        );
      if (bill.status !== 'open')
        throw refuse(
          ConflictException,
          'Only recorded bills can take credit.',
          'bill_not_open',
        );
      if (bill.currency || bill.payableAccountId !== c.payableAccount.id)
        throw refuse(
          BadRequestException,
          'That bill is in another currency or payable account.',
          'bill_currency',
        );
      if (input.amount > Number(c.total - c.applied))
        throw refuse(
          ConflictException,
          'That’s more credit than is left on this note.',
          'over_applied',
        );
      if (input.amount > Number(bill.total - bill.amountPaid))
        throw refuse(
          ConflictException,
          'That’s more than the bill has left to pay.',
          'over_allocated',
        );
      await tx.vendorCreditApplication.create({
        data: {
          organizationId,
          vendorCreditId: id,
          billId: bill.id,
          date: asDate(date < iso(bill.billDate) ? iso(bill.billDate) : date),
          amount: BigInt(input.amount),
          createdById: ctx.actor.userId,
        },
      });
      await tx.bill.update({
        where: { id: bill.id },
        data: { amountPaid: { increment: BigInt(input.amount) } },
      });
      await tx.vendorCredit.update({
        where: { id },
        data: { applied: { increment: BigInt(input.amount) } },
      });
      await this.audit.record(
        {
          action: 'org.vendor_credit.apply',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'vendor_credit',
          entityId: id,
          after: {
            number:
              c.fullNumber ?? vendorCreditNumber(c.fiscalYear.name, c.number),
            bill: billLabel(bill),
            amount: input.amount,
          },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  /** The vendor pays remaining credit back into a bank or cash account */
  async refund(
    id: string,
    input: Omit<Required<VendorCreditRefundInput>, 'reference'> & {
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
          'This debit note is void.',
          'vendor_credit_void',
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
          'A refund can’t be dated before its debit note.',
          'before_vendor_credit',
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
        bank.archivedAt ||
        bank.currency
      )
        throw refuse(
          BadRequestException,
          'Choose an active bank or cash account in the base currency.',
          'bank_invalid',
          { field: 'bankAccountId' },
        );
      const label =
        c.fullNumber ?? vendorCreditNumber(c.fiscalYear.name, c.number);
      // Money into the bank against the vendor's payable, which the debit note had left in debit
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: input.date,
          memo: `Refund of ${label} · ${c.contact.name}`,
          reference: input.reference ?? label,
          lines: [
            {
              accountId: bank.id,
              description: `${label} refund`,
              debit: input.amount,
              credit: 0,
            },
            {
              accountId: c.payableAccount.id,
              description: `${label} refund`,
              debit: 0,
              credit: input.amount,
            },
          ] as never,
        },
        ctx.actor.userId,
      );
      await tx.vendorCreditApplication.create({
        data: {
          organizationId,
          vendorCreditId: id,
          journalEntryId: entry.id,
          bankAccountId: bank.id,
          date: asDate(input.date),
          amount: BigInt(input.amount),
          reference: input.reference,
          createdById: ctx.actor.userId,
        },
      });
      await tx.vendorCredit.update({
        where: { id },
        data: { applied: { increment: BigInt(input.amount) } },
      });
      await this.audit.record(
        {
          action: 'org.vendor_credit.refund',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'vendor_credit',
          entityId: id,
          after: { number: label, amount: input.amount, entry: entry.number },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  /** Voids a debit note the vendor hasn't refunded: its entry is reversed and the bills it went onto are owed again. */
  async void(id: string, input: { date?: string; reason?: string }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const today = await this.today(organizationId);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const c = await this.find(tx, organizationId, id);
      if (c.status === 'void')
        throw refuse(
          ConflictException,
          'This debit note is already void.',
          'already_void',
        );
      if (c.applications.some((a) => !a.bill))
        throw refuse(
          ConflictException,
          'Some of this credit was refunded. It can’t be voided.',
          'has_refunds',
        );
      const label =
        c.fullNumber ?? vendorCreditNumber(c.fiscalYear.name, c.number);
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
        await tx.bill.update({
          where: { id: a.bill!.id },
          data: { amountPaid: { decrement: a.amount } },
        });
      await tx.vendorCredit.update({
        where: { id },
        data: { status: 'void', voidEntryId: r.id, voidedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'org.vendor_credit.void',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'vendor_credit',
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
