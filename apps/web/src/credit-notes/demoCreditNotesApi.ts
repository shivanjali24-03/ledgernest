import { creditApplySchema, creditNoteNumber, creditNoteSchema, creditRefundSchema, currencyDigits, formatQuantity, invoiceAmounts, parseQuantity, pdfTableBytes, rupeesInWords, splitTax, todayIn, toBase } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoContactRows } from '../contacts/demoContactsApi';
import { demoAccountRows } from '../accounts/demoAccountsApi';
import { DEMO_BASE_CURRENCY, demoRateOn } from '../currencies/demoCurrenciesApi';
import { demoAdjustCredit, demoInvoiceViews, demoTrackCreditNote } from '../invoices/demoInvoicesApi';
import { demoCheckUndo, demoSaveMovements, demoStockReturns, demoUndoDocument } from '../inventory/demoInventoryApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import { createDemoPeriodsApi } from '../periods/demoPeriodsApi';
import { demoTaxState } from '../taxes/demoTaxesApi';
import type { CreditNote, CreditNotesApi } from './types';

/** Credit notes in demo mode: the same rules as the API, posted through the demo's journals. */
const KEY = 'ledgernest.demo.credit-notes';
type Stored = CreditNote & { yearName: string; seq: number; receivableAccountId: string };

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
export const resetDemoCreditNotes = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};
/** Credit a customer holds and hasn't used, for their balance */
export const demoUnappliedCredit = (contactId: string) => load().filter((c) => c.contact.id === contactId && c.status === 'issued').reduce((s, c) => s + c.remaining, 0);
/** Every live credit note, for the aging report */
export const demoCreditNoteRows = (): CreditNote[] => load();

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));
const ratesOf = (groupId: string | null | undefined) => {
  const tax = demoTaxState();
  const g = groupId ? tax.groups.find((x) => x.id === groupId) : undefined;
  return (g?.rateIds ?? []).map((rid) => tax.rates.find((r) => r.id === rid)!).map((r) => ({ rateId: r.id, ratePpm: r.ratePpm, name: r.name }));
};
const strip = ({ yearName: _y, seq: _s, receivableAccountId: _r, ...note }: Stored): CreditNote => note;

