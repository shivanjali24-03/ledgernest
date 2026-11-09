import { currencyDigits, paymentNumber, receiptSchema, todayIn, toBase, vendorPaymentSchema, type PaymentKind } from '@ledgernest/shared';
import { demoApprovalCheck } from '../approvals/demoApprovalsApi';
import { ApiError } from '../auth/client';
import { demoAccountRows } from '../accounts/demoAccountsApi';
import { demoContactRows } from '../contacts/demoContactsApi';
import { DEMO_BASE_CURRENCY, demoRateOn } from '../currencies/demoCurrenciesApi';
import { demoAdjustBillPaid, demoBillViews } from '../bills/demoBillsApi';
import { demoAdjustPaid, demoInvoiceViews } from '../invoices/demoInvoicesApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import { createDemoPeriodsApi } from '../periods/demoPeriodsApi';
import type { Payment, PaymentsApi } from './types';

/** Receipts and vendor payments in demo mode: the same rules as the API, posted through the demo's journals. */
const KEY = 'ledgernest.demo.payments';
type Stored = Payment & { yearName: string; seq: number };

function load(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    // Allocations stored before bills could be paid named only their invoice
    if (raw) return (JSON.parse(raw) as Stored[]).map((p) => ({ ...p, allocations: p.allocations.map((a) => ('kind' in a ? a : { kind: 'invoice' as const, documentId: (a as { invoiceId: string }).invoiceId, documentNumber: (a as { invoiceNumber: string | null }).invoiceNumber, amount: (a as { amount: number }).amount })) }));
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
/** What's been received (or paid) and not allocated, per contact, for their balance */
export const demoAdvances = (contactId: string, kind: PaymentKind = 'receipt') => load().filter((p) => p.contact.id === contactId && p.kind === kind && p.status === 'posted').reduce((s, p) => s + p.unallocated, 0);
const adjust = (kind: 'invoice' | 'bill', id: string, delta: number, payment?: { id: string; number: string; date: string; amount: number }) => (kind === 'invoice' ? demoAdjustPaid(id, delta, payment) : demoAdjustBillPaid(id, delta, payment));

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));

