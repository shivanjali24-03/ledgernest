import { averageUnitCost, costOfQuantity, formatQuantity, parseQuantity, stockAdjustmentSchema, todayIn, type EnteredLine, type StockMovementKind } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoAccountRows } from '../accounts/demoAccountsApi';
import { demoItemRows } from '../items/demoItemsApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import type { InventoryApi, StockMovement } from './types';

/**
 * Stock in demo mode, kept in this browser with the same rules as the API: weighted average cost, bills in,
 * invoices out to cost of sales, adjustments against another account. The demo's items, invoices and bills
 * use the helpers here.
 */
const KEY = 'ledgernest.demo.stock';
type Stored = { id: string; itemId: string; date: string; kind: StockMovementKind; sourceId: string | null; quantity: string; value: number; reason: string | null; journalEntryId: string | null; createdAt: string };
type TrackedItem = { id: string; name: string; trackStock: boolean; inventoryAccountId: string | null; cogsAccountId: string | null };

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
export const resetDemoStock = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

/** Ten-thousandths, signed, from text like "-2.5" */
const q = (text: string) => (text.startsWith('-') ? -(parseQuantity(text.slice(1)) ?? 0n) : (parseQuantity(text) ?? 0n));
const qtyText = (n: bigint) => `${n < 0n ? '-' : ''}${formatQuantity(n < 0n ? -n : n)}`;
const refuse = (status: 400 | 404 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : status === 404 ? 'not_found' : 'conflict', status, undefined, undefined, { reason, ...extra });

/** What's on hand of an item (optionally as of a day) */
export function demoStockOf(itemId: string, asOf?: string) {
  let quantity = 0n;
  let value = 0n;
  for (const m of load())
    if (m.itemId === itemId && (!asOf || m.date <= asOf)) {
      quantity += q(m.quantity);
      value += BigInt(m.value);
    }
  return { quantity, value };
}
export const demoItemHasMovements = (itemId: string) => load().some((m) => m.itemId === itemId);

const itemsOf = (): TrackedItem[] => demoItemRows();
const trackedItem = (id: string | null) => (id ? itemsOf().find((i) => i.id === id && i.trackStock) : undefined);

/** For a demo invoice being issued: its tracked goods at average cost, and the lines moving that to cost of sales */
export function demoCostOfSale(lines: { itemId: string | null; quantity: string; costCentreId?: string | null }[]) {
  const stock = new Map<string, { quantity: bigint; value: bigint }>();
  const movements: { itemId: string; quantity: bigint; value: bigint }[] = [];
  const journal: EnteredLine[] = [];
  for (const l of lines) {
    const item = trackedItem(l.itemId);
    if (!item) continue;
    const s = stock.get(item.id) ?? demoStockOf(item.id);
    const n = parseQuantity(l.quantity)!;
    if (n > s.quantity) throw refuse(409, 'insufficient_stock', { itemId: item.id, onHand: formatQuantity(s.quantity > 0n ? s.quantity : 0n) });
    const value = costOfQuantity(s.quantity, s.value, n);
    stock.set(item.id, { quantity: s.quantity - n, value: s.value - value });
    movements.push({ itemId: item.id, quantity: -n, value: -value });
    if (value > 0n) journal.push({ accountId: item.cogsAccountId!, description: `Cost of ${item.name}`, debit: Number(value), credit: 0, costCentreId: l.costCentreId ?? null }, { accountId: item.inventoryAccountId!, description: `Cost of ${item.name}`, debit: 0, credit: Number(value) });
  }
  return { movements, journal };
}
/** For a demo bill being recorded: its tracked lines come into stock at their cost */
export const demoStockReceipts = (lines: { itemId: string | null; quantity: string; value: number }[]) => lines.filter((l) => trackedItem(l.itemId)).map((l) => ({ itemId: l.itemId!, quantity: parseQuantity(l.quantity)!, value: BigInt(l.value) }));
/** The inventory account a tracked item is bought into */
export const demoInventoryAccountOf = (itemId: string | null) => trackedItem(itemId)?.inventoryAccountId ?? null;

