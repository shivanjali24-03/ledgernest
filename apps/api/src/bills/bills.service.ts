import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  currencyDigits,
  dueDateFor,
  findIndianState,
  paymentNumber,
  formatQuantity,
  invoiceAmounts,
  billNumber,
  billState,
  parseQuantity,
  splitTax,
  todayIn,
  toBase,
  type BillStatus,
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
type LineIn = {
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: number;
  discount: number;
  taxGroupId: string | null;
  accountId: string | null;
};
type DraftIn = {
  contactId: string;
  billDate: string;
  dueDate: string | null;
  vendorReference: string | null;
  notes: string | null;
  placeOfSupply: string | null;
  payableAccountId: string | null;
  rate: string | null;
  lines: LineIn[];
};

const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
  extra: object = {},
) => new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const groupSelect = {
  id: true,
  name: true,
  archivedAt: true,
  gstSlabId: true,
  supply: true,
  rates: {
    orderBy: { position: 'asc' as const },
    select: { rate: { select: { id: true, name: true, ratePpm: true } } },
  },
} as const;
const select = {
  id: true,
  number: true,
  status: true,
  billDate: true,
  dueDate: true,
  currency: true,
  rate: true,
  placeOfSupply: true,
  vendorReference: true,
  notes: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  amountPaid: true,
  recordedAt: true,
  voidedAt: true,
  createdAt: true,
  updatedAt: true,
  payableAccountId: true,
  fiscalYear: { select: { name: true } },
  contact: {
    select: {
      id: true,
      name: true,
      legalName: true,
      taxId: true,
      email: true,
      billingAddress: true,
      shippingAddress: true,
      stateCode: true,
    },
  },
  payableAccount: { select: { id: true, code: true, name: true } },
  journalEntry: {
    select: { id: true, number: true, fiscalYear: { select: { name: true } } },
  },
  voidEntry: {
    select: { id: true, number: true, fiscalYear: { select: { name: true } } },
  },
  allocations: {
    where: { payment: { status: 'posted' } },
    select: {
      amount: true,
      payment: {
        select: {
          id: true,
          kind: true,
          number: true,
          date: true,
          fiscalYear: { select: { name: true } },
        },
      },
    },
  },
  lines: {
    orderBy: { lineNo: 'asc' as const },
    select: {
      id: true,
      lineNo: true,
      description: true,
      quantity: true,
      unitPrice: true,
      discountPpm: true,
      amount: true,
      taxAmount: true,
      itemId: true,
      accountId: true,
      taxGroupId: true,
      item: { select: { id: true, name: true, hsnSac: true, unit: true } },
      account: { select: { id: true, code: true, name: true } },
      taxGroup: { select: groupSelect },
    },
  },
} as const;
type Row = Prisma.BillGetPayload<{ select: typeof select }>;

const entryLabel = (
  e: { number: number | null; fiscalYear: { name: string } | null } | null,
) =>
  e?.number && e.fiscalYear
    ? `JV/${e.fiscalYear.name.replace(/^FY\s*/, '').replace('–', '-')}/${String(e.number).padStart(4, '0')}`
    : null;

/**
 * Purchase bills, the mirror of invoices. A draft can change freely. Recording gives it a gap-free number in its
 * financial year and posts its entry: expenses or assets and input tax credit against what's owed to the vendor.
 * For Indian GST the tax groups follow where the supply comes from (CGST + SGST within the state, IGST otherwise).
 * Voiding reverses the entry; a recorded bill never changes.
 */