/** opts.approvalsAs: paying from the app as this role, so approval rules apply */
export function createDemoPaymentsApi(canManage: () => boolean, opts: { approvalsAs?: string } = {}): PaymentsApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['payments.manage'] });
  };
  /** Receipts credit invoices' receivables; payments debit bills' payables. The rest is an advance. */
  const settle = async (kind: PaymentKind, d: { contactId: string; date: string; bankAccountId: string; amount: number; rate: string | null; reference: string | null; notes: string | null; allocations: { documentId: string; amount: number }[] }) => {
    guard();
    const receipt = kind === 'receipt';
    const contact = demoContactRows().find((c) => c.id === d.contactId);
    if (!contact) throw refuse(400, 'contact_not_found');
    if (receipt ? !contact.isCustomer : !contact.isVendor) throw refuse(400, receipt ? 'not_customer' : 'not_vendor');
    const currency = contact.currency;
    const bank = demoAccountRows().find((a) => a.id === d.bankAccountId);
    if (!bank || bank.type !== 'asset' || bank.archivedAt) throw refuse(400, 'bank_invalid');
    if (bank.currency && bank.currency !== currency) throw refuse(400, 'bank_currency');
    const docs = receipt
      ? (await demoInvoiceViews()).map((i) => ({ id: i.id, number: i.number, contactId: i.contact.id, open: i.status === 'issued', balance: i.balance, accountId: i.receivableAccount?.id }))
      : (await demoBillViews()).map((b) => ({ id: b.id, number: b.number, contactId: b.contact.id, open: b.status === 'open', balance: b.balance, accountId: b.payableAccount?.id }));
    for (const a of d.allocations) {
      const x = docs.find((y) => y.id === a.documentId);
      if (!x || x.contactId !== contact.id) throw refuse(400, receipt ? 'invoice_not_found' : 'bill_not_found');
      if (!x.open) throw refuse(409, receipt ? 'invoice_not_issued' : 'bill_not_open');
      if (a.amount > x.balance) throw refuse(409, 'over_allocated');
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
    const seq = Math.max(0, ...all.filter((x) => x.yearName === year.name && x.kind === kind).map((x) => x.seq)) + 1;
    const label = paymentNumber(kind, year.name, seq);
    const byAccount = new Map<string, number>();
    for (const a of d.allocations) {
      const accountId = docs.find((x) => x.id === a.documentId)!.accountId!;
      byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + a.amount);
    }
    if (d.amount > allocated) {
      const advance = demoAccountRows().find((a) => (receipt ? a.type === 'asset' && /receivable/i.test(a.name) : a.type === 'liability' && /accounts payable/i.test(a.name)) && (a.currency ?? null) === currency);
      if (!advance) throw refuse(409, receipt ? 'no_receivable_account' : 'no_payable_account');
      byAccount.set(advance.id, (byAccount.get(advance.id) ?? 0) + d.amount - allocated);
    }
    const inBase = (minor: number) => (currency ? toBase(minor, rate!, currencyDigits(currency), currencyDigits(DEMO_BASE_CURRENCY)) : minor);
    // Money in: bank debit, documents credit. Money out: the other way round.
    const docLines = [...byAccount].map(([accountId, minor]) => (currency ? { accountId, description: label, currency, rate: rate!, ...(receipt ? { foreignCredit: minor } : { foreignDebit: minor }) } : { accountId, description: label, ...(receipt ? { credit: minor } : { debit: minor }) }));
    const bankLine = bank.currency
      ? { accountId: bank.id, description: label, currency: bank.currency, rate: rate!, ...(receipt ? { foreignDebit: d.amount } : { foreignCredit: d.amount }) }
      : { accountId: bank.id, description: label, ...(receipt ? { debit: [...byAccount.values()].reduce((s, m) => s + inBase(m), 0) } : { credit: [...byAccount.values()].reduce((s, m) => s + inBase(m), 0) }) };
    const journals = createDemoJournalsApi(() => true);
    const draft = await journals.create({ date: d.date, memo: `${receipt ? 'Receipt' : 'Payment'} ${label} · ${contact.name}`, reference: d.reference ?? label, lines: receipt ? [bankLine, ...docLines] : [...docLines, bankLine] });
    const posted = await journals.post(draft.id).catch(async (e: unknown) => {
      await journals.remove(draft.id);
      throw e;
    });
    const payment: Stored = {
      id: crypto.randomUUID(),
      kind,
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
      allocations: d.allocations.map((a) => ({ kind: receipt ? ('invoice' as const) : ('bill' as const), documentId: a.documentId, documentNumber: docs.find((x) => x.id === a.documentId)!.number, amount: a.amount })),
      yearName: year.name,
      seq,
    };
    all.push(payment);
    save(all);
    for (const a of d.allocations) await adjust(payment.allocations[0]!.kind, a.documentId, a.amount, { id: payment.id, number: label, date: d.date, amount: a.amount });
    return payment;
  };
  return {
    list: (q) =>
      wait(() => {
        const items = load()
          .filter((p) => (!q.kind || p.kind === q.kind) && (!q.contactId || p.contact.id === q.contactId))
          .sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
        return { total: items.length, page: q.page, pageSize: q.pageSize, items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize) };
      }),
    openBills: (contactId) =>
      wait(async () =>
        (await demoBillViews())
          .filter((b) => b.contact.id === contactId && b.status === 'open' && b.balance > 0)
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .map((b) => ({ id: b.id, number: b.number!, vendorReference: b.vendorReference, issueDate: b.billDate, dueDate: b.dueDate, currency: b.currency, total: b.total, balance: b.balance })),
      ),
    openInvoices: (contactId) =>
      wait(async () =>
        (await demoInvoiceViews())
          .filter((i) => i.contact.id === contactId && i.status === 'issued' && i.balance > 0)
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .map((i) => ({ id: i.id, number: i.number!, issueDate: i.issueDate, dueDate: i.dueDate, currency: i.currency, total: i.total, balance: i.balance })),
      ),
    receive: (input) =>
      wait(() => {
        const p = receiptSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        return settle('receipt', { ...p.data, allocations: p.data.allocations.map((x) => ({ documentId: x.invoiceId, amount: x.amount })) });
      }),
    pay: (input) =>
      wait(() => {
        const p = vendorPaymentSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const vendor = demoContactRows().find((c) => c.id === p.data.contactId);
        if (opts.approvalsAs && vendor) demoApprovalCheck('payment', { documentId: null, amount: p.data.amount, summary: `Payment to ${vendor.name}${p.data.reference ? ` · ${p.data.reference}` : ''}`, payload: input }, opts.approvalsAs);
        return settle('payment', { ...p.data, allocations: p.data.allocations.map((x) => ({ documentId: x.billId, amount: x.amount })) });
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
        for (const a of p.allocations) await adjust(a.kind, a.documentId, -a.amount);
        return p;
      }),
  };
}
