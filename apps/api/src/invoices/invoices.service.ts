import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { currencyDigits, dueDateFor, findIndianState, formatQuantity, invoiceAmounts, invoiceNumber, invoiceState, parseQuantity, splitTax, todayIn, toBase, type InvoiceStatus } from '@ledgernest/shared';
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
type LineIn = { itemId: string | null; description: string; quantity: string; unitPrice: number; discount: number; taxGroupId: string | null; accountId: string | null };
type DraftIn = { contactId: string; issueDate: string; dueDate: string | null; reference: string | null; notes: string | null; placeOfSupply: string | null; receivableAccountId: string | null; rate: string | null; lines: LineIn[] };

const refuse = (Ex: typeof ConflictException | typeof BadRequestException, message: string, reason: string, extra: object = {}) =>
  new Ex({ message, details: { reason, ...extra } });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

const groupSelect = { id: true, name: true, archivedAt: true, gstSlabId: true, supply: true, rates: { orderBy: { position: 'asc' as const }, select: { rate: { select: { id: true, name: true, ratePpm: true } } } } } as const;
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
  createdAt: true,
  updatedAt: true,
  receivableAccountId: true,
  fiscalYear: { select: { name: true } },
  contact: { select: { id: true, name: true, legalName: true, taxId: true, email: true, billingAddress: true, shippingAddress: true, stateCode: true } },
  receivableAccount: { select: { id: true, code: true, name: true } },
  journalEntry: { select: { id: true, number: true, fiscalYear: { select: { name: true } } } },
  voidEntry: { select: { id: true, number: true, fiscalYear: { select: { name: true } } } },
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
type Row = Prisma.InvoiceGetPayload<{ select: typeof select }>;