@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'bills:' + organizationId}))`;
  }

  private async today(organizationId: string) {
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timeZone: true },
    });
    return todayIn(timeZone);
  }

  private view(i: Row, today: string) {
    const amount = (b: bigint) => Number(b);
    // Tax by rate (input tax credit: CGST 9% ₹…, SGST 9% ₹…)
    const breakdown = new Map<string, number>();
    for (const l of i.lines) {
      if (!l.taxGroup) continue;
      const { taxes } = splitTax(
        Number(l.amount),
        false,
        l.taxGroup.rates.map((r) => ({
          rateId: r.rate.id,
          ratePpm: r.rate.ratePpm,
        })),
      );
      taxes.forEach((t, n) => {
        const name = l.taxGroup!.rates[n]!.rate.name;
        breakdown.set(name, (breakdown.get(name) ?? 0) + t.amount);
      });
    }
    const v = {
      id: i.id,
      number:
        i.number && i.fiscalYear
          ? billNumber(i.fiscalYear.name, i.number)
          : null,
      status: i.status as BillStatus,
      billDate: iso(i.billDate),
      dueDate: iso(i.dueDate),
      currency: i.currency,
      rate: i.rate && rateText(i.rate),
      placeOfSupply: i.placeOfSupply,
      vendorReference: i.vendorReference,
      notes: i.notes,
      contact: {
        ...i.contact,
        billingAddress: i.contact.billingAddress as Record<
          string,
          string | null
        >,
        shippingAddress: i.contact.shippingAddress as Record<
          string,
          string | null
        > | null,
      },
      payableAccount: i.payableAccount,
      subtotal: amount(i.subtotal),
      taxTotal: amount(i.taxTotal),
      total: amount(i.total),
      amountPaid: amount(i.amountPaid),
      balance: amount(i.total - i.amountPaid),
      taxBreakdown: [...breakdown].map(([name, value]) => ({
        name,
        amount: value,
      })),
      journalEntry: i.journalEntry && {
        id: i.journalEntry.id,
        number: entryLabel(i.journalEntry),
      },
      voidEntry: i.voidEntry && {
        id: i.voidEntry.id,
        number: entryLabel(i.voidEntry),
      },
      /** Payments that paid it */
      payments: i.allocations.map((a) => ({
        id: a.payment.id,
        number: paymentNumber(
          a.payment.kind as 'payment',
          a.payment.fiscalYear.name,
          a.payment.number,
        ),
        date: iso(a.payment.date),
        amount: amount(a.amount),
      })),
      recordedAt: i.recordedAt,
      voidedAt: i.voidedAt,
      createdAt: i.createdAt,
      lines: i.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        description: l.description,
        quantity: formatQuantity(parseQuantity(l.quantity.toFixed(4))!),
        unitPrice: amount(l.unitPrice),
        discount: l.discountPpm / 10_000,
        amount: amount(l.amount),
        taxAmount: amount(l.taxAmount),
        item: l.item,
        account: l.account,
        taxGroup: l.taxGroup && {
          id: l.taxGroup.id,
          name: l.taxGroup.name,
          supply: l.taxGroup.supply,
        },
      })),
    };
    return {
      ...v,
      state: billState(
        {
          status: v.status,
          total: v.total,
          amountPaid: v.amountPaid,
          dueDate: v.dueDate,
        },
        today,
      ),
    };
  }

  private async find(
    tx: Tx | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const i = await tx.bill.findFirst({
      where: { id, organizationId },
      select,
    });
    if (!i) throw new NotFoundException('Bill not found.');
    return i;
  }

  async get(organizationId: string, id: string) {
    return this.view(
      await this.find(this.prisma, organizationId, id),
      await this.today(organizationId),
    );
  }

  async list(
    organizationId: string,
    q: {
      state?: string;
      contactId?: string;
      search?: string;
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const today = await this.today(organizationId);
    const fields = this.prisma.bill.fields;
    const unpaid = {
      status: 'open',
      amountPaid: { lt: fields.total },
    } as const;
    const byState: Record<string, Prisma.BillWhereInput> = {
      draft: { status: 'draft' },
      void: { status: 'void' },
      open: { status: 'open' },
      paid: { status: 'open', amountPaid: { gte: fields.total } },
      unpaid,
      overdue: { ...unpaid, dueDate: { lt: asDate(today) } },
      partly_paid: {
        ...unpaid,
        amountPaid: { gt: 0, lt: fields.total },
        dueDate: { gte: asDate(today) },
      },
    };
    const where: Prisma.BillWhereInput = {
      organizationId,
      ...(q.state && byState[q.state]),
      ...(q.contactId && { contactId: q.contactId }),
      ...((q.from || q.to) && {
        billDate: {
          ...(q.from && { gte: asDate(q.from) }),
          ...(q.to && { lte: asDate(q.to) }),
        },
      }),
      ...(q.search && {
        OR: [
          { vendorReference: { contains: q.search, mode: 'insensitive' } },
          { contact: { name: { contains: q.search, mode: 'insensitive' } } },
          ...(/^\d+$/.test(q.search) ? [{ number: Number(q.search) }] : []),
        ],
      }),
    };
    const [total, rows, sums] = await Promise.all([
      this.prisma.bill.count({ where }),
      this.prisma.bill.findMany({
        where,
        orderBy: [
          { billDate: 'desc' },
          { number: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select,
      }),
      // What's outstanding in the base currency, and what's overdue
      this.prisma.$queryRaw<
        { outstanding: bigint | null; overdue: bigint | null }[]
      >`
        SELECT sum(total - amount_paid) FILTER (WHERE currency IS NULL)::bigint AS outstanding,
               sum(total - amount_paid) FILTER (WHERE currency IS NULL AND due_date < ${asDate(today)}::date)::bigint AS overdue
        FROM bills WHERE organization_id = ${organizationId}::uuid AND status = 'open' AND amount_paid < total`,
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      summary: {
        outstanding: Number(sums[0]?.outstanding ?? 0),
        overdue: Number(sums[0]?.overdue ?? 0),
      },
      items: rows.map((r) => {
        const v = this.view(r, today);
        return {
          id: v.id,
          number: v.number,
          status: v.status,
          state: v.state,
          contact: { id: v.contact.id, name: v.contact.name },
          billDate: v.billDate,
          dueDate: v.dueDate,
          currency: v.currency,
          total: v.total,
          amountPaid: v.amountPaid,
          balance: v.balance,
          vendorReference: v.vendorReference,
        };
      }),
    };
  }

  /**
   * Checks a draft and works out its lines: expense or asset accounts (the item's when not chosen), tax groups switched to
   * CGST + SGST or IGST by the place of supply, and amounts.
   */
  private async prepare(tx: Tx, organizationId: string, input: DraftIn) {
    const contact = await tx.contact.findFirst({
      where: { organizationId, id: input.contactId },
      select: {
        id: true,
        isVendor: true,
        archivedAt: true,
        currency: true,
        stateCode: true,
        paymentTermsDays: true,
      },
    });
    if (!contact)
      throw refuse(
        BadRequestException,
        'That vendor doesn’t exist.',
        'contact_not_found',
        { field: 'contactId' },
      );
    if (!contact.isVendor)
      throw refuse(
        BadRequestException,
        'This contact isn’t a vendor.',
        'not_vendor',
        { field: 'contactId' },
      );
    if (contact.archivedAt)
      throw refuse(
        BadRequestException,
        'This vendor is archived.',
        'contact_archived',
        { field: 'contactId' },
      );
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { country: true, region: true },
    });
    const orgState =
      org.country === 'IN' ? (findIndianState(org.region)?.code ?? null) : null;
    const placeOfSupply = input.placeOfSupply ?? contact.stateCode;
    const supply =
      orgState && placeOfSupply
        ? orgState === placeOfSupply
          ? 'intra'
          : 'inter'
        : null;

    const itemIds = [
      ...new Set(
        input.lines.map((l) => l.itemId).filter((x): x is string => !!x),
      ),
    ];
    const items = new Map(
      (
        await tx.item.findMany({
          where: { organizationId, id: { in: itemIds } },
          select: { id: true, archivedAt: true, expenseAccountId: true },
        })
      ).map((i) => [i.id, i]),
    );
    if (items.size !== itemIds.length)
      throw refuse(
        BadRequestException,
        'A line uses an item that doesn’t exist.',
        'item_not_found',
      );

    const groupIds = [
      ...new Set(
        input.lines.map((l) => l.taxGroupId).filter((x): x is string => !!x),
      ),
    ];
    const groups = new Map(
      (
        await tx.taxGroup.findMany({
          where: { organizationId, id: { in: groupIds } },
          select: groupSelect,
        })
      ).map((g) => [g.id, g]),
    );
    if (groups.size !== groupIds.length)
      throw refuse(
        BadRequestException,
        'A line uses a tax group that doesn’t exist.',
        'tax_group_not_found',
      );
    // The same GST slab for the other kind of supply (GST 18% ↔ IGST 18%)
    const forSupply = async (
      g: typeof groups extends Map<string, infer G> ? G : never,
    ) => {
      if (!supply || !g.gstSlabId || g.supply === supply) return g;
      const other = await tx.taxGroup.findFirst({
        where: {
          organizationId,
          gstSlabId: g.gstSlabId,
          supply,
          archivedAt: null,
        },
        select: groupSelect,
      });
      return other ?? g;
    };

    const lines: (LineIn & {
      accountId: string;
      group: Awaited<ReturnType<typeof forSupply>> | null;
    })[] = [];
    for (const [n, l] of input.lines.entries()) {
      const item = l.itemId ? items.get(l.itemId)! : null;
      if (item?.archivedAt)
        throw refuse(
          BadRequestException,
          'A line uses an archived item.',
          'item_archived',
          { line: n + 1 },
        );
      const accountId = l.accountId ?? item?.expenseAccountId ?? null;
      if (!accountId)
        throw refuse(
          BadRequestException,
          'Choose an expense or asset account for every line (or give the item one).',
          'account_required',
          { line: n + 1 },
        );
      let group = l.taxGroupId ? groups.get(l.taxGroupId)! : null;
      if (group?.archivedAt)
        throw refuse(
          BadRequestException,
          'A line uses an archived tax group.',
          'tax_group_archived',
          { line: n + 1 },
        );
      if (group) group = await forSupply(group);
      lines.push({ ...l, accountId, group });
    }
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await tx.account.findMany({
      where: { organizationId, id: { in: accountIds } },
      select: { id: true, type: true, archivedAt: true },
    });
    if (accounts.length !== accountIds.length)
      throw refuse(
        BadRequestException,
        'A line uses an account that doesn’t exist.',
        'account_not_found',
      );
    if (accounts.some((a) => a.type !== 'expense' && a.type !== 'asset'))
      throw refuse(
        BadRequestException,
        'Bill lines go to expense or asset accounts.',
        'not_expense',
      );
    if (accounts.some((a) => a.archivedAt))
      throw refuse(
        BadRequestException,
        'A line uses an archived account.',
        'account_archived',
      );

    const amounts = invoiceAmounts(
      lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPpm: l.discount,
        rates: l.group
          ? l.group.rates.map((r) => ({
              rateId: r.rate.id,
              ratePpm: r.rate.ratePpm,
            }))
          : [],
      })),
    );

    // The payable: as chosen, or the first active payable kept in the bill's currency
    const currency = contact.currency;
    let payableAccountId = input.payableAccountId;
    if (payableAccountId) {
      const r = await tx.account.findFirst({
        where: { organizationId, id: payableAccountId },
        select: { type: true, currency: true, archivedAt: true },
      });
      if (!r || r.type !== 'liability' || r.archivedAt)
        throw refuse(
          BadRequestException,
          'Choose an active liability account for what you owe the vendor.',
          'payable_invalid',
          { field: 'payableAccountId' },
        );
      if ((r.currency ?? null) !== currency)
        throw refuse(
          BadRequestException,
          `The payable must be kept in ${currency ?? 'the base currency'}.`,
          'payable_currency',
          { field: 'payableAccountId' },
        );
    } else {
      payableAccountId =
        (
          await tx.account.findFirst({
            where: {
              organizationId,
              subtype: 'accounts_payable',
              currency,
              archivedAt: null,
            },
            orderBy: { code: 'asc' },
            select: { id: true },
          })
        )?.id ?? null;
    }
    return {
      contactId: contact.id,
      currency,
      placeOfSupply,
      dueDate:
        input.dueDate ?? dueDateFor(input.billDate, contact.paymentTermsDays),
      payableAccountId,
      lines,
      amounts,
    };
  }

  private async write(
    tx: Tx,
    organizationId: string,
    billId: string,
    p: Awaited<ReturnType<BillsService['prepare']>>,
  ) {
    await tx.billLine.deleteMany({ where: { billId } });
    await tx.billLine.createMany({
      data: p.lines.map((l, n) => ({
        organizationId,
        billId,
        lineNo: n + 1,
        itemId: l.itemId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: BigInt(l.unitPrice),
        discountPpm: l.discount,
        taxGroupId: l.group?.id ?? null,
        accountId: l.accountId,
        amount: BigInt(p.amounts.lines[n]!.net),
        taxAmount: BigInt(p.amounts.lines[n]!.tax),
      })),
    });
  }

  async createDraft(input: DraftIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const p = await this.prepare(tx, organizationId, input);
      const i = await tx.bill.create({
        data: {
          organizationId,
          contactId: p.contactId,
          billDate: asDate(input.billDate),
          dueDate: asDate(p.dueDate),
          currency: p.currency,
          rate: input.rate,
          placeOfSupply: p.placeOfSupply,
          vendorReference: input.vendorReference,
          notes: input.notes,
          payableAccountId: p.payableAccountId,
          subtotal: BigInt(p.amounts.subtotal),
          taxTotal: BigInt(p.amounts.tax),
          total: BigInt(p.amounts.total),
          createdById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await this.write(tx, organizationId, i.id, p);
      await this.audit.record(
        {
          action: 'org.bill.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bill',
          entityId: i.id,
          after: {
            contactId: p.contactId,
            billDate: input.billDate,
            lines: p.lines.length,
            total: p.amounts.total,
            currency: p.currency,
          },
          req: ctx.req,
        },
        tx,
      );
      return i.id;
    });
    return this.get(organizationId, id);
  }

  async updateDraft(id: string, input: DraftIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const current = await this.find(tx, organizationId, id);
      if (current.status !== 'draft')
        throw refuse(
          ConflictException,
          'Recorded bills can’t be changed. Void it instead.',
          'not_draft',
        );
      const p = await this.prepare(tx, organizationId, input);
      await tx.bill.update({
        where: { id },
        data: {
          contactId: p.contactId,
          billDate: asDate(input.billDate),
          dueDate: asDate(p.dueDate),
          currency: p.currency,
          rate: input.rate,
          placeOfSupply: p.placeOfSupply,
          vendorReference: input.vendorReference,
          notes: input.notes,
          payableAccountId: p.payableAccountId,
          subtotal: BigInt(p.amounts.subtotal),
          taxTotal: BigInt(p.amounts.tax),
          total: BigInt(p.amounts.total),
        },
      });
      await this.write(tx, organizationId, id, p);
      await this.audit.record(
        {
          action: 'org.bill.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bill',
          entityId: id,
          before: { total: Number(current.total), lines: current.lines.length },
          after: { total: p.amounts.total, lines: p.lines.length },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  async deleteDraft(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const i = await this.find(tx, organizationId, id);
      if (i.status !== 'draft')
        throw refuse(
          ConflictException,
          'Recorded bills can’t be deleted. Void it instead.',
          'not_draft',
        );
      await tx.bill.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.bill.delete',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bill',
          entityId: id,
          before: { contact: i.contact.name, total: Number(i.total) },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  /**
   * Records a draft: works its lines out again (tax groups and accounts may have changed since it was saved),
   * gives it the next number in its financial year and posts its entry, which must fall in an open month.
   */
  async record(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const i = await this.find(tx, organizationId, id);
      if (i.status !== 'draft')
        throw refuse(
          ConflictException,
          'This bill is already recorded.',
          'not_draft',
        );
      const billDate = iso(i.billDate);
      const p = await this.prepare(tx, organizationId, {
        contactId: i.contact.id,
        billDate,
        dueDate: iso(i.dueDate),
        vendorReference: i.vendorReference,
        notes: i.notes,
        placeOfSupply: i.placeOfSupply,
        payableAccountId: i.payableAccountId,
        rate: i.rate && rateText(i.rate),
        lines: i.lines.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          quantity: formatQuantity(parseQuantity(l.quantity.toFixed(4))!),
          unitPrice: Number(l.unitPrice),
          discount: l.discountPpm,
          taxGroupId: l.taxGroupId,
          accountId: l.accountId,
        })),
      });
      if (!p.payableAccountId)
        throw refuse(
          ConflictException,
          `There is no payable account${p.currency ? ` kept in ${p.currency}` : ''}. Add one to the chart of accounts.`,
          'no_payable_account',
          { currency: p.currency },
        );
      if (p.amounts.total <= 0)
        throw refuse(
          BadRequestException,
          'A bill must be for more than nothing.',
          'zero_total',
        );
      await this.write(tx, organizationId, id, p);

      const year = await tx.fiscalYear.findFirst({
        where: {
          organizationId,
          startDate: { lte: i.billDate },
          endDate: { gte: i.billDate },
        },
        select: { id: true, name: true },
      });
      if (!year)
        throw refuse(
          ConflictException,
          'There is no financial year for the bill date. Add it under Financial years.',
          'no_period',
        );
      const last = await tx.bill.aggregate({
        where: { organizationId, fiscalYearId: year.id },
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;
      const label = billNumber(year.name, number);

      // The entry: expenses and input tax credit against what's owed to the vendor (like any taxed journal line)
      const { baseCurrency } = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { baseCurrency: true },
      });
      let rate: string | null = null;
      const base = (minor: number) =>
        rate
          ? toBase(
              minor,
              rate,
              currencyDigits(p.currency!),
              currencyDigits(baseCurrency),
            )
          : minor;
      if (p.currency) {
        rate = i.rate
          ? rateText(i.rate)
          : ((await rateOn(tx, organizationId, p.currency, billDate))?.rate ??
            null);
        if (!rate)
          throw refuse(
            BadRequestException,
            `There is no ${p.currency} rate on or before ${billDate}. Add one under Currencies.`,
            'no_rate',
            { currency: p.currency, date: billDate },
          );
      }
      const expense = p.lines.map((l, n) => ({
        accountId: l.accountId,
        description: l.description,
        debit: base(p.amounts.lines[n]!.net),
        credit: 0,
        taxGroupId: l.group?.id ?? null,
        taxInclusive: false,
      }));
      const payable = p.currency
        ? {
            accountId: p.payableAccountId,
            description: label,
            debit: 0,
            credit: 0,
            currency: p.currency,
            foreignDebit: 0,
            foreignCredit: p.amounts.total,
            rate,
          }
        : {
            accountId: p.payableAccountId,
            description: label,
            debit: 0,
            credit: p.amounts.total,
          };
      const lines = [...expense.filter((l) => l.debit > 0), payable];
      if (p.currency) {
        // Converting the parts and the total separately can differ by a paisa or two: book it as an exchange difference
        const parts = expense.reduce(
          (s, l, n) =>
            s +
            l.debit +
            (p.lines[n]!.group
              ? splitTax(
                  l.debit,
                  false,
                  p.lines[n]!.group!.rates.map((r) => ({
                    rateId: r.rate.id,
                    ratePpm: r.rate.ratePpm,
                  })),
                ).taxes.reduce((t, x) => t + x.amount, 0)
              : 0),
          0,
        );
        const diff = base(p.amounts.total) - parts;
        if (diff)
          lines.push({
            accountId: await ensureFxAccount(tx, organizationId, 'fx_realised'),
            description: `${label} rounding`,
            debit: diff > 0 ? diff : 0,
            credit: diff < 0 ? -diff : 0,
          });
      }
      const contactName = i.contact.name;
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: billDate,
          memo: `Bill ${label} · ${contactName}`,
          reference: i.vendorReference ?? label,
          lines,
        },
        ctx.actor.userId,
      );
      await tx.bill.update({
        where: { id },
        data: {
          status: 'open',
          number,
          fiscalYearId: year.id,
          journalEntryId: entry.id,
          rate,
          recordedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          action: 'org.bill.record',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bill',
          entityId: id,
          after: {
            number: label,
            contact: contactName,
            total: p.amounts.total,
            currency: p.currency,
            entry: entry.number,
          },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.get(organizationId, id);
  }

  /** Voids an unpaid bill: its entry is reversed (on the day given, default today) and it stays on record. */
  async void(id: string, input: { date?: string; reason?: string }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const today = await this.today(organizationId);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const i = await this.find(tx, organizationId, id);
      if (i.status !== 'open')
        throw refuse(
          ConflictException,
          i.status === 'void'
            ? 'This bill is already void.'
            : 'Only recorded bills can be voided. Delete the draft instead.',
          'not_open',
        );
      if (i.amountPaid > 0n)
        throw refuse(
          ConflictException,
          'Payments are recorded against this bill. Remove them first.',
          'has_payments',
        );
      const label = billNumber(i.fiscalYear!.name, i.number!);
      const r = await this.journals.reverseInTx(
        tx,
        organizationId,
        i.journalEntry!.id,
        ctx.actor.userId,
        {
          date: input.date ?? today,
          memo: `Bill ${label} voided${input.reason ? `: ${input.reason}` : ''}`,
        },
      );
      await tx.bill.update({
        where: { id },
        data: { status: 'void', voidEntryId: r.id, voidedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'org.bill.void',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'bill',
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
