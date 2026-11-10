import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  creditNoteNumber,
  currencyDigits,
  dueDateFor,
  paymentNumber,
  findIndianState,
  formatQuantity,
  invoiceAmounts,
  invoiceNumber,
  invoiceState,
  parseQuantity,
  splitTax,
  todayIn,
  toBase,
  type InvoiceStatus,
  accruedInterest,
  interestTermsFor,
  interestTermsText,
  type InterestMethod,
  type InterestTerms,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { ensureFxAccount } from '../accounts/system-accounts.js';
import { AuditService } from '../audit/audit.service.js';
import { allPages, major, toCsv } from '../common/list-export.js';
import { rateOn, rateText } from '../currencies/rate-on.js';
import type { Prisma } from '../generated/prisma/client.js';
import { JournalsService } from '../journals/journals.service.js';
import { checkCostCentres } from '../cost-centres/check.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { WebhooksService } from '../integrations/webhooks.service.js';

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
  costCentreId?: string | null;
  /** For goods kept in batches: the batch to sell from; null = earliest expiry first */
  batchId?: string | null;
  /** For goods with serial numbers: the units sold */
  serials?: string[];
  /** The quantity and price are in the item's second unit */
  inAltUnit?: boolean;
};
export type DraftIn = {
  contactId: string;
  /** The number series to number it from when issued; omitted = the default */
  seriesId?: string | null;
  /** Interest on late payment for this invoice: null = the customer's or organisation's, 0 = none */
  interestRateBp?: number | null;
  issueDate: string;
  dueDate: string | null;
  reference: string | null;
  notes: string | null;
  placeOfSupply: string | null;
  receivableAccountId: string | null;
  rate: string | null;
  lines: LineIn[];
  /** Set when a schedule raises it */
  recurringInvoiceId?: string | null;
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
  issueDate: true,
  dueDate: true,
  currency: true,
  rate: true,
  placeOfSupply: true,
  reference: true,
  notes: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  amountPaid: true,
  issuedAt: true,
  voidedAt: true,
  lastRemindedAt: true,
  shareToken: true,
  shareViews: true,
  shareViewedAt: true,
  irn: true,
  irnAckNo: true,
  irnAckDate: true,
  reminders: true,
  createdAt: true,
  updatedAt: true,
  receivableAccountId: true,
  fiscalYear: { select: { name: true } },
  fullNumber: true,
  seriesId: true,
  interestRateBp: true,
  interestMethod: true,
  interestGraceDays: true,
  contact: {
    select: {
      id: true,
      name: true,
      legalName: true,
      taxId: true,
      email: true,
      phone: true,
      billingAddress: true,
      shippingAddress: true,
      stateCode: true,
      interestRateBp: true,
    },
  },
  receivableAccount: { select: { id: true, code: true, name: true } },
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
  credits: {
    where: { creditNote: { status: 'issued' } },
    orderBy: { createdAt: 'asc' as const },
    select: {
      amount: true,
      date: true,
      creditNote: {
        select: {
          id: true,
          number: true,
          fiscalYear: { select: { name: true } },
          fullNumber: true,
        },
      },
    },
  },
  recurring: { select: { id: true, name: true } },
  creditNotes: {
    orderBy: { number: 'asc' as const },
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      fiscalYear: { select: { name: true } },
      fullNumber: true,
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
      costCentreId: true,
      batchId: true,
      serials: true,
      inAltUnit: true,
      costCentre: { select: { id: true, code: true, name: true } },
      item: {
        select: {
          id: true,
          name: true,
          hsnSac: true,
          unit: true,
          trackBatches: true,
          trackSerials: true,
          altUnit: true,
        },
      },
      account: { select: { id: true, code: true, name: true } },
      taxGroup: { select: groupSelect },
    },
  },
} as const;
type Row = Prisma.InvoiceGetPayload<{ select: typeof select }>;

const entryLabel = (
  e: { number: number | null; fiscalYear: { name: string } | null } | null,
) =>
  e?.number && e.fiscalYear
    ? `JV/${e.fiscalYear.name.replace(/^FY\s*/, '').replace('–', '-')}/${String(e.number).padStart(4, '0')}`
    : null;

