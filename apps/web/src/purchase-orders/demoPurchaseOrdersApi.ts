import { formatQuantity, goodsReceiptSchema, grnNumber, invoiceAmounts, parseQuantity, poLineOpen, poNumber, purchaseOrderDraftSchema, todayIn, type PoStatus } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoAccountRows } from '../accounts/demoAccountsApi';
import { createDemoBillsApi } from '../bills/demoBillsApi';
import { demoContactRows } from '../contacts/demoContactsApi';
import { groupOf } from '../invoices/demoInvoicesApi';
import { demoItemRows } from '../items/demoItemsApi';
import type { PurchaseOrder, PurchaseOrdersApi } from './types';

/** Purchase orders in demo mode: kept in the browser, priced like bills, billed through the demo's bills */
const KEY = 'ledgernest.demo.purchaseOrders';
type StoredLine = { id: string; itemId: string | null; description: string; quantity: string; unitPrice: number; discountPpm: number; taxGroupId: string | null; accountId: string | null; received: string; billed: string };
type Stored = Omit<PurchaseOrder, 'lines' | 'number' | 'contact' | 'subtotal' | 'taxTotal' | 'total'> & { number: number; contactId: string; lines: StoredLine[] };

function load(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch {
    /* fall through */
  }
  return [];
}
function save(rows: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* private mode */
  }
}
export const resetDemoPurchaseOrders = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 120));

function view(o: Stored): PurchaseOrder {
  const contact = demoContactRows().find((c) => c.id === o.contactId)!;
  const items = demoItemRows();
  const accounts = demoAccountRows();
  const groups = o.lines.map((l) => groupOf(l.taxGroupId));
  const a = invoiceAmounts(o.lines.map((l, n) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPpm: l.discountPpm, rates: (groups[n]?.rates ?? []).map((r) => ({ rateId: r.id, ratePpm: r.ratePpm })) })));
  return {
    ...o,
    number: poNumber(o.number),
    contact: { id: contact.id, name: contact.name, email: contact.email },
    subtotal: a.subtotal,
    taxTotal: a.tax,
    total: a.total,
    lines: o.lines.map((l, n) => {
      const open = poLineOpen(l);
      const item = l.itemId ? items.find((x) => x.id === l.itemId) : undefined;
      const acc = accounts.find((x) => x.id === l.accountId);
      return { id: l.id, lineNo: n + 1, description: l.description, quantity: l.quantity, received: l.received, billed: l.billed, toReceive: formatQuantity(open.toReceive), toBill: formatQuantity(open.toBill), unitPrice: l.unitPrice, discount: l.discountPpm / 10_000, amount: a.lines[n]!.net, taxAmount: a.lines[n]!.tax, item: item ? { id: item.id, name: item.name, unit: item.unit } : null, account: acc ? { id: acc.id, code: acc.code, name: acc.name } : null, taxGroup: groups[n] ? { id: groups[n].id, name: groups[n].name } : null };
    }),
  };
}