export function createDemoCreditNotesApi(canManage: () => boolean, canRefund: () => boolean): CreditNotesApi {
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
  const creditable = async (invoiceId: string) => {
    const inv = (await demoInvoiceViews()).find((i) => i.id === invoiceId);
    if (!inv) throw new ApiError('not_found', 404);
    const taken = load().filter((c) => c.invoice.id === invoiceId && c.status === 'issued').flatMap((c) => c.lines);
    return inv.lines.map((l) => {
      const left = parseQuantity(l.quantity)! - taken.filter((t) => t.invoiceLineId === l.id).reduce((s, t) => s + parseQuantity(t.quantity)!, 0n);
      return { invoiceLineId: l.id, quantity: formatQuantity(left > 0n ? left : 0n) };
    });
  };
  return {
    list: (q) =>
      wait(() => {
        const items = load()
          .filter((c) => (!q.contactId || c.contact.id === q.contactId) && (!q.invoiceId || c.invoice.id === q.invoiceId))
          .sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
        return { total: items.length, page: q.page, pageSize: q.pageSize, items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(strip) };
      }),
    get: (id) => wait(() => strip(find(load(), id))),
    email: (id, input) =>
      wait(() => {
        const c = strip(find(load(), id));
        const to = input.email ?? demoContactRows().find((x) => x.id === c.contact.id)?.email;
        if (!to) throw new ApiError('validation', 400, undefined, undefined, { reason: 'no_email' });
        return { sentTo: to };
      }),
    pdf: (id) =>
      wait(() => {
        const c = strip(find(load(), id));
        const cur = c.currency ?? 'INR';
        const fmt = (minor: number) => (minor / 10 ** currencyDigits(cur)).toFixed(currencyDigits(cur));
        const total = (label: string, minor: number) => ['', '', label, '', fmt(minor)];
        const bytes = pdfTableBytes({
          title: `Credit note ${c.number}`,
          subtitle: 'Nest Demo Private Limited · GSTIN 27AAPFN1234C1Z5',
          info: [`To: ${c.contact.name}`, `Date ${c.date} · Against invoice ${c.invoice.number ?? ''}`, ...(c.reason ? [`Reason: ${c.reason}`] : [])],
          rows: [['Description', 'Qty', `Price (${cur})`, 'Taxable value', 'Tax'], ...c.lines.map((l) => [l.description, l.quantity, fmt(l.unitPrice), fmt(l.amount), fmt(l.taxAmount)]), total('Subtotal', c.subtotal), ...c.taxBreakdown.map((x) => total(x.name, x.amount)), total(`Total (${cur})`, c.total)],
          after: cur === 'INR' ? [`Amount in words: ${rupeesInWords(c.total)}`] : undefined,
          footer: `Nest Demo Private Limited · ${c.number}`,
        });
        return { blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), filename: `credit-note-${c.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf` };
      }),
    creditable: (invoiceId) => wait(() => creditable(invoiceId)),
    create: (input) =>
      wait(async () => {
        guard(canManage, 'invoices.manage');
        const p = creditNoteSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const d = p.data;
        const inv = (await demoInvoiceViews()).find((i) => i.id === d.invoiceId);
        if (!inv) throw refuse(400, 'invoice_not_found');
        if (inv.status !== 'issued') throw refuse(409, 'invoice_not_issued');
        if (d.date < inv.issueDate) throw refuse(400, 'before_invoice');
        const left = await creditable(inv.id);
        const lines = d.lines.map((l, n) => {
          const src = inv.lines.find((x) => x.id === l.invoiceLineId);
          if (!src) throw refuse(400, 'line_not_found', { line: n + 1 });
          const room = left.find((x) => x.invoiceLineId === src.id)!.quantity;
          if (parseQuantity(l.quantity)! > parseQuantity(room)!) throw refuse(409, 'over_credited', { line: n + 1, left: room });
          return { src, quantity: formatQuantity(parseQuantity(l.quantity)!), rates: ratesOf(src.taxGroup?.id) };
        });
        const amounts = invoiceAmounts(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.src.unitPrice, discountPpm: Math.round(l.src.discount * 10_000), rates: l.rates })));
        if (amounts.total <= 0) throw refuse(400, 'zero_total');
        const { years } = await createDemoPeriodsApi(() => true).list();
        const year = years.find((y) => y.startDate <= d.date && d.date <= y.endDate);
        if (!year) throw refuse(409, 'no_period');
        const all = load();
        const seq = Math.max(0, ...all.filter((x) => x.yearName === year.name).map((x) => x.seq)) + 1;
        const label = creditNoteNumber(year.name, seq);
        const toInr = (minor: number) => (inv.rate ? toBase(minor, inv.rate, currencyDigits(inv.currency!), currencyDigits(DEMO_BASE_CURRENCY)) : minor);
        const receivable = inv.receivableAccount!;
        // Goods that came back return to stock at the cost they left at
        const returned = d.returnsStock ? demoStockReturns(inv.id, lines.map((l) => ({ itemId: l.src.item?.id ?? null, quantity: l.quantity, costCentreId: l.src.costCentre?.id ?? null }))) : { movements: [], journal: [] };
        // The invoice's entry the other way round, at its own rate
        const entry = await post({
          date: d.date,
          memo: `Credit note ${label} · ${inv.contact.name} · ${inv.number}`,
          reference: label,
          lines: [
            ...lines.map((l, n) => ({ accountId: l.src.account!.id, description: l.src.description, debit: toInr(amounts.lines[n]!.net), taxGroupId: inv.currency ? null : (l.src.taxGroup?.id ?? null), costCentreId: l.src.costCentre?.id ?? null })).filter((l) => l.debit > 0),
            inv.currency ? { accountId: receivable.id, description: label, currency: inv.currency, foreignCredit: amounts.total, rate: inv.rate! } : { accountId: receivable.id, description: label, credit: amounts.total },
            ...returned.journal,
          ],
        });
        const breakdown = new Map<string, number>();
        lines.forEach((l, n) => splitTax(amounts.lines[n]!.net, false, l.rates).taxes.forEach((t, k) => breakdown.set(l.rates[k]!.name, (breakdown.get(l.rates[k]!.name) ?? 0) + t.amount)));
        const onInvoice = Math.min(amounts.total, inv.balance);
        const id = crypto.randomUUID();
        demoSaveMovements('credit_note', id, d.date, entry.id, returned.movements);
        const note: Stored = {
          id,
          number: label,
          status: 'issued',
          date: d.date,
          contact: { id: inv.contact.id, name: inv.contact.name },
          invoice: { id: inv.id, number: inv.number },
          currency: inv.currency,
          rate: inv.rate,
          reason: d.reason,
          subtotal: amounts.subtotal,
          taxTotal: amounts.tax,
          total: amounts.total,
          applied: onInvoice,
          remaining: amounts.total - onInvoice,
          taxBreakdown: [...breakdown].map(([name, amount]) => ({ name, amount })),
          journalEntry: { id: entry.id, number: entry.number },
          voidEntry: null,
          lines: lines.map((l, n) => ({ id: `${id}-${n}`, lineNo: n + 1, invoiceLineId: l.src.id, description: l.src.description, quantity: l.quantity, unitPrice: l.src.unitPrice, discount: l.src.discount, amount: amounts.lines[n]!.net, taxAmount: amounts.lines[n]!.tax, account: l.src.account, taxGroup: l.src.taxGroup && { id: l.src.taxGroup.id, name: l.src.taxGroup.name } })),
          applications: onInvoice ? [{ id: crypto.randomUUID(), kind: 'invoice', date: d.date, amount: onInvoice, invoice: { id: inv.id, number: inv.number } }] : [],
          yearName: year.name,
          seq,
          receivableAccountId: receivable.id,
        };
        all.push(note);
        save(all);
        await demoTrackCreditNote(inv.id, { id, number: label, status: 'issued', total: amounts.total });
        if (onInvoice) await demoAdjustCredit(inv.id, { id, number: label, date: d.date, amount: onInvoice });
        return strip(note);
      }),
    apply: (id, input) =>
      wait(async () => {
        guard(canManage, 'invoices.manage');
        const p = creditApplySchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const all = load();
        const c = find(all, id);
        if (c.status !== 'issued') throw refuse(409, 'credit_note_void');
        const inv = (await demoInvoiceViews()).find((i) => i.id === p.data.invoiceId);
        if (!inv || inv.contact.id !== c.contact.id) throw refuse(400, 'invoice_not_found');
        if (inv.status !== 'issued') throw refuse(409, 'invoice_not_issued');
        if (inv.currency !== c.currency) throw refuse(400, 'invoice_currency');
        if (p.data.amount > c.remaining) throw refuse(409, 'over_applied');
        if (p.data.amount > inv.balance) throw refuse(409, 'over_allocated');
        const date = p.data.date ?? todayIn('Asia/Kolkata');
        c.applications.push({ id: crypto.randomUUID(), kind: 'invoice', date, amount: p.data.amount, invoice: { id: inv.id, number: inv.number } });
        c.applied += p.data.amount;
        c.remaining -= p.data.amount;
        save(all);
        await demoAdjustCredit(inv.id, { id: c.id, number: c.number, date, amount: p.data.amount });
        return strip(c);
      }),
    refund: (id, input) =>
      wait(async () => {
        guard(canRefund, 'payments.manage');
        const p = creditRefundSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const d = p.data;
        const all = load();
        const c = find(all, id);
        if (c.status !== 'issued') throw refuse(409, 'credit_note_void');
        if (d.amount > c.remaining) throw refuse(409, 'over_applied');
        if (d.date < c.date) throw refuse(400, 'before_credit_note');
        const bank = demoAccountRows().find((a) => a.id === d.bankAccountId);
        if (!bank || bank.type !== 'asset' || bank.archivedAt) throw refuse(400, 'bank_invalid');
        if (bank.currency && bank.currency !== c.currency) throw refuse(400, 'bank_currency');
        let rate: string | null = null;
        if (c.currency) {
          rate = d.rate ?? demoRateOn(c.currency, d.date);
          if (!rate) throw refuse(400, 'no_rate', { currency: c.currency, date: d.date });
        }
        const inBase = (minor: number) => (c.currency ? toBase(minor, rate!, currencyDigits(c.currency), currencyDigits(DEMO_BASE_CURRENCY)) : minor);
        const desc = `${c.number} refund`;
        const entry = await post({
          date: d.date,
          memo: `Refund of ${c.number} · ${c.contact.name}`,
          reference: d.reference ?? c.number,
          lines: [
            c.currency ? { accountId: c.receivableAccountId, description: desc, currency: c.currency, foreignDebit: d.amount, rate: rate! } : { accountId: c.receivableAccountId, description: desc, debit: d.amount },
            bank.currency ? { accountId: bank.id, description: desc, currency: bank.currency, foreignCredit: d.amount, rate: rate! } : { accountId: bank.id, description: desc, credit: inBase(d.amount) },
          ],
        });
        c.applications.push({ id: crypto.randomUUID(), kind: 'refund', date: d.date, amount: d.amount, rate, reference: d.reference, bankAccount: { id: bank.id, code: bank.code, name: bank.name }, journalEntry: { id: entry.id, number: entry.number } });
        c.applied += d.amount;
        c.remaining -= d.amount;
        save(all);
        return strip(c);
      }),
    void: (id, reason) =>
      wait(async () => {
        guard(canManage, 'invoices.manage');
        const all = load();
        const c = find(all, id);
        if (c.status === 'void') throw refuse(409, 'already_void');
        if (c.applications.some((a) => a.kind === 'refund')) throw refuse(409, 'has_refunds');
        demoCheckUndo('credit_note', id);
        const r = await journals().reverse(c.journalEntry.id, { date: todayIn('Asia/Kolkata'), memo: `${c.number} voided${reason ? `: ${reason}` : ''}` });
        demoUndoDocument('credit_note', id, todayIn('Asia/Kolkata'), r.id);
        Object.assign(c, { status: 'void', voidEntry: { id: r.id, number: r.number }, remaining: 0 });
        save(all);
        for (const a of c.applications) if (a.kind === 'invoice') await demoAdjustCredit(a.invoice.id, { id: c.id, number: c.number, date: a.date, amount: a.amount }, true);
        await demoTrackCreditNote(c.invoice.id, { id: c.id, number: c.number, status: 'void', total: c.total });
        return strip(c);
      }),
  };
}