export function demoSaveMovements(kind: StockMovementKind, sourceId: string | null, date: string, journalEntryId: string | null, movements: { itemId: string; quantity: bigint; value: bigint }[], reason: string | null = null) {
  if (!movements.length) return;
  const now = new Date().toISOString();
  save([...load(), ...movements.map((m) => ({ id: crypto.randomUUID(), itemId: m.itemId, date, kind, sourceId, quantity: qtyText(m.quantity), value: Number(m.value), reason, journalEntryId, createdAt: now }))]);
}
/** A demo bill or invoice voided: its stock goes back (a bill's only while it's still on hand) */
/** Whether a demo bill's stock can go back: refuses once some of it has been sold or written off */
export function demoCheckUndo(kind: 'bill' | 'invoice', sourceId: string) {
  if (kind !== 'bill') return;
  for (const d of load().filter((m) => m.kind === kind && m.sourceId === sourceId)) if (q(d.quantity) > demoStockOf(d.itemId).quantity) throw refuse(409, 'stock_used', { itemId: d.itemId });
}
export function demoUndoDocument(kind: 'bill' | 'invoice', sourceId: string, date: string, journalEntryId: string | null) {
  demoCheckUndo(kind, sourceId);
  const done = load().filter((m) => m.kind === kind && m.sourceId === sourceId);
  demoSaveMovements(kind === 'bill' ? 'bill_void' : 'invoice_void', sourceId, date, journalEntryId, done.map((d) => ({ itemId: d.itemId, quantity: -q(d.quantity), value: -BigInt(d.value) })));
}

const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 120));