/**
 * Sales invoices. A draft can change freely. Issuing gives it a gap-free number in its financial year and posts
 * its entry: the receivable against income and output tax. For Indian GST the tax groups follow the place of supply
 * (CGST + SGST within the state, IGST between states). Voiding reverses the entry; an issued invoice never changes.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journals: JournalsService,
    private readonly inventory: InventoryService,
    private readonly webhooks: WebhooksService,
    private readonly numbering: NumberingService,
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoices:' + organizationId}))`;
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
    // Tax by rate for the invoice's footer (CGST 9% ₹…, SGST 9% ₹…)
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
          ? (i.fullNumber ?? invoiceNumber(i.fiscalYear.name, i.number))
          : null,
      status: i.status as InvoiceStatus,
      issueDate: iso(i.issueDate),
      dueDate: iso(i.dueDate),
      currency: i.currency,
      rate: i.rate && rateText(i.rate),
      placeOfSupply: i.placeOfSupply,
      seriesId: i.seriesId,
      reference: i.reference,
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
      receivableAccount: i.receivableAccount,
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
      /** Receipts that paid it */
      payments: i.allocations.map((a) => ({
        id: a.payment.id,
        number: paymentNumber(
          a.payment.kind as 'receipt',
          a.payment.fiscalYear.name,
          a.payment.number,
        ),
        date: iso(a.payment.date),
        amount: amount(a.amount),
      })),
      /** Credit that came off it, from its own credit notes or others */
      credits: i.credits.map((c) => ({
        id: c.creditNote.id,
        number:
          c.creditNote.fullNumber ??
          creditNoteNumber(c.creditNote.fiscalYear.name, c.creditNote.number),
        date: iso(c.date),
        amount: amount(c.amount),
      })),
      /** The schedule that raised it */
      recurring: i.recurring,
      /** Credit notes raised against it */
      creditNotes: i.creditNotes.map((c) => ({
        id: c.id,
        number: c.fullNumber ?? creditNoteNumber(c.fiscalYear.name, c.number),
        status: c.status as 'issued' | 'void',
        total: amount(c.total),
      })),
      issuedAt: i.issuedAt,
      voidedAt: i.voidedAt,
      /** When a payment reminder last went, and how many have */
      lastRemindedAt: i.lastRemindedAt,
      reminders: i.reminders,
      /** The customer's link (token only: the web app builds the address), how often it was opened and when last */
      share: i.shareToken
        ? {
            token: i.shareToken,
            views: i.shareViews,
            lastViewedAt: i.shareViewedAt,
          }
        : null,
      /** The e-invoice registration from the portal, printed on the invoice */
      irn: i.irn
        ? { irn: i.irn, ackNo: i.irnAckNo, ackDate: i.irnAckDate }
        : null,
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
        // A line in the item's second unit shows that unit
        item: l.item && {
          ...l.item,
          unit: l.inAltUnit ? (l.item.altUnit ?? l.item.unit) : l.item.unit,
        },
        inAltUnit: l.inAltUnit,
        account: l.account,
        costCentre: l.costCentre,
        taxGroup: l.taxGroup && {
          id: l.taxGroup.id,
          name: l.taxGroup.name,
          supply: l.taxGroup.supply,
        },
        batchId: l.batchId,
        /** The serial numbers of the units (goods with serial numbers) */
        serials: l.serials,
        /** The batches an issued line's goods came from (goods kept in batches) */
        batches: [] as {
          batchNo: string;
          mfgDate: string | null;
          expiryDate: string | null;
          quantity: string;
        }[],
      })),
    };
    // Interest on paying late, under the terms it was issued with, to today
    const terms: InterestTerms | null =
      i.status === 'issued' && i.interestMethod && i.interestRateBp
        ? {
            rateBp: i.interestRateBp,
            method: i.interestMethod as InterestMethod,
            graceDays: i.interestGraceDays ?? 0,
          }
        : null;
    const accrued =
      terms &&
      accruedInterest(
        terms,
        { total: v.total, dueDate: v.dueDate },
        [...v.payments, ...v.credits].map((x) => ({
          date: x.date,
          amount: x.amount,
        })),
        today,
      );
    return {
      ...v,
      state: invoiceState(
        {
          status: v.status,
          total: v.total,
          amountPaid: v.amountPaid,
          dueDate: v.dueDate,
        },
        today,
      ),
      /** On a draft: a rate chosen for it (null = the customer's or organisation's, 0 = none) */
      interestRateBp: i.status === 'draft' ? i.interestRateBp : null,
      /** Once issued: its interest terms, and what's accrued to today */
      interest:
        terms && accrued
          ? {
              ...terms,
              text: interestTermsText(terms),
              accrued: accrued.interest,
              perDay: accrued.perDay,
              daysLate: accrued.daysLate,
              inGrace: accrued.inGrace,
            }
          : null,
    };
  }

  private async find(
    tx: Tx | PrismaService,
    organizationId: string,
    id: string,
  ) {
    const i = await tx.invoice.findFirst({
      where: { id, organizationId },
      select,
    });
    if (!i) throw new NotFoundException('Invoice not found.');
    return i;
  }

  async get(organizationId: string, id: string) {
    const v = this.view(
      await this.find(this.prisma, organizationId, id),
      await this.today(organizationId),
    );
    if (v.status !== 'draft' && v.lines.some((l) => l.item?.trackBatches)) {
      const moved = await this.prisma.stockMovement.findMany({
        where: {
          organizationId,
          kind: 'invoice',
          sourceId: id,
          batchId: { not: null },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          sourceLineId: true,
          quantity: true,
          batch: {
            select: { batchNo: true, mfgDate: true, expiryDate: true },
          },
        },
      });
      for (const l of v.lines)
        l.batches = moved
          .filter((m) => m.sourceLineId === l.id)
          .map((m) => ({
            batchNo: m.batch!.batchNo,
            mfgDate: m.batch!.mfgDate ? iso(m.batch!.mfgDate) : null,
            expiryDate: m.batch!.expiryDate ? iso(m.batch!.expiryDate) : null,
            quantity: formatQuantity(
              parseQuantity(String(m.quantity).replace(/^-/, ''))!,
            ),
          }));
    }
    return v;
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
    const fields = this.prisma.invoice.fields;
    const unpaid = {
      status: 'issued',
      amountPaid: { lt: fields.total },
    } as const;
    const byState: Record<string, Prisma.InvoiceWhereInput> = {
      draft: { status: 'draft' },
      void: { status: 'void' },
      issued: { status: 'issued' },
      paid: { status: 'issued', amountPaid: { gte: fields.total } },
      unpaid,
      overdue: { ...unpaid, dueDate: { lt: asDate(today) } },
      partly_paid: {
        ...unpaid,
        amountPaid: { gt: 0, lt: fields.total },
        dueDate: { gte: asDate(today) },
      },
    };
    const where: Prisma.InvoiceWhereInput = {
      organizationId,
      ...(q.state && byState[q.state]),
      ...(q.contactId && { contactId: q.contactId }),
      ...((q.from || q.to) && {
        issueDate: {
          ...(q.from && { gte: asDate(q.from) }),
          ...(q.to && { lte: asDate(q.to) }),
        },
      }),
      ...(q.search && {
        OR: [
          { reference: { contains: q.search, mode: 'insensitive' } },
          { contact: { name: { contains: q.search, mode: 'insensitive' } } },
          { fullNumber: { contains: q.search, mode: 'insensitive' } },
          ...(/^\d{1,9}$/.test(q.search) ? [{ number: Number(q.search) }] : []),
        ],
      }),
    };
    const [total, rows, sums] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        orderBy: [
          { issueDate: 'desc' },
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
        FROM invoices WHERE organization_id = ${organizationId}::uuid AND status = 'issued' AND amount_paid < total`,
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
          issueDate: v.issueDate,
          dueDate: v.dueDate,
          currency: v.currency,
          total: v.total,
          amountPaid: v.amountPaid,
          balance: v.balance,
          reference: v.reference,
        };
      }),
    };
  }

  /** The list as CSV, with the same filters, every page; recorded as an export */
  async exportCsv(
    organizationId: string,
    q: Omit<Parameters<InvoicesService['list']>[1], 'page' | 'pageSize'>,
    ctx: Ctx,
  ) {
    const { baseCurrency } = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    const rows = await allPages((page) =>
      this.list(organizationId, { ...q, page, pageSize: 100 }),
    );
    await this.audit.record({
      action: 'org.report.export',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'report',
      entityId: 'invoices',
      after: { report: 'invoices', ...q, rows: rows.length },
      req: ctx.req,
    });
    return toCsv([
      [
        'number',
        'state',
        'issue_date',
        'due_date',
        'customer',
        'reference',
        'currency',
        'total',
        'paid',
        'balance',
      ],
      ...rows.map((i) => {
        const cur = i.currency ?? baseCurrency;
        return [
          i.number ?? 'Draft',
          i.state,
          i.issueDate,
          i.dueDate,
          i.contact.name,
          i.reference ?? '',
          cur,
          major(i.total, cur),
          // What's paid and owed only means something once issued
          i.status === 'issued' ? major(i.amountPaid, cur) : '',
          i.status === 'issued' ? major(i.balance, cur) : '',
        ];
      }),
    ]);
  }

  /**
   * Checks a draft and works out its lines: income accounts (the item's when not chosen), tax groups switched to
   * CGST + SGST or IGST by the place of supply, and amounts.
   */
  private async prepare(tx: Tx, organizationId: string, input: DraftIn) {
    const contact = await tx.contact.findFirst({
      where: { organizationId, id: input.contactId },
      select: {
        id: true,
        isCustomer: true,
        archivedAt: true,
        currency: true,
        stateCode: true,
        paymentTermsDays: true,
      },
    });
    if (!contact)
      throw refuse(
        BadRequestException,
        'That customer doesn’t exist.',
        'contact_not_found',
        { field: 'contactId' },
      );
    if (!contact.isCustomer)
      throw refuse(
        BadRequestException,
        'This contact isn’t a customer.',
        'not_customer',
        { field: 'contactId' },
      );
    if (contact.archivedAt)
      throw refuse(
        BadRequestException,
        'This customer is archived.',
        'contact_archived',
        { field: 'contactId' },
      );
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { country: true, region: true, gstScheme: true },
    });
    // A composition dealer can't charge GST: its sales are bills of supply
    if (
      org.gstScheme === 'composition' &&
      input.lines.some((l) => l.taxGroupId)
    )
      throw refuse(
        BadRequestException,
        'Under the composition scheme no GST is charged: take the tax off the lines.',
        'composition_no_tax',
      );
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
          select: { id: true, archivedAt: true, incomeAccountId: true },
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
      const accountId = l.accountId ?? item?.incomeAccountId ?? null;
      if (!accountId)
        throw refuse(
          BadRequestException,
          'Choose an income account for every line (or give the item one).',
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
    await checkCostCentres(tx, organizationId, lines);
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
    if (accounts.some((a) => a.type !== 'income'))
      throw refuse(
        BadRequestException,
        'Invoice lines go to income accounts.',
        'not_income',
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

    // The receivable: as chosen, or the first active receivable kept in the invoice's currency
    const currency = contact.currency;
    let receivableAccountId = input.receivableAccountId;
    if (receivableAccountId) {
      const r = await tx.account.findFirst({
        where: { organizationId, id: receivableAccountId },
        select: { type: true, currency: true, archivedAt: true },
      });
      if (!r || r.type !== 'asset' || r.archivedAt)
        throw refuse(
          BadRequestException,
          'Choose an active asset account for what the customer owes.',
          'receivable_invalid',
          { field: 'receivableAccountId' },
        );
      if ((r.currency ?? null) !== currency)
        throw refuse(
          BadRequestException,
          `The receivable must be kept in ${currency ?? 'the base currency'}.`,
          'receivable_currency',
          { field: 'receivableAccountId' },
        );
    } else {
      receivableAccountId =
        (
          await tx.account.findFirst({
            where: {
              organizationId,
              subtype: 'accounts_receivable',
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
        input.dueDate ?? dueDateFor(input.issueDate, contact.paymentTermsDays),
      receivableAccountId,
      lines,
      amounts,
    };
  }

  private async write(
    tx: Tx,
    organizationId: string,
    invoiceId: string,
    p: Awaited<ReturnType<InvoicesService['prepare']>>,
  ) {
    await this.inventory.checkChosenBatches(tx, organizationId, p.lines);
    await tx.invoiceLine.deleteMany({ where: { invoiceId } });
    await tx.invoiceLine.createMany({
      data: p.lines.map((l, n) => ({
        organizationId,
        invoiceId,
        lineNo: n + 1,
        itemId: l.itemId,
        description: l.description,
        quantity: l.quantity,
        unitPrice: BigInt(l.unitPrice),
        discountPpm: l.discount,
        taxGroupId: l.group?.id ?? null,
        accountId: l.accountId,
        costCentreId: l.costCentreId ?? null,
        batchId: l.batchId ?? null,
        serials: (l.serials ?? []).map((x) => x.trim().toUpperCase()),
        inAltUnit: l.inAltUnit ?? false,
        amount: BigInt(p.amounts.lines[n]!.net),
        taxAmount: BigInt(p.amounts.lines[n]!.tax),
      })),
    });
  }

  /**
   * Prices lines as an invoice would (accounts, GST switched by place of supply, amounts) without saving anything.
   * Quotes use it, so they follow the same rules.
   */
  price(organizationId: string, input: DraftIn) {
    return this.prisma.$transaction((tx) =>
      this.prepare(tx, organizationId, input),
    );
  }

  /** `then` runs in the same transaction once the draft exists (a quote marks itself invoiced) */
  /** A series chosen for a draft: an invoice series of this organisation that's still in use */
  private async draftSeries(
    tx: Tx,
    organizationId: string,
    seriesId: string | null | undefined,
  ) {
    if (!seriesId) return null;
    const s = await tx.numberSeries.findFirst({
      where: { organizationId, id: seriesId, type: 'invoice', archived: false },
      select: { id: true },
    });
    if (!s)
      throw refuse(
        BadRequestException,
        'Choose one of your invoice number series.',
        'invalid_series',
        { field: 'seriesId' },
      );
    return s.id;
  }

  async createDraft(
    input: DraftIn,
    ctx: Ctx,
    then?: (tx: Tx, invoiceId: string) => Promise<void>,
  ) {
    const organizationId = ctx.tenant.organizationId;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const p = await this.prepare(tx, organizationId, input);
      const i = await tx.invoice.create({
        data: {
          organizationId,
          contactId: p.contactId,
          issueDate: asDate(input.issueDate),
          dueDate: asDate(p.dueDate),
          currency: p.currency,
          rate: input.rate,
          placeOfSupply: p.placeOfSupply,
          reference: input.reference,
          seriesId: await this.draftSeries(tx, organizationId, input.seriesId),
          notes: input.notes,
          interestRateBp: input.interestRateBp ?? null,
          recurringInvoiceId: input.recurringInvoiceId ?? null,
          receivableAccountId: p.receivableAccountId,
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
          action: 'org.invoice.create',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'invoice',
          entityId: i.id,
          after: {
            contactId: p.contactId,
            issueDate: input.issueDate,
            lines: p.lines.length,
            total: p.amounts.total,
            currency: p.currency,
          },
          req: ctx.req,
        },
        tx,
      );
      if (then) await then(tx, i.id);
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
          'Issued invoices can’t be changed. Void it, or issue a credit note.',
          'not_draft',
        );
      const p = await this.prepare(tx, organizationId, input);
      await tx.invoice.update({
        where: { id },
        data: {
          contactId: p.contactId,
          issueDate: asDate(input.issueDate),
          dueDate: asDate(p.dueDate),
          currency: p.currency,
          rate: input.rate,
          placeOfSupply: p.placeOfSupply,
          reference: input.reference,
          seriesId: await this.draftSeries(tx, organizationId, input.seriesId),
          notes: input.notes,
          interestRateBp: input.interestRateBp ?? null,
          receivableAccountId: p.receivableAccountId,
          subtotal: BigInt(p.amounts.subtotal),
          taxTotal: BigInt(p.amounts.tax),
          total: BigInt(p.amounts.total),
        },
      });
      await this.write(tx, organizationId, id, p);
      await this.audit.record(
        {
          action: 'org.invoice.update',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'invoice',
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
          'Issued invoices can’t be deleted. Void it instead.',
          'not_draft',
        );
      await tx.documentAttachment.deleteMany({
        where: { organizationId, documentType: 'invoice', documentId: id },
      });
      // A quote it came from goes back to accepted, ready to invoice again
      await tx.quote.updateMany({
        where: { organizationId, invoiceId: id },
        data: { invoiceId: null, status: 'accepted' },
      });
      await tx.invoice.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'org.invoice.delete',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'invoice',
          entityId: id,
          before: { contact: i.contact.name, total: Number(i.total) },
          req: ctx.req,
        },
        tx,
      );
    });
  }

  /**
   * Issues a draft: works its lines out again (tax groups and accounts may have changed since it was saved),
   * gives it the next number in its financial year and posts its entry, which must fall in an open month.
   */
  async issue(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const i = await this.find(tx, organizationId, id);
      if (i.status !== 'draft')
        throw refuse(
          ConflictException,
          'This invoice is already issued.',
          'not_draft',
        );
      const issueDate = iso(i.issueDate);
      const p = await this.prepare(tx, organizationId, {
        contactId: i.contact.id,
        issueDate,
        dueDate: iso(i.dueDate),
        reference: i.reference,
        notes: i.notes,
        placeOfSupply: i.placeOfSupply,
        receivableAccountId: i.receivableAccountId,
        rate: i.rate && rateText(i.rate),
        lines: i.lines.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          quantity: formatQuantity(parseQuantity(l.quantity.toFixed(4))!),
          unitPrice: Number(l.unitPrice),
          discount: l.discountPpm,
          taxGroupId: l.taxGroupId,
          accountId: l.accountId,
          costCentreId: l.costCentreId,
          batchId: l.batchId,
          serials: l.serials,
          inAltUnit: l.inAltUnit,
        })),
      });
      if (!p.receivableAccountId)
        throw refuse(
          ConflictException,
          `There is no receivable account${p.currency ? ` kept in ${p.currency}` : ''}. Add one to the chart of accounts.`,
          'no_receivable_account',
          { currency: p.currency },
        );
      if (p.amounts.total <= 0)
        throw refuse(
          BadRequestException,
          'An invoice must be for more than nothing.',
          'zero_total',
        );
      await this.write(tx, organizationId, id, p);

      const year = await tx.fiscalYear.findFirst({
        where: {
          organizationId,
          startDate: { lte: i.issueDate },
          endDate: { gte: i.issueDate },
        },
        select: { id: true, name: true },
      });
      if (!year)
        throw refuse(
          ConflictException,
          'There is no financial year for the issue date. Add it under Financial years.',
          'no_period',
        );
      const {
        seriesId,
        number,
        fullNumber: label,
      } = await this.numbering.allocate(
        tx,
        organizationId,
        'invoice',
        i.seriesId,
        year,
      );

      // The entry: what the customer owes against income and output tax (worked out like any taxed journal line)
      // The interest terms it's issued with stay with it: the draft's own rate, else the customer's, else ours
      const orgTerms = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: {
          interestRateBp: true,
          interestMethod: true,
          interestGraceDays: true,
        },
      });
      const terms = interestTermsFor(
        {
          rateBp: orgTerms.interestRateBp,
          method: orgTerms.interestMethod as InterestMethod,
          graceDays: orgTerms.interestGraceDays,
        },
        { rateBp: i.contact.interestRateBp },
        { rateBp: i.interestRateBp },
      );
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
          : ((await rateOn(tx, organizationId, p.currency, issueDate))?.rate ??
            null);
        if (!rate)
          throw refuse(
            BadRequestException,
            `There is no ${p.currency} rate on or before ${issueDate}. Add one under Currencies.`,
            'no_rate',
            { currency: p.currency, date: issueDate },
          );
      }
      const income = p.lines.map((l, n) => ({
        accountId: l.accountId,
        description: l.description,
        debit: 0,
        credit: base(p.amounts.lines[n]!.net),
        taxGroupId: l.group?.id ?? null,
        taxInclusive: false,
        costCentreId: l.costCentreId ?? null,
      }));
      const receivable = p.currency
        ? {
            accountId: p.receivableAccountId,
            description: label,
            debit: 0,
            credit: 0,
            currency: p.currency,
            foreignDebit: p.amounts.total,
            foreignCredit: 0,
            rate,
          }
        : {
            accountId: p.receivableAccountId,
            description: label,
            debit: p.amounts.total,
            credit: 0,
          };
      const lines = [receivable, ...income.filter((l) => l.credit > 0)];
      if (p.currency) {
        // Converting the parts and the total separately can differ by a paisa or two: book it as an exchange difference
        const parts = income.reduce(
          (s, l, n) =>
            s +
            l.credit +
            (p.lines[n]!.group
              ? splitTax(
                  l.credit,
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
            debit: diff < 0 ? -diff : 0,
            credit: diff > 0 ? diff : 0,
          });
      }
      const contactName = i.contact.name;
      // Tracked goods leave stock at their average cost, to cost of sales
      // The lines as written at issue, so stock movements point to them
      const lineIds = await tx.invoiceLine.findMany({
        where: { invoiceId: id },
        orderBy: { lineNo: 'asc' },
        select: { id: true },
      });
      const cost = await this.inventory.costOfSale(
        tx,
        organizationId,
        p.lines.map((l, n) => ({
          id: lineIds[n]?.id,
          itemId: l.itemId,
          quantity: l.quantity,
          costCentreId: l.costCentreId ?? null,
          batchId: l.batchId ?? null,
          serials: l.serials ?? [],
          inAltUnit: l.inAltUnit ?? false,
        })),
        issueDate,
      );
      const entry = await this.journals.postEntryInTx(
        tx,
        organizationId,
        {
          date: issueDate,
          memo: `Invoice ${label} · ${contactName}`,
          reference: label,
          lines: [...lines, ...cost.journal],
        },
        ctx.actor.userId,
      );
      await this.inventory.save(
        tx,
        organizationId,
        {
          kind: 'invoice',
          sourceId: id,
          date: issueDate,
          journalEntryId: entry.id,
          actorId: ctx.actor.userId,
        },
        cost.movements,
      );
      await tx.invoice.update({
        where: { id },
        data: {
          status: 'issued',
          number,
          seriesId,
          fullNumber: label,
          fiscalYearId: year.id,
          journalEntryId: entry.id,
          rate,
          issuedAt: new Date(),
          interestRateBp: terms?.rateBp ?? 0,
          interestMethod: terms?.method ?? null,
          interestGraceDays: terms?.graceDays ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'org.invoice.issue',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'invoice',
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
    const done = await this.get(organizationId, id);
    void this.webhooks.emit(
      organizationId,
      'invoice.issued',
      done,
      ctx.actor.userId,
    );
    return done;
  }

  /** Voids an unpaid invoice: its entry is reversed (on the day given, default today) and it stays on record. */
  async void(id: string, input: { date?: string; reason?: string }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const today = await this.today(organizationId);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const i = await this.find(tx, organizationId, id);
      if (i.status !== 'issued')
        throw refuse(
          ConflictException,
          i.status === 'void'
            ? 'This invoice is already void.'
            : 'Only issued invoices can be voided. Delete the draft instead.',
          'not_issued',
        );
      if (i.amountPaid > 0n)
        throw refuse(
          ConflictException,
          'Payments are recorded against this invoice. Remove them first, or issue a credit note.',
          'has_payments',
        );
      const label =
        i.fullNumber ?? invoiceNumber(i.fiscalYear!.name, i.number!);
      const r = await this.journals.reverseInTx(
        tx,
        organizationId,
        i.journalEntry!.id,
        ctx.actor.userId,
        {
          date: input.date ?? today,
          memo: `Invoice ${label} voided${input.reason ? `: ${input.reason}` : ''}`,
        },
      );
      await this.inventory.undoDocument(
        tx,
        organizationId,
        'invoice',
        id,
        input.date ?? today,
        r.id,
        ctx.actor.userId,
      );
      await tx.invoice.update({
        where: { id },
        data: { status: 'void', voidEntryId: r.id, voidedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'org.invoice.void',
          actorId: ctx.actor.userId,
          organizationId,
          entityType: 'invoice',
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
      'invoice.voided',
      done,
      ctx.actor.userId,
    );
    return done;
  }
}
