import { formatQuantity, invoiceAmounts, parseQuantity, splitTax, todayIn, vendorCreditApplySchema, vendorCreditNumber, vendorCreditRefundSchema, vendorCreditSchema } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoAccountRows } from '../accounts/demoAccountsApi';
import { demoAdjustBillCredit, demoBillViews, demoTrackDebitNote } from '../bills/demoBillsApi';
import { demoItemRows } from '../items/demoItemsApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import { createDemoPeriodsApi } from '../periods/demoPeriodsApi';
import { demoTaxState } from '../taxes/demoTaxesApi';
import type { DebitNote, DebitNotesApi } from './types';

/** Debit notes in demo mode: the same rules as the API, posted through the demo's journals. */
const KEY = 'ledgernest.demo.debit-notes';
type Stored = DebitNote & { yearName: string; seq: number; payableAccountId: string };

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
/** Live debit notes, for matching suppliers' credit notes in GSTR-2B */
export const demoDebitNoteRows = (): DebitNote[] => load().filter((n) => n.status === 'issued');
export const resetDemoDebitNotes = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));
const ratesOf = (groupId: string | null | undefined) => {
  const tax = demoTaxState();
  const g = groupId ? tax.groups.find((x) => x.id === groupId) : undefined;
  return (g?.rateIds ?? []).map((rid) => tax.rates.find((r) => r.id === rid)!).map((r) => ({ rateId: r.id, ratePpm: r.ratePpm, name: r.name }));
};
const strip = ({ yearName: _y, seq: _s, payableAccountId: _p, ...note }: Stored): DebitNote => note;