const entryLabel = (e: { number: number | null; fiscalYear: { name: string } | null } | null) => (e?.number && e.fiscalYear ? `JV/${e.fiscalYear.name.replace(/^FY\s*/, '').replace('–', '-')}/${String(e.number).padStart(4, '0')}` : null);

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
  ) {}

  private lock(tx: Tx, organizationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoices:' + organizationId}))`;
  }

  private async today(organizationId: string) {
    const { timeZone } = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timeZone: true } });
    return todayIn(timeZone);
  }

  private view(i: Row, today: string) {
    const amount = (b: bigint) => Number(b);
    // Tax by rate for the invoice's footer (CGST 9% ₹…, SGST 9% ₹…)
    const breakdown = new Map<string, number>();
    for (const l of i.lines) {
      if (!l.taxGroup) continue;
      const { taxes } = splitTax(Number(l.amount), false, l.taxGroup.rates.map((r) => ({ rateId: r.rate.id, ratePpm: r.rate.ratePpm })));
      taxes.forEach((t, n) => {
        const name = l.taxGroup!.rates[n]!.rate.name;
        breakdown.set(name, (breakdown.get(name) ?? 0) + t.amount);
      });
    }
    const v = {
      id: i.id,
      number: i.number && i.fiscalYear ? invoiceNumber(i.fiscalYear.name, i.number) : null,
      status: i.status as InvoiceStatus,
      issueDate: iso(i.issueDate),
      dueDate: iso(i.dueDate),
      currency: i.currency,
      rate: i.rate && rateText(i.rate),
      placeOfSupply: i.placeOfSupply,
      reference: i.reference,
      notes: i.notes,
      contact: { ...i.contact, billingAddress: i.contact.billingAddress as Record<string, string | null>, shippingAddress: i.contact.shippingAddress as Record<string, string | null> | null },
      receivableAccount: i.receivableAccount,
      subtotal: amount(i.subtotal),
      taxTotal: amount(i.taxTotal),
      total: amount(i.total),
      amountPaid: amount(i.amountPaid),
      balance: amount(i.total - i.amountPaid),
      taxBreakdown: [...breakdown].map(([name, value]) => ({ name, amount: value })),
      journalEntry: i.journalEntry && { id: i.journalEntry.id, number: entryLabel(i.journalEntry) },
      voidEntry: i.voidEntry && { id: i.voidEntry.id, number: entryLabel(i.voidEntry) },
      issuedAt: i.issuedAt,
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
        taxGroup: l.taxGroup && { id: l.taxGroup.id, name: l.taxGroup.name, supply: l.taxGroup.supply },
      })),
    };
    return { ...v, state: invoiceState({ status: v.status, total: v.total, amountPaid: v.amountPaid, dueDate: v.dueDate }, today) };
  }

  private async find(tx: Tx | PrismaService, organizationId: string, id: string) {
    const i = await tx.invoice.findFirst({ where: { id, organizationId }, select });
    if (!i) throw new NotFoundException('Invoice not found.');
    return i;
  }

  async get(organizationId: string, id: string) {
    return this.view(await this.find(this.prisma, organizationId, id), await this.today(organizationId));
  }

  async list(organizationId: string, q: { state?: string; contactId?: string; search?: string; from?: string; to?: string; page: number; pageSize: number }) {
    const today = await this.today(organizationId);
    const fields = this.prisma.invoice.fields;
    const unpaid = { status: 'issued', amountPaid: { lt: fields.total } } as const;
    const byState: Record<string, Prisma.InvoiceWhereInput> = {
      draft: { status: 'draft' },
      void: { status: 'void' },
      issued: { status: 'issued' },
      paid: { status: 'issued', amountPaid: { gte: fields.total } },
      unpaid,
      overdue: { ...unpaid, dueDate: { lt: asDate(today) } },
      partly_paid: { ...unpaid, amountPaid: { gt: 0, lt: fields.total }, dueDate: { gte: asDate(today) } },
    };
    const where: Prisma.InvoiceWhereInput = {
      organizationId,
      ...(q.state && byState[q.state]),
      ...(q.contactId && { contactId: q.contactId }),
      ...((q.from || q.to) && { issueDate: { ...(q.from && { gte: asDate(q.from) }), ...(q.to && { lte: asDate(q.to) }) } }),
      ...(q.search && { OR: [{ reference: { contains: q.search, mode: 'insensitive' } }, { contact: { name: { contains: q.search, mode: 'insensitive' } } }, ...(/^\d+$/.test(q.search) ? [{ number: Number(q.search) }] : [])] }),
    };
    const [total, rows, sums] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({ where, orderBy: [{ issueDate: 'desc' }, { number: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, select }),
      // What's outstanding in the base currency, and what's overdue
      this.prisma.$queryRaw<{ outstanding: bigint | null; overdue: bigint | null }[]>`
        SELECT sum(total - amount_paid) FILTER (WHERE currency IS NULL)::bigint AS outstanding,
               sum(total - amount_paid) FILTER (WHERE currency IS NULL AND due_date < ${asDate(today)}::date)::bigint AS overdue
        FROM invoices WHERE organization_id = ${organizationId}::uuid AND status = 'issued' AND amount_paid < total`,
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      summary: { outstanding: Number(sums[0]?.outstanding ?? 0), overdue: Number(sums[0]?.overdue ?? 0) },
      items: rows.map((r) => {
        const v = this.view(r, today);
        return { id: v.id, number: v.number, status: v.status, state: v.state, contact: { id: v.contact.id, name: v.contact.name }, issueDate: v.issueDate, dueDate: v.dueDate, currency: v.currency, total: v.total, amountPaid: v.amountPaid, balance: v.balance, reference: v.reference };
      }),
    };
  }

  /**
   * Checks a draft and works out its lines: income accounts (the item's when not chosen), tax groups switched to
   * CGST + SGST or IGST by the place of supply, and amounts.
   */
  private async prepare(tx: Tx, organizationId: string, input: DraftIn) {
    const contact = await tx.contact.findFirst({ where: { organizationId, id: input.contactId }, select: { id: true, isCustomer: true, archivedAt: true, currency: true, stateCode: true, paymentTermsDays: true } });
    if (!contact) throw refuse(BadRequestException, 'That customer doesn’t exist.', 'contact_not_found', { field: 'contactId' });
    if (!contact.isCustomer) throw refuse(BadRequestException, 'This contact isn’t a customer.', 'not_customer', { field: 'contactId' });
    if (contact.archivedAt) throw refuse(BadRequestException, 'This customer is archived.', 'contact_archived', { field: 'contactId' });
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { country: true, region: true } });
    const orgState = org.country === 'IN' ? (findIndianState(org.region)?.code ?? null) : null;
    const placeOfSupply = input.placeOfSupply ?? contact.stateCode;
    const supply = orgState && placeOfSupply ? (orgState === placeOfSupply ? 'intra' : 'inter') : null;

    const itemIds = [...new Set(input.lines.map((l) => l.itemId).filter((x): x is string => !!x))];
    const items = new Map((await tx.item.findMany({ where: { organizationId, id: { in: itemIds } }, select: { id: true, archivedAt: true, incomeAccountId: true } })).map((i) => [i.id, i]));
    if (items.size !== itemIds.length) throw refuse(BadRequestException, 'A line uses an item that doesn’t exist.', 'item_not_found');

    const groupIds = [...new Set(input.lines.map((l) => l.taxGroupId).filter((x): x is string => !!x))];
    const groups = new Map((await tx.taxGroup.findMany({ where: { organizationId, id: { in: groupIds } }, select: groupSelect })).map((g) => [g.id, g]));
    if (groups.size !== groupIds.length) throw refuse(BadRequestException, 'A line uses a tax group that doesn’t exist.', 'tax_group_not_found');
    // The same GST slab for the other kind of supply (GST 18% ↔ IGST 18%)
    const forSupply = async (g: (typeof groups extends Map<string, infer G> ? G : never)) => {
      if (!supply || !g.gstSlabId || g.supply === supply) return g;
      const other = await tx.taxGroup.findFirst({ where: { organizationId, gstSlabId: g.gstSlabId, supply, archivedAt: null }, select: groupSelect });
      return other ?? g;
    };

    const lines: (LineIn & { accountId: string; group: Awaited<ReturnType<typeof forSupply>> | null })[] = [];
    for (const [n, l] of input.lines.entries()) {
      const item = l.itemId ? items.get(l.itemId)! : null;
      if (item?.archivedAt) throw refuse(BadRequestException, 'A line uses an archived item.', 'item_archived', { line: n + 1 });
      const accountId = l.accountId ?? item?.incomeAccountId ?? null;
      if (!accountId) throw refuse(BadRequestException, 'Choose an income account for every line (or give the item one).', 'account_required', { line: n + 1 });
      let group = l.taxGroupId ? groups.get(l.taxGroupId)! : null;
      if (group?.archivedAt) throw refuse(BadRequestException, 'A line uses an archived tax group.', 'tax_group_archived', { line: n + 1 });
      if (group) group = await forSupply(group);
      lines.push({ ...l, accountId, group });
    }
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await tx.account.findMany({ where: { organizationId, id: { in: accountIds } }, select: { id: true, type: true, archivedAt: true } });
    if (accounts.length !== accountIds.length) throw refuse(BadRequestException, 'A line uses an account that doesn’t exist.', 'account_not_found');
    if (accounts.some((a) => a.type !== 'income')) throw refuse(BadRequestException, 'Invoice lines go to income accounts.', 'not_income');
    if (accounts.some((a) => a.archivedAt)) throw refuse(BadRequestException, 'A line uses an archived account.', 'account_archived');

    const amounts = invoiceAmounts(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPpm: l.discount, rates: l.group ? l.group.rates.map((r) => ({ rateId: r.rate.id, ratePpm: r.rate.ratePpm })) : [] })));

    // The receivable: as chosen, or the first active receivable kept in the invoice's currency
    const currency = contact.currency;
    let receivableAccountId = input.receivableAccountId;
    if (receivableAccountId) {
      const r = await tx.account.findFirst({ where: { organizationId, id: receivableAccountId }, select: { type: true, currency: true, archivedAt: true } });
      if (!r || r.type !== 'asset' || r.archivedAt) throw refuse(BadRequestException, 'Choose an active asset account for what the customer owes.', 'receivable_invalid', { field: 'receivableAccountId' });
      if ((r.currency ?? null) !== currency) throw refuse(BadRequestException, `The receivable must be kept in ${currency ?? 'the base currency'}.`, 'receivable_currency', { field: 'receivableAccountId' });
    } else {
      receivableAccountId = (await tx.account.findFirst({ where: { organizationId, subtype: 'accounts_receivable', currency, archivedAt: null }, orderBy: { code: 'asc' }, select: { id: true } }))?.id ?? null;
    }
    return {
      contactId: contact.id,
      currency,
      placeOfSupply,
      dueDate: input.dueDate ?? dueDateFor(input.issueDate, contact.paymentTermsDays),
      receivableAccountId,
      lines,
      amounts,
    };
  }

  private async write(tx: Tx, organizationId: string, invoiceId: string, p: Awaited<ReturnType<InvoicesService['prepare']>>) {
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
      const i = await tx.invoice.create({
        data: { organizationId, contactId: p.contactId, issueDate: asDate(input.issueDate), dueDate: asDate(p.dueDate), currency: p.currency, rate: input.rate, placeOfSupply: p.placeOfSupply, reference: input.reference, notes: input.notes, receivableAccountId: p.receivableAccountId, subtotal: BigInt(p.amounts.subtotal), taxTotal: BigInt(p.amounts.tax), total: BigInt(p.amounts.total), createdById: ctx.actor.userId },
        select: { id: true },
      });
      await this.write(tx, organizationId, i.id, p);
      await this.audit.record({ action: 'org.invoice.create', actorId: ctx.actor.userId, organizationId, entityType: 'invoice', entityId: i.id, after: { contactId: p.contactId, issueDate: input.issueDate, lines: p.lines.length, total: p.amounts.total, currency: p.currency }, req: ctx.req }, tx);
      return i.id;
    });
    return this.get(organizationId, id);
  }

  async updateDraft(id: string, input: DraftIn, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const current = await this.find(tx, organizationId, id);
      if (current.status !== 'draft') throw refuse(ConflictException, 'Issued invoices can’t be changed. Void it, or issue a credit note.', 'not_draft');
      const p = await this.prepare(tx, organizationId, input);
      await tx.invoice.update({
        where: { id },
        data: { contactId: p.contactId, issueDate: asDate(input.issueDate), dueDate: asDate(p.dueDate), currency: p.currency, rate: input.rate, placeOfSupply: p.placeOfSupply, reference: input.reference, notes: input.notes, receivableAccountId: p.receivableAccountId, subtotal: BigInt(p.amounts.subtotal), taxTotal: BigInt(p.amounts.tax), total: BigInt(p.amounts.total) },
      });
      await this.write(tx, organizationId, id, p);
      await this.audit.record({ action: 'org.invoice.update', actorId: ctx.actor.userId, organizationId, entityType: 'invoice', entityId: id, before: { total: Number(current.total), lines: current.lines.length }, after: { total: p.amounts.total, lines: p.lines.length }, req: ctx.req }, tx);
    });
    return this.get(organizationId, id);
  }

  async deleteDraft(id: string, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const i = await this.find(tx, organizationId, id);
      if (i.status !== 'draft') throw refuse(ConflictException, 'Issued invoices can’t be deleted. Void it instead.', 'not_draft');
      await tx.invoice.delete({ where: { id } });
      await this.audit.record({ action: 'org.invoice.delete', actorId: ctx.actor.userId, organizationId, entityType: 'invoice', entityId: id, before: { contact: i.contact.name, total: Number(i.total) }, req: ctx.req }, tx);
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
      if (i.status !== 'draft') throw refuse(ConflictException, 'This invoice is already issued.', 'not_draft');
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
        lines: i.lines.map((l) => ({ itemId: l.itemId, description: l.description, quantity: formatQuantity(parseQuantity(l.quantity.toFixed(4))!), unitPrice: Number(l.unitPrice), discount: l.discountPpm, taxGroupId: l.taxGroupId, accountId: l.accountId })),
      });
      if (!p.receivableAccountId) throw refuse(ConflictException, `There is no receivable account${p.currency ? ` kept in ${p.currency}` : ''}. Add one to the chart of accounts.`, 'no_receivable_account', { currency: p.currency });
      if (p.amounts.total <= 0) throw refuse(BadRequestException, 'An invoice must be for more than nothing.', 'zero_total');
      await this.write(tx, organizationId, id, p);

      const year = await tx.fiscalYear.findFirst({ where: { organizationId, startDate: { lte: i.issueDate }, endDate: { gte: i.issueDate } }, select: { id: true, name: true } });
      if (!year) throw refuse(ConflictException, 'There is no financial year for the issue date. Add it under Financial years.', 'no_period');
      const last = await tx.invoice.aggregate({ where: { organizationId, fiscalYearId: year.id }, _max: { number: true } });
      const number = (last._max.number ?? 0) + 1;
      const label = invoiceNumber(year.name, number);

      // The entry: what the customer owes against income and output tax (worked out like any taxed journal line)
      const { baseCurrency } = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { baseCurrency: true } });
      let rate: string | null = null;
      const base = (minor: number) => (rate ? toBase(minor, rate, currencyDigits(p.currency!), currencyDigits(baseCurrency)) : minor);
      if (p.currency) {
        rate = i.rate ? rateText(i.rate) : ((await rateOn(tx, organizationId, p.currency, issueDate))?.rate ?? null);
        if (!rate) throw refuse(BadRequestException, `There is no ${p.currency} rate on or before ${issueDate}. Add one under Currencies.`, 'no_rate', { currency: p.currency, date: issueDate });
      }
      const income = p.lines.map((l, n) => ({ accountId: l.accountId, description: l.description, debit: 0, credit: base(p.amounts.lines[n]!.net), taxGroupId: l.group?.id ?? null, taxInclusive: false }));
      const receivable = p.currency
        ? { accountId: p.receivableAccountId, description: label, debit: 0, credit: 0, currency: p.currency, foreignDebit: p.amounts.total, foreignCredit: 0, rate }
        : { accountId: p.receivableAccountId, description: label, debit: p.amounts.total, credit: 0 };
      const lines = [receivable, ...income.filter((l) => l.credit > 0)];
      if (p.currency) {
        // Converting the parts and the total separately can differ by a paisa or two: book it as an exchange difference
        const parts = income.reduce((s, l, n) => s + l.credit + (p.lines[n]!.group ? splitTax(l.credit, false, p.lines[n]!.group!.rates.map((r) => ({ rateId: r.rate.id, ratePpm: r.rate.ratePpm }))).taxes.reduce((t, x) => t + x.amount, 0) : 0), 0);
        const diff = base(p.amounts.total) - parts;
        if (diff) lines.push({ accountId: await ensureFxAccount(tx, organizationId, 'fx_realised'), description: `${label} rounding`, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0 });
      }
      const contactName = i.contact.name;
      const entry = await this.journals.postEntryInTx(tx, organizationId, { date: issueDate, memo: `Invoice ${label} · ${contactName}`, reference: label, lines }, ctx.actor.userId);
      await tx.invoice.update({ where: { id }, data: { status: 'issued', number, fiscalYearId: year.id, journalEntryId: entry.id, rate, issuedAt: new Date() } });
      await this.audit.record({ action: 'org.invoice.issue', actorId: ctx.actor.userId, organizationId, entityType: 'invoice', entityId: id, after: { number: label, contact: contactName, total: p.amounts.total, currency: p.currency, entry: entry.number }, req: ctx.req }, tx);
    });
    return this.get(organizationId, id);
  }

  /** Voids an unpaid invoice: its entry is reversed (on the day given, default today) and it stays on record. */
  async void(id: string, input: { date?: string; reason?: string }, ctx: Ctx) {
    const organizationId = ctx.tenant.organizationId;
    const today = await this.today(organizationId);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);
      const i = await this.find(tx, organizationId, id);
      if (i.status !== 'issued') throw refuse(ConflictException, i.status === 'void' ? 'This invoice is already void.' : 'Only issued invoices can be voided. Delete the draft instead.', 'not_issued');
      if (i.amountPaid > 0n) throw refuse(ConflictException, 'Payments are recorded against this invoice. Remove them first, or issue a credit note.', 'has_payments');
      const label = invoiceNumber(i.fiscalYear!.name, i.number!);
      const r = await this.journals.reverseInTx(tx, organizationId, i.journalEntry!.id, ctx.actor.userId, { date: input.date ?? today, memo: `Invoice ${label} voided${input.reason ? `: ${input.reason}` : ''}` });
      await tx.invoice.update({ where: { id }, data: { status: 'void', voidEntryId: r.id, voidedAt: new Date() } });
      await this.audit.record({ action: 'org.invoice.void', actorId: ctx.actor.userId, organizationId, entityType: 'invoice', entityId: id, after: { number: label, reversal: r.number, reason: input.reason ?? null }, req: ctx.req }, tx);
    });
    return this.get(organizationId, id);
  }
}