export function createDemoInventoryApi(canPost: () => boolean): InventoryApi {
  const guard = () => {
    if (!canPost()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['journals.post'] });
  };
  const journals = () => createDemoJournalsApi(() => true);
  const movements = async (itemId: string): Promise<StockMovement[]> => {
    const all = load();
    const undone = new Set(all.filter((m) => m.kind === 'adjustment_undo').map((m) => m.sourceId));
    const item = itemsOf().find((i) => i.id === itemId);
    const j = journals();
    let n = 0n;
    let v = 0n;
    const rows = all.filter((m) => m.itemId === itemId).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    const out: StockMovement[] = [];
    if (rows.length) await j.list({ page: 1, pageSize: 1 });
    const entries = await Promise.all(rows.map((m) => (m.journalEntryId ? j.get(m.journalEntryId).catch(() => null) : null)));
    for (const [k, m] of rows.entries()) {
      n += q(m.quantity);
      v += BigInt(m.value);
      const entry = entries[k];
      out.push({ id: m.id, itemId, item: item?.name ?? '', date: m.date, kind: m.kind, document: m.sourceId && ['bill', 'bill_void', 'invoice', 'invoice_void'].includes(m.kind) ? { id: m.sourceId, number: entry?.reference ?? null } : null, quantity: m.quantity, value: m.value, reason: m.reason, journalEntry: entry ? { id: entry.id, number: entry.number } : null, undone: m.kind === 'adjustment' && undone.has(m.id), onHand: qtyText(n), valueOnHand: Number(v) });
    }
    return out;
  };
  return {
    valuation: (asOf) =>
      wait(async () => {
        const day = asOf ?? todayIn('Asia/Kolkata');
        const accounts = demoAccountRows();
        const rows = itemsOf()
          .filter((i) => i.trackStock)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((i) => {
            const s = demoStockOf(i.id, day);
            const a = accounts.find((x) => x.id === i.inventoryAccountId);
            return { itemId: i.id, name: i.name, sku: null, unit: null, archived: false, account: a ? { id: a.id, code: a.code, name: a.name } : null, quantity: qtyText(s.quantity), averageCost: averageUnitCost(s.quantity, s.value), value: Number(s.value) };
          });
        const ids = [...new Set(rows.map((r) => r.account?.id).filter((x): x is string => !!x))];
        const { items } = await journals().list({ status: 'posted', page: 1, pageSize: 1000 });
        const ledger = new Map<string, number>();
        // The list has loaded the books, so the entries can be read together
        const j = journals();
        const entries = await Promise.all(items.filter((x) => x.date <= day).map((e) => j.get(e.id)));
        for (const e of entries) for (const l of e.lines) if (ids.includes(l.accountId)) ledger.set(l.accountId, (ledger.get(l.accountId) ?? 0) + l.debit - l.credit);
        return { asOf: day, rows, total: rows.reduce((s, r) => s + r.value, 0), accounts: ids.map((id) => ({ ...rows.find((r) => r.account?.id === id)!.account!, stock: rows.filter((r) => r.account?.id === id).reduce((s, r) => s + r.value, 0), ledger: ledger.get(id) ?? 0 })) };
      }),
    movements: (itemId) => wait(async () => ({ movements: await movements(itemId) })),
    adjust: (input) =>
      wait(async () => {
        guard();
        const p = stockAdjustmentSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const d = p.data;
        const item = itemsOf().find((i) => i.id === d.itemId);
        if (!item) throw refuse(404, 'not_found');
        if (!item.trackStock) throw refuse(400, 'not_tracked', { field: 'itemId' });
        const other = demoAccountRows().find((a) => a.id === d.accountId);
        if (!other || other.archivedAt || other.id === item.inventoryAccountId) throw refuse(400, 'account_invalid', { field: 'accountId' });
        const n = parseQuantity(d.quantity)!;
        const s = demoStockOf(item.id);
        let value: bigint;
        if (d.direction === 'out') {
          if (n > s.quantity) throw refuse(409, 'insufficient_stock', { itemId: item.id, onHand: formatQuantity(s.quantity > 0n ? s.quantity : 0n) });
          value = costOfQuantity(s.quantity, s.value, n);
        } else {
          const unit = d.unitCost ?? averageUnitCost(s.quantity, s.value);
          if (unit === null) throw refuse(400, 'unit_cost_required', { field: 'unitCost' });
          value = (BigInt(unit) * n * 2n + 10_000n) / 20_000n;
        }
        let entryId: string | null = null;
        if (value > 0n) {
          const memo = `Stock ${d.direction === 'in' ? 'added' : 'written off'}: ${item.name} · ${d.reason}`;
          const v = Number(value);
          const lines = d.direction === 'in' ? [{ accountId: item.inventoryAccountId!, description: memo, debit: v }, { accountId: other.id, description: memo, credit: v }] : [{ accountId: other.id, description: memo, debit: v }, { accountId: item.inventoryAccountId!, description: memo, credit: v }];
          const j = journals();
          const draft = await j.create({ date: d.date, memo, reference: null, lines });
          entryId = (
            await j.post(draft.id).catch(async (e: unknown) => {
              await j.remove(draft.id);
              throw e;
            })
          ).id;
        }
        demoSaveMovements('adjustment', null, d.date, entryId, [{ itemId: item.id, quantity: d.direction === 'out' ? -n : n, value: d.direction === 'out' ? -value : value }], d.reason);
        const last = load().at(-1)!;
        return (await movements(item.id)).find((m) => m.id === last.id)!;
      }),
    undoAdjustment: (id) =>
      wait(async () => {
        guard();
        const all = load();
        const m = all.find((x) => x.id === id && x.kind === 'adjustment');
        if (!m) throw refuse(404, 'not_found');
        if (all.some((x) => x.kind === 'adjustment_undo' && x.sourceId === id)) throw refuse(409, 'already_undone');
        const n = q(m.quantity);
        if (n > 0n && n > demoStockOf(m.itemId).quantity) throw refuse(409, 'stock_used');
        const today = todayIn('Asia/Kolkata');
        const r = m.journalEntryId ? await journals().reverse(m.journalEntryId, { date: today, memo: 'Stock adjustment undone' }) : null;
        demoSaveMovements('adjustment_undo', id, today, r?.id ?? null, [{ itemId: m.itemId, quantity: -n, value: -BigInt(m.value) }], m.reason);
      }),
  };
}