export function createDemoPurchaseOrdersApi(canManage: () => boolean): PurchaseOrdersApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['bills.manage'] });
  };
  const find = (rows: Stored[], id: string) => {
    const o = rows.find((r) => r.id === id);
    if (!o) throw new ApiError('not_found', 404);
    return o;
  };
  const prepare = (input: unknown) => {
    const p = purchaseOrderDraftSchema.safeParse(input);
    if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
    const d = p.data;
    const contact = demoContactRows().find((c) => c.id === d.contactId);
    if (!contact) throw refuse(400, 'contact_not_found', { field: 'contactId' });
    if (!contact.isVendor) throw refuse(400, 'not_vendor', { field: 'contactId' });
    return { contactId: d.contactId, orderDate: d.orderDate, expectedDate: d.expectedDate, reference: d.reference, notes: d.notes, placeOfSupply: d.placeOfSupply, currency: contact.currency, lines: d.lines.map((l) => ({ id: crypto.randomUUID(), itemId: l.itemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPpm: l.discount, taxGroupId: l.taxGroupId, accountId: l.accountId, received: '0', billed: '0' })) };
  };
  return {
    list: (q) =>
      wait(() => {
        const s = q.search?.trim().toLowerCase();
        const items = load()
          .map(view)
          .filter((o) => !q.status || (q.status === 'open' ? o.status === 'draft' || o.status === 'issued' : o.status === q.status))
          .filter((o) => !s || [o.number, o.reference, o.contact.name].some((v) => v?.toLowerCase().includes(s)))
          .sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.number.localeCompare(a.number));
        return { total: items.length, page: q.page, pageSize: q.pageSize, items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(({ lines: _l, receipts: _r, ...rest }) => rest) };
      }),
    get: (id) => wait(() => view(find(load(), id))),
    create: (input) =>
      wait(() => {
        guard();
        const rows = load();
        const o: Stored = { id: crypto.randomUUID(), number: Math.max(0, ...rows.map((r) => r.number)) + 1, status: 'draft', ...prepare(input), receipts: [], bills: [] };
        rows.push(o);
        save(rows);
        return view(o);
      }),
    update: (id, input) =>
      wait(() => {
        guard();
        const rows = load();
        const o = find(rows, id);
        if (o.status !== 'draft') throw refuse(409, 'not_draft');
        Object.assign(o, prepare(input));
        save(rows);
        return view(o);
      }),
    remove: (id) =>
      wait(() => {
        guard();
        const rows = load();
        if (find(rows, id).status !== 'draft') throw refuse(409, 'not_draft');
        save(rows.filter((r) => r.id !== id));
      }),
    move: (id, to) =>
      wait(() => {
        guard();
        const rows = load();
        const o = find(rows, id);
        const received = o.lines.some((l) => (parseQuantity(l.received) ?? 0n) > 0n);
        const ok = to === 'issued' ? o.status === 'draft' : to === 'cancelled' ? (o.status === 'draft' || o.status === 'issued') && !received : o.status === 'issued';
        if (!ok) throw refuse(409, 'bad_move', { from: o.status, to });
        o.status = to as PoStatus;
        save(rows);
        return view(o);
      }),
    receive: (id, input) =>
      wait(() => {
        guard();
        const p = goodsReceiptSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const rows = load();
        const o = find(rows, id);
        if (o.status !== 'issued') throw refuse(409, 'not_issued');
        if (p.data.date < o.orderDate) throw refuse(400, 'before_order', { field: 'date' });
        for (const r of p.data.lines) {
          const l = o.lines.find((x) => x.id === r.lineId);
          if (!l) throw refuse(400, 'line_not_found');
          const open = poLineOpen(l);
          if (parseQuantity(r.quantity)! > open.toReceive) throw refuse(409, 'over_received', { toReceive: formatQuantity(open.toReceive) });
        }
        for (const r of p.data.lines) {
          const l = o.lines.find((x) => x.id === r.lineId)!;
          l.received = formatQuantity((parseQuantity(l.received) ?? 0n) + parseQuantity(r.quantity)!);
        }
        const number = Math.max(0, ...rows.flatMap((x) => x.receipts.map((g) => Number(g.number.slice(4))))) + 1;
        o.receipts.push({ id: crypto.randomUUID(), number: grnNumber(number), date: p.data.date, reference: p.data.reference, notes: p.data.notes, lines: p.data.lines });
        save(rows);
        return view(o);
      }),
    bill: (id) =>
      wait(async () => {
        guard();
        const rows = load();
        const o = find(rows, id);
        if (o.status !== 'issued') throw refuse(409, 'not_issued');
        const open = o.lines.map((l) => ({ l, toBill: poLineOpen(l).toBill })).filter((x) => x.toBill > 0n);
        if (!open.length) throw refuse(409, 'nothing_to_bill');
        const bill = await createDemoBillsApi(() => true).create({ contactId: o.contactId, billDate: todayIn('Asia/Kolkata'), notes: `From ${poNumber(o.number)}`, placeOfSupply: o.placeOfSupply, lines: open.map(({ l, toBill }) => ({ itemId: l.itemId, description: l.description, quantity: formatQuantity(toBill), unitPrice: l.unitPrice, discount: l.discountPpm / 10_000, taxGroupId: l.taxGroupId, accountId: l.accountId })) });
        const fresh = load();
        const p = find(fresh, id);
        for (const { l } of open) p.lines.find((x) => x.id === l.id)!.billed = l.received;
        p.bills.push({ id: bill.id, number: bill.number, status: bill.status, total: bill.total });
        if (p.lines.every((l) => (parseQuantity(l.billed) ?? 0n) >= (parseQuantity(l.quantity) ?? 0n))) p.status = 'closed';
        save(fresh);
        return { purchaseOrder: view(p), billId: bill.id };
      }),
  };
}
