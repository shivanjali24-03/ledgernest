import { currencyDigits, paymentNumber, receiptSchema, todayIn, toBase } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoAccountRows } from '../accounts/demoAccountsApi';
import { demoContactRows } from '../contacts/demoContactsApi';
import { DEMO_BASE_CURRENCY, demoRateOn } from '../currencies/demoCurrenciesApi';
import { demoAdjustPaid, demoInvoiceViews } from '../invoices/demoInvoicesApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import { createDemoPeriodsApi } from '../periods/demoPeriodsApi';
import type { Payment, PaymentsApi } from './types';

/** Receipts in demo mode: the same rules as the API, posted through the demo's journals. */
const KEY = 'ledgernest.demo.payments';
type Stored = Payment & { yearName: string; seq: number };

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
export const resetDemoPayments = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};
/** Receipts not allocated to invoices, per customer, for their balance */
export const demoAdvances = (contactId: string) => load().filter((p) => p.contact.id === contactId && p.status === 'posted').reduce((s, p) => s + p.unallocated, 0);

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));

export function createDemoPaymentsApi(canManage: () => boolean): PaymentsApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['payments.manage'] });
  };
  return {
    list: (q) =>
      wait(() => {
        const items = load()
          .filter((p) => (!q.kind || p.kind === q.kind) && (!q.contactId || p.contact.id === q.contactId))
          .sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
        return { total: items.length, page: q.page, pageSize: q.pageSize, items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize) };
      }),
    openInvoices: (contactId) =>
      wait(async () =>
        (await demoInvoiceViews())
          .filter((i) => i.contact.id === contactId && i.status === 'issued' && i.balance > 0)
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .map((i) => ({ id: i.id, number: i.number!, issueDate: i.issueDate, dueDate: i.dueDate, currency: i.currency, total: i.total, balance: i.balance })),
      ),
    receive: (input) =>
      wait(async () => {
        guard();
        const p = receiptSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const d = p.data;
        const contact = demoContactRows().find((c) => c.id === d.contactId);
        if (!contact) throw refuse(400, 'contact_not_found');
        if (!contact.isCustomer) throw refuse(400, 'not_customer');
        const currency = contact.currency;
        const bank = demoAccountRows().find((a) => a.id === d.bankAccountId);
        if (!bank || bank.type !== 'asset' || bank.archivedAt) throw refuse(400, 'bank_invalid');
        if (bank.currency && bank.currency !== currency) throw refuse(400, 'bank_currency');
        const invoices = await demoInvoiceViews();
        for (const a of d.allocations) {
          const i = invoices.find((x) => x.id === a.invoiceId);
          if (!i || i.contact.id !== contact.id) throw refuse(400, 'invoice_not_found');
          if (i.status !== 'issued') throw refuse(409, 'invoice_not_issued');
          if (a.amount > i.balance) throw refuse(409, 'over_allocated');
        }
        const allocated = d.allocations.reduce((s, a) => s + a.amount, 0);
        let rate: string | null = null;
        if (currency) {
          rate = d.rate ?? demoRateOn(currency, d.date);
          if (!rate) throw refuse(400, 'no_rate', { currency, date: d.date });
        }
        const { years } = await createDemoPeriodsApi(() => true).list();
        const year = years.find((y) => y.startDate <= d.date && d.date <= y.endDate);
        if (!year) throw refuse(409, 'no_period');
        const all = load();
        const seq = Math.max(0, ...all.filter((x) => x.yearName === year.name && x.kind === 'receipt').map((x) => x.seq)) + 1;
        const label = paymentNumber('receipt', year.name, seq);
        // Credit each invoice's receivable; the rest waits on the customer's receivable as an advance
        const byReceivable = new Map<string, number>();
        for (const a of d.allocations) {
          const r = invoices.find((x) => x.id === a.invoiceId)!.receivableAccount!.id;
          byReceivable.set(r, (byReceivable.get(r) ?? 0) + a.amount);
        }
        if (d.amount > allocated) {
          const advance = demoAccountRows().find((a) => a.type === 'asset' && (a.currency ?? null) === currency && /receivable/i.test(a.name));
          if (!advance) throw refuse(409, 'no_receivable_account');
          byReceivable.set(advance.id, (byReceivable.get(advance.id) ?? 0) + d.amount - allocated);
        }
        const inBase = (minor: number) => (currency ? toBase(minor, rate!, currencyDigits(currency), currencyDigits(DEMO_BASE_CURRENCY)) : minor);
        const credits = [...byReceivable].map(([accountId, minor]) => (currency ? { accountId, description: label, currency, foreignCredit: minor, rate: rate! } : { accountId, description: label, credit: minor }));
        const bankLine = bank.currency ? { accountId: bank.id, description: label, currency: bank.currency, foreignDebit: d.amount, rate: rate! } : { accountId: bank.id, description: label, debit: [...byReceivable.values()].reduce((s, m) => s + inBase(m), 0) };
        const journals = createDemoJournalsApi(() => true);
        const draft = await journals.create({ date: d.date, memo: `Receipt ${label} · ${contact.name}`, reference: d.reference ?? label, lines: [bankLine, ...credits] });
        const posted = await journals.post(draft.id).catch(async (e: unknown) => {
          await journals.remove(draft.id);
          throw e;
        });
        const payment: Stored = {
          id: crypto.randomUUID(),
          kind: 'receipt',
          number: label,
          status: 'posted',
          date: d.date,
          contact: { id: contact.id, name: contact.name },
          bankAccount: { id: bank.id, code: bank.code, name: bank.name, currency: bank.currency ?? null },
          currency,
          rate,
          amount: d.amount,
          allocated,
          unallocated: d.amount - allocated,
          reference: d.reference,
          notes: d.notes,
          journalEntry: { id: posted.id, number: posted.number },
          voidEntry: null,
          allocations: d.allocations.map((a) => ({ invoiceId: a.invoiceId, invoiceNumber: invoices.find((x) => x.id === a.invoiceId)!.number, amount: a.amount })),
          yearName: year.name,
          seq,
        };
        all.push(payment);
        save(all);
        for (const a of d.allocations) await demoAdjustPaid(a.invoiceId, a.amount, { id: payment.id, number: label, date: d.date, amount: a.amount });
        return payment;
      }),
    void: (id, reason) =>
      wait(async () => {
        guard();
        const all = load();
        const p = all.find((x) => x.id === id);
        if (!p) throw new ApiError('not_found', 404);
        if (p.status === 'void') throw refuse(409, 'already_void');
        const r = await createDemoJournalsApi(() => true).reverse(p.journalEntry.id, { date: todayIn('Asia/Kolkata'), memo: `${p.number} voided${reason ? `: ${reason}` : ''}` });
        Object.assign(p, { status: 'void', voidEntry: { id: r.id, number: r.number } });
        save(all);
        for (const a of p.allocations) await demoAdjustPaid(a.invoiceId, -a.amount);
        return p;
      }),
  };
}