export function createDemoDebitNotesApi(canManage: () => boolean, canRefund: () => boolean): DebitNotesApi {
  const guard = (ok: () => boolean, missing: string) => {
    if (!ok()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: [missing] });
  };
  const find = (rows: Stored[], id: string) => {
    const c = rows.find((r) => r.id === id);
    if (!c) throw new ApiError('not_found', 404);
    return c;
  };
  const journals = () => createDemoJournalsApi(() => true);
  const post = async (input: Parameters<ReturnType<typeof createDemoJournalsApi>['create']>[0]) => {
    const j = journals();
    const draft = await j.create(input);
    return j.post(draft.id).catch(async (e: unknown) => {
      await j.remove(draft.id);
      throw e;
    });
  };
  const creditable = async (billId: string) => {
    const bill = (await demoBillViews()).find((b) => b.id === billId);
    if (!bill) throw new ApiError('not_found', 404);
    const taken = load().filter((c) => c.bill.id === billId && c.status === 'issued').flatMap((c) => c.lines);
    const stockItems = new Set(demoItemRows().filter((i) => i.trackStock).map((i) => i.id));
    return bill.lines.map((l) => {
      const left = parseQuantity(l.quantity)! - taken.filter((t) => t.billLineId === l.id).reduce((s, t) => s + parseQuantity(t.quantity)!, 0n);
      return { billLineId: l.id, quantity: formatQuantity(left > 0n ? left : 0n), stock: !!l.item && stockItems.has(l.item.id) };
    });
  };
  return {
    list: (q) =>
      wait(() => {
        const items = load()
          .filter((c) => (!q.contactId || c.contact.id === q.contactId) && (!q.billId || c.bill.id === q.billId))
          .sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
        return { total: items.length, page: q.page, pageSize: q.pageSize, items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(strip) };
      }),
    get: (id) => wait(() => strip(find(load(), id))),
    creditable: (billId) => wait(() => creditable(billId)),
    create: (input) =>
      wait(async () => {
        guard(canManage, 'bills.manage');
        const p = vendorCreditSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const d = p.data;
        const bill = (await demoBillViews()).find((b) => b.id === d.billId);
        if (!bill) throw refuse(400, 'bill_not_found');
        if (bill.status !== 'open') throw refuse(409, 'bill_not_open');
        if (bill.currency) throw refuse(400, 'bill_currency');
        if (d.date < bill.billDate) throw refuse(400, 'before_bill');
        const left = await creditable(bill.id);
        const lines = d.lines.map((l, n) => {
          const src = bill.lines.find((x) => x.id === l.billLineId);
          if (!src) throw refuse(400, 'line_not_found', { line: n + 1 });
          const room = left.find((x) => x.billLineId === src.id)!;
          if (room.stock) throw refuse(400, 'stock_line', { line: n + 1 });
          if (parseQuantity(l.quantity)! > parseQuantity(room.quantity)!) throw refuse(409, 'over_credited', { line: n + 1, left: room.quantity });
          return { src, quantity: formatQuantity(parseQuantity(l.quantity)!), rates: ratesOf(src.taxGroup?.id) };
        });
        const amounts = invoiceAmounts(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.src.unitPrice, discountPpm: Math.round(l.src.discount * 10_000), rates: l.rates })));
        if (amounts.total <= 0) throw refuse(400, 'zero_total');
        const { years } = await createDemoPeriodsApi(() => true).list();
        const year = years.find((y) => y.startDate <= d.date && d.date <= y.endDate);
        if (!year) throw refuse(409, 'no_period');
        const all = load();
        const seq = Math.max(0, ...all.filter((x) => x.yearName === year.name).map((x) => x.seq)) + 1;
        const label = vendorCreditNumber(year.name, seq);
        const payable = bill.payableAccount!;
        // The bill's entry the other way round
        const entry = await post({
          date: d.date,
          memo: `Debit note ${label} · ${bill.contact.name} · ${bill.number}`,
          reference: d.vendorReference ?? label,
          lines: [{ accountId: payable.id, description: label, debit: amounts.total }, ...lines.map((l, n) => ({ accountId: l.src.account!.id, description: l.src.description, credit: amounts.lines[n]!.net, taxGroupId: l.src.taxGroup?.id ?? null, costCentreId: l.src.costCentre?.id ?? null })).filter((l) => l.credit > 0)],
        });
        const breakdown = new Map<string, number>();
        lines.forEach((l, n) => splitTax(amounts.lines[n]!.net, false, l.rates).taxes.forEach((t, k) => breakdown.set(l.rates[k]!.name, (breakdown.get(l.rates[k]!.name) ?? 0) + t.amount)));
        const onBill = Math.min(amounts.total, bill.balance);
        const id = crypto.randomUUID();
        const note: Stored = {
          id,
          number: label,
          status: 'issued',
          date: d.date,
          contact: { id: bill.contact.id, name: bill.contact.name },
          bill: { id: bill.id, number: bill.number, vendorReference: bill.vendorReference },
          vendorReference: d.vendorReference,
          reason: d.reason,
          subtotal: amounts.subtotal,
          taxTotal: amounts.tax,
          total: amounts.total,
          applied: onBill,
          remaining: amounts.total - onBill,
          taxBreakdown: [...breakdown].map(([name, amount]) => ({ name, amount })),
          journalEntry: { id: entry.id, number: entry.number },
          voidEntry: null,
          lines: lines.map((l, n) => ({ id: `${id}-${n}`, lineNo: n + 1, billLineId: l.src.id, description: l.src.description, quantity: l.quantity, unitPrice: l.src.unitPrice, discount: l.src.discount, amount: amounts.lines[n]!.net, taxAmount: amounts.lines[n]!.tax, account: l.src.account, taxGroup: l.src.taxGroup && { id: l.src.taxGroup.id, name: l.src.taxGroup.name } })),
          applications: onBill ? [{ id: crypto.randomUUID(), kind: 'bill', date: d.date, amount: onBill, bill: { id: bill.id, number: bill.number } }] : [],
          yearName: year.name,
          seq,
          payableAccountId: payable.id,
        };
        all.push(note);
        save(all);
        await demoTrackDebitNote(bill.id, { id, number: label, status: 'issued', total: amounts.total });
        if (onBill) await demoAdjustBillCredit(bill.id, { id, number: label, date: d.date, amount: onBill });
        return strip(note);
      }),
    apply: (id, input) =>
      wait(async () => {
        guard(canManage, 'bills.manage');
        const p = vendorCreditApplySchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const all = load();
        const c = find(all, id);
        if (c.status !== 'issued') throw refuse(409, 'vendor_credit_void');
        const bill = (await demoBillViews()).find((b) => b.id === p.data.billId);
        if (!bill || bill.contact.id !== c.contact.id) throw refuse(400, 'bill_not_found');
        if (bill.status !== 'open') throw refuse(409, 'bill_not_open');
        if (bill.currency) throw refuse(400, 'bill_currency');
        if (p.data.amount > c.remaining) throw refuse(409, 'over_applied');
        if (p.data.amount > bill.balance) throw refuse(409, 'over_allocated');
        const date = p.data.date ?? todayIn('Asia/Kolkata');
        c.applications.push({ id: crypto.randomUUID(), kind: 'bill', date, amount: p.data.amount, bill: { id: bill.id, number: bill.number } });
        c.applied += p.data.amount;
        c.remaining -= p.data.amount;
        save(all);
        await demoAdjustBillCredit(bill.id, { id: c.id, number: c.number, date, amount: p.data.amount });
        return strip(c);
      }),
    refund: (id, input) =>
      wait(async () => {
        guard(canRefund, 'payments.manage');
        const p = vendorCreditRefundSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const d = p.data;
        const all = load();
        const c = find(all, id);
        if (c.status !== 'issued') throw refuse(409, 'vendor_credit_void');
        if (d.amount > c.remaining) throw refuse(409, 'over_applied');
        if (d.date < c.date) throw refuse(400, 'before_vendor_credit');
        const bank = demoAccountRows().find((a) => a.id === d.bankAccountId);
        if (!bank || bank.type !== 'asset' || bank.archivedAt || bank.currency) throw refuse(400, 'bank_invalid');
        const desc = `${c.number} refund`;
        const entry = await post({ date: d.date, memo: `Refund of ${c.number} · ${c.contact.name}`, reference: d.reference ?? c.number, lines: [{ accountId: bank.id, description: desc, debit: d.amount }, { accountId: c.payableAccountId, description: desc, credit: d.amount }] });
        c.applications.push({ id: crypto.randomUUID(), kind: 'refund', date: d.date, amount: d.amount, reference: d.reference, bankAccount: { id: bank.id, code: bank.code, name: bank.name }, journalEntry: { id: entry.id, number: entry.number } });
        c.applied += d.amount;
        c.remaining -= d.amount;
        save(all);
        return strip(c);
      }),
    void: (id, reason) =>
      wait(async () => {
        guard(canManage, 'bills.manage');
        const all = load();
        const c = find(all, id);
        if (c.status === 'void') throw refuse(409, 'already_void');
        if (c.applications.some((a) => a.kind === 'refund')) throw refuse(409, 'has_refunds');
        const r = await journals().reverse(c.journalEntry.id, { date: todayIn('Asia/Kolkata'), memo: `${c.number} voided${reason ? `: ${reason}` : ''}` });
        Object.assign(c, { status: 'void', voidEntry: { id: r.id, number: r.number }, remaining: 0 });
        save(all);
        for (const a of c.applications) if (a.kind === 'bill') await demoAdjustBillCredit(a.bill.id, { id: c.id, number: c.number, date: a.date, amount: a.amount }, true);
        await demoTrackDebitNote(c.bill.id, { id: c.id, number: c.number, status: 'void', total: c.total });
        return strip(c);
      }),
  };
}
