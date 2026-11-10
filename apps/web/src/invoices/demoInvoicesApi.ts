import { buildEinvoice, einvoiceProblems, zeroHeads, type EinvoiceInput, invoiceRows, pdfTableBytes, qrMatrix, rupeesInWords, upiPayUri, currencyDigits, dueDateFor, invoiceAmounts, invoiceDraftSchema, invoiceNumber, invoiceReminderSchema, DEFAULT_REMINDER_POLICY, reminderPolicySchema, invoiceState, splitTax, todayIn, toBase, type InvoiceStatus } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { csvBlob, major } from '../lib/listCsv';
import { demoCostOfSale, demoSaveMovements, demoUndoDocument } from '../inventory/demoInventoryApi';
import { demoCostCentreRef } from '../cost-centres/demoCostCentresApi';
import { demoAccountRows, sampleId } from '../accounts/demoAccountsApi';
import { demoContactRows } from '../contacts/demoContactsApi';
import { demoRateOn } from '../currencies/demoCurrenciesApi';
import { demoItemRows } from '../items/demoItemsApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import { createDemoPeriodsApi } from '../periods/demoPeriodsApi';
import { demoTaxState } from '../taxes/demoTaxesApi';
import { groupForSupply, supplyFor } from './gst';
import type { PublicInvoice } from '../public/types';
import type { EinvoiceBatch, Invoice, InvoicesApi } from './types';

/**
 * Invoices in demo mode for the sample company in Pune (Maharashtra, GST state 27): the month's invoice to
 * Kumar Logistics (already in the books) and a draft for Bluewave Clinics in Karnataka, which takes IGST.
 */
const KEY = 'ledgernest.demo.invoices';
const POLICY_KEY = 'ledgernest.demo.reminderPolicy';
const ORG_STATE = '27';
type StoredLine = { itemId: string | null; description: string; quantity: string; unitPrice: number; discountPpm: number; taxGroupId: string | null; accountId: string; costCentreId?: string | null };
type Stored = {
  id: string;
  number: number | null;
  yearName: string | null;
  status: InvoiceStatus;
  contactId: string;
  issueDate: string;
  dueDate: string;
  currency: string | null;
  rate: string | null;
  placeOfSupply: string | null;
  reference: string | null;
  notes: string | null;
  amountPaid: number;
  journalEntryId: string | null;
  journalNumber: string | null;
  voidEntryId: string | null;
  voidNumber: string | null;
  lines: StoredLine[];
  payments?: { id: string; number: string; date: string; amount: number }[];
  credits?: { id: string; number: string; date: string; amount: number }[];
  creditNotes?: { id: string; number: string; status: 'issued' | 'void'; total: number }[];
  lastRemindedAt?: string | null;
  reminders?: number;
  share?: { token: string; views: number; lastViewedAt: string | null } | null;
};
const today = () => todayIn('Asia/Kolkata');
const thisMonth = (day: number) => `${today().slice(0, 8)}${String(Math.min(day, Number(today().slice(8)))).padStart(2, '0')}`;

async function seed(): Promise<Stored[]> {
  const contacts = demoContactRows();
  const kumar = contacts.find((c) => c.name === 'Kumar Logistics')!;
  const bluewave = contacts.find((c) => c.name === 'Bluewave Clinics')!;
  const gst18 = demoTaxState().groups.find((g) => g.name === 'GST 18%')?.id ?? null;
  const dev = demoItemRows().find((i) => i.sku === 'DEV-HR');
  const journals = createDemoJournalsApi(() => true);
  // The month's sale to Kumar Logistics is already posted in the sample books: link it
  const posted = (await journals.list({ status: 'posted', search: 'Kumar Logistics', page: 1, pageSize: 5 })).items.find((e) => e.memo?.startsWith('Invoice'));
  const yearName = posted?.number ? `FY ${posted.number.split('/')[1]!.replace('-', '–')}` : null;
  const rows: Stored[] = [];
  if (posted && yearName) {
    rows.push({ id: crypto.randomUUID(), number: 1, yearName, status: 'issued', contactId: kumar.id, issueDate: thisMonth(2), dueDate: dueDateFor(thisMonth(2), kumar.paymentTermsDays), currency: null, rate: null, placeOfSupply: kumar.stateCode, reference: 'PO-4471', notes: null, amountPaid: 0, journalEntryId: posted.id, journalNumber: posted.number, voidEntryId: null, voidNumber: null, lines: [{ itemId: dev?.id ?? null, description: 'Software development, sprint 14', quantity: '40', unitPrice: 250_000, discountPpm: 0, taxGroupId: gst18, accountId: sampleId('4100.01') }] });
  }
  rows.push({
    id: crypto.randomUUID(),
    number: null,
    yearName: null,
    status: 'draft',
    contactId: bluewave.id,
    issueDate: today(),
    dueDate: dueDateFor(today(), bluewave.paymentTermsDays),
    currency: null,
    rate: null,
    placeOfSupply: bluewave.stateCode,
    reference: null,
    notes: 'Thank you for your business.',
    amountPaid: 0,
    journalEntryId: null,
    journalNumber: null,
    voidEntryId: null,
    voidNumber: null,
    lines: [
      { itemId: dev?.id ?? null, description: 'Appointment app: design and build', quantity: '24', unitPrice: 250_000, discountPpm: 0, taxGroupId: gst18, accountId: sampleId('4100.01') },
      { itemId: null, description: 'Annual maintenance, first year', quantity: '1', unitPrice: 12_000_000, discountPpm: 100_000, taxGroupId: gst18, accountId: sampleId('4200') },
    ],
  });
  return rows;
}
async function load(): Promise<Stored[]> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch {
    /* fall through */
  }
  const s = await seed();
  save(s);
  return s;
}
function save(rows: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* private mode */
  }
}
/** The demo's invoices as the screens see them, for receipts */
export async function demoInvoiceViews(): Promise<Invoice[]> {
  return (await load()).map(view);
}
/** A receipt (or its void) changes what an invoice has had paid */
export async function demoAdjustPaid(invoiceId: string, delta: number, payment?: { id: string; number: string; date: string; amount: number }) {
  const rows = await load();
  const i = rows.find((r) => r.id === invoiceId);
  if (!i) return;
  i.amountPaid += delta;
  i.payments = payment ? [...(i.payments ?? []), payment] : (i.payments ?? []).filter((p) => p.amount !== -delta || delta > 0);
  save(rows);
}

/** A credit note (or its void) puts credit on an invoice or takes it off: keyed by the note */
export async function demoAdjustCredit(invoiceId: string, credit: { id: string; number: string; date: string; amount: number }, remove = false) {
  const rows = await load();
  const i = rows.find((r) => r.id === invoiceId);
  if (!i) return;
  i.amountPaid += remove ? -credit.amount : credit.amount;
  i.credits = remove ? (i.credits ?? []).filter((c) => !(c.id === credit.id && c.date === credit.date && c.amount === credit.amount)) : [...(i.credits ?? []), credit];
  save(rows);
}
/** Records a credit note raised against an invoice, or its new status */
export async function demoTrackCreditNote(invoiceId: string, note: { id: string; number: string; status: 'issued' | 'void'; total: number }) {
  const rows = await load();
  const i = rows.find((r) => r.id === invoiceId);
  if (!i) return;
  i.creditNotes = [...(i.creditNotes ?? []).filter((n) => n.id !== note.id), note];
  save(rows);
}

export const resetDemoInvoices = () => {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(POLICY_KEY);
  } catch {
    /* nothing stored */
  }
};

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));

/** A group with its rates, from the demo's taxes */
/** The demo's shared links, opened in the same browser: the invoice as its customer sees it */
export async function demoPublicInvoice(token: string): Promise<{ view: PublicInvoice; pdf: () => Blob } | null> {
  const rows = await load();
  const i = rows.find((r) => r.share?.token === token);
  if (!i || i.status === 'void') return null;
  i.share = { ...i.share!, views: i.share!.views + 1, lastViewedAt: new Date().toISOString() };
  save(rows);
  const v = view(i);
  let upiId: string | null = null;
  try {
    upiId = (JSON.parse(localStorage.getItem('ledgernest.demo.settings') ?? 'null') as { settings?: { upiId?: string | null } } | null)?.settings?.upiId ?? null;
  } catch {
    /* no saved settings */
  }
  const upi = upiId && !v.currency && v.balance > 0 && v.number ? upiPayUri({ upiId, name: 'Nest Demo Private Limited', amount: v.balance, note: `Invoice ${v.number}`, reference: v.number }) : null;
  return {
    view: {
      organization: { name: 'Nest Demo Private Limited', taxId: '27AAPFN1234C1Z5', email: 'accounts@nestdemo.in', phone: '+91 20 4000 1234', address: { line1: '4th Floor, Riverside Business Bay', line2: 'Baner Road', city: 'Pune', region: 'Maharashtra', postalCode: '411045' }, terms: null, hasLogo: false },
      invoice: {
        number: v.number!,
        state: v.state,
        issueDate: v.issueDate,
        dueDate: v.dueDate,
        currency: v.currency ?? 'INR',
        placeOfSupply: v.placeOfSupply,
        reference: v.reference,
        customer: { name: v.contact.legalName ?? v.contact.name, taxId: v.contact.taxId },
        lines: v.lines.map((l) => ({ description: l.description, hsnSac: l.item?.hsnSac ?? null, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, amount: l.amount, taxAmount: l.taxAmount })),
        subtotal: v.subtotal,
        taxBreakdown: v.taxBreakdown,
        total: v.total,
        amountPaid: v.amountPaid,
        balance: v.balance,
      },
      upi: upi && upiId ? { link: upi, upiId } : null,
    },
    pdf: () => new Blob([pdfTableBytes({ title: `Tax invoice ${v.number}`, subtitle: 'Nest Demo Private Limited', info: [`Bill to: ${v.contact.legalName ?? v.contact.name}`, `Invoice date ${v.issueDate} · Due ${v.dueDate}`], footer: `Nest Demo Private Limited · ${v.number}`, rows: invoiceRows({ ...v, currency: v.currency ?? 'INR' }, currencyDigits(v.currency ?? 'INR')), after: v.currency ? undefined : [`Amount in words: ${rupeesInWords(v.total)}`], qr: upi ? { modules: qrMatrix(upi), caption: ['Scan to pay with any UPI app', `Rs ${(v.balance / 100).toFixed(2)} to ${upiId}`] } : undefined }).buffer as ArrayBuffer], { type: 'application/pdf' }),
  };
}

/** The demo organisation's details for e-invoices, as saved in Settings */
function demoSeller(): EinvoiceInput['seller'] {
  let saved: { taxId?: string | null; legalName?: string | null; name?: string; phone?: string | null; email?: string | null; address?: { line1: string | null; line2: string | null; city: string | null; postalCode: string | null } } | undefined;
  try {
    saved = (JSON.parse(localStorage.getItem('ledgernest.demo.settings') ?? 'null') as { settings?: typeof saved } | null)?.settings;
  } catch {
    /* sample details */
  }
  const a = saved?.address ?? { line1: '4th Floor, Riverside Business Bay', line2: 'Baner Road', city: 'Pune', postalCode: '411045' };
  return { gstin: saved?.taxId ?? '27AAPFN1234C1Z5', legalName: saved?.legalName ?? 'Nest Demo Private Limited', tradeName: saved?.name ?? 'Nest Demo Pvt. Ltd.', address1: a.line1, address2: a.line2, city: a.city, pin: a.postalCode, phone: saved?.phone ?? '+91 20 4000 1234', email: saved?.email ?? 'accounts@nestdemo.in' };
}
/** A demo invoice as e-invoice input: tax by head from its groups' rates */
function demoEinvoiceInput(v: Invoice): EinvoiceInput {
  return {
    kind: 'invoice',
    number: v.number ?? '',
    date: v.issueDate,
    currency: v.currency ?? 'INR',
    placeOfSupply: v.placeOfSupply,
    seller: demoSeller(),
    buyer: { gstin: v.contact.taxId, legalName: v.contact.legalName ?? v.contact.name, address1: v.contact.billingAddress.line1 ?? null, address2: v.contact.billingAddress.line2 ?? null, city: v.contact.billingAddress.city ?? v.contact.billingAddress.region ?? null, pin: v.contact.billingAddress.postalCode ?? null },
    lines: v.lines.map((l) => {
      const g = l.taxGroup ? groupOf(l.taxGroup.id) : null;
      const heads = zeroHeads();
      splitTax(l.amount, false, (g?.rates ?? []).map((r) => ({ rateId: r.id, ratePpm: r.ratePpm }))).taxes.forEach((t, k) => {
        const kind = g!.rates[k]!.kind;
        const h = kind === 'igst' ? 'igst' : kind === 'cgst' ? 'cgst' : kind === 'sgst' || kind === 'utgst' ? 'sgst' : kind === 'cess' ? 'cess' : null;
        if (h) heads[h] += t.amount;
      });
      return { description: l.description, hsn: l.item?.hsnSac ?? null, quantity: l.quantity, unit: (l.item as { unit?: string | null } | null)?.unit ?? null, unitPrice: l.unitPrice, amount: l.amount, heads, gstRate: (g?.rates ?? []).filter((r) => ['igst', 'cgst', 'sgst', 'utgst'].includes(r.kind)).reduce((x, r) => x + r.ratePpm, 0) / 10_000 };
    }),
  };
}

export function groupOf(id: string | null) {
  if (!id) return null;
  const tax = demoTaxState();
  const g = tax.groups.find((x) => x.id === id);
  if (!g) return null;
  const rates = g.rateIds.map((rid) => tax.rates.find((r) => r.id === rid)!);
  return { id: g.id, name: g.name, gstSlabId: g.gstSlabId, supply: g.supply, archived: !!g.archivedAt, rates };
}
function allGroups() {
  return demoTaxState().groups.map((g) => groupOf(g.id)!);
}

function view(i: Stored): Invoice {
  const contact = demoContactRows().find((c) => c.id === i.contactId)!;
  const accounts = demoAccountRows();
  const items = demoItemRows();
  const groups = i.lines.map((l) => groupOf(l.taxGroupId));
  const a = invoiceAmounts(i.lines.map((l, n) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPpm: l.discountPpm, rates: (groups[n]?.rates ?? []).map((r) => ({ rateId: r.id, ratePpm: r.ratePpm })) })));
  const breakdown = new Map<string, number>();
  i.lines.forEach((_l, n) => {
    const g = groups[n];
    if (!g) return;
    splitTax(a.lines[n]!.net, false, g.rates.map((r) => ({ rateId: r.id, ratePpm: r.ratePpm }))).taxes.forEach((t, k) => breakdown.set(g.rates[k]!.name, (breakdown.get(g.rates[k]!.name) ?? 0) + t.amount));
  });
  const receivable = accounts.find((x) => x.type === 'asset' && (x.currency ?? null) === i.currency && /receivable/i.test(x.name));
  const base = {
    id: i.id,
    number: i.number && i.yearName ? invoiceNumber(i.yearName, i.number) : null,
    status: i.status,
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    currency: i.currency,
    rate: i.rate,
    placeOfSupply: i.placeOfSupply,
    reference: i.reference,
    notes: i.notes,
    contact: { id: contact.id, name: contact.name, legalName: contact.legalName, taxId: contact.taxId, email: contact.email, phone: contact.phone ?? null, billingAddress: { ...contact.billingAddress }, shippingAddress: contact.shippingAddress && { ...contact.shippingAddress }, stateCode: contact.stateCode },
    receivableAccount: receivable ? { id: receivable.id, code: receivable.code, name: receivable.name } : null,
    subtotal: a.subtotal,
    taxTotal: a.tax,
    total: a.total,
    amountPaid: i.amountPaid,
    balance: a.total - i.amountPaid,
    taxBreakdown: [...breakdown].map(([name, amount]) => ({ name, amount })),
    journalEntry: i.journalEntryId ? { id: i.journalEntryId, number: i.journalNumber } : null,
    payments: i.payments ?? [],
    credits: i.credits ?? [],
    creditNotes: i.creditNotes ?? [],
    lastRemindedAt: i.lastRemindedAt ?? null,
    reminders: i.reminders ?? 0,
    share: i.share ?? null,
    voidEntry: i.voidEntryId ? { id: i.voidEntryId, number: i.voidNumber } : null,
    lines: i.lines.map((l, n) => {
      const item = l.itemId ? items.find((x) => x.id === l.itemId) : undefined;
      const acc = accounts.find((x) => x.id === l.accountId);
      const g = groups[n];
      return {
        // A UUID like the API's, stable per line: the invoice's with the line's index in its last digits
        id: `${i.id.slice(0, 32)}${n.toString(16).padStart(4, '0')}`,
        lineNo: n + 1,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discountPpm / 10_000,
        amount: a.lines[n]!.net,
        taxAmount: a.lines[n]!.tax,
        item: item ? { id: item.id, name: item.name, hsnSac: item.hsnSac, unit: item.unit } : null,
        costCentre: demoCostCentreRef(l.costCentreId),
        account: acc ? { id: acc.id, code: acc.code, name: acc.name } : null,
        taxGroup: g ? { id: g.id, name: g.name, supply: g.supply } : null,
      };
    }),
  };
  return { ...base, state: invoiceState({ status: i.status, total: a.total, amountPaid: i.amountPaid, dueDate: i.dueDate }, today()) };
}

/** The same checks and line rules as the API */
export const demoPrepareSale = (input: unknown): Omit<Stored, 'id' | 'number' | 'yearName' | 'status' | 'amountPaid' | 'journalEntryId' | 'journalNumber' | 'voidEntryId' | 'voidNumber'> => {
  const p = invoiceDraftSchema.safeParse(input);
  if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
  const d = p.data;
  const contact = demoContactRows().find((c) => c.id === d.contactId);
  if (!contact) throw refuse(400, 'contact_not_found', { field: 'contactId' });
  if (!contact.isCustomer) throw refuse(400, 'not_customer', { field: 'contactId' });
  if (contact.archived) throw refuse(400, 'contact_archived', { field: 'contactId' });
  const placeOfSupply = d.placeOfSupply ?? contact.stateCode;
  const supply = supplyFor(ORG_STATE, placeOfSupply);
  const items = demoItemRows();
  const accounts = demoAccountRows();
  const groups = allGroups();
  const lines = d.lines.map((l, n) => {
    const item = l.itemId ? items.find((x) => x.id === l.itemId) : undefined;
    if (l.itemId && !item) throw refuse(400, 'item_not_found');
    const accountId = l.accountId ?? item?.incomeAccountId ?? null;
    if (!accountId) throw refuse(400, 'account_required', { line: n + 1 });
    if (accounts.find((a) => a.id === accountId)?.type !== 'income') throw refuse(400, 'not_income', { line: n + 1 });
    let group = l.taxGroupId ? groups.find((g) => g.id === l.taxGroupId) : null;
    if (l.taxGroupId && !group) throw refuse(400, 'tax_group_not_found');
    if (group) group = groupForSupply(group, supply, groups);
    return { itemId: l.itemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPpm: l.discount, taxGroupId: group?.id ?? null, accountId, costCentreId: l.costCentreId ?? null };
  });
  return { contactId: contact.id, issueDate: d.issueDate, dueDate: d.dueDate ?? dueDateFor(d.issueDate, contact.paymentTermsDays), currency: contact.currency, rate: d.rate, placeOfSupply, reference: d.reference, notes: d.notes, lines };
};

export function createDemoInvoicesApi(canManage: () => boolean): InvoicesApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['invoices.manage'] });
  };
  const find = (rows: Stored[], iid: string) => {
    const i = rows.find((r) => r.id === iid);
    if (!i) throw new ApiError('not_found', 404);
    return i;
  };
  const prepare = demoPrepareSale;
  const api: InvoicesApi = {
    pdf: async (iid) => {
      const v = view(find(await load(), iid));
      if (v.status === 'draft') throw refuse(409, 'not_issued');
      // The demo organisation's UPI ID, when one was saved in Settings
      let upiId: string | null = null;
      try {
        upiId = (JSON.parse(localStorage.getItem('ledgernest.demo.settings') ?? 'null') as { settings?: { upiId?: string | null } } | null)?.settings?.upiId ?? null;
      } catch {
        /* no saved settings */
      }
      const upi = upiId && !v.currency && v.status === 'issued' && v.balance > 0 && v.number ? upiPayUri({ upiId, name: 'Nest Demo Private Limited', amount: v.balance, note: `Invoice ${v.number}`, reference: v.number }) : null;
      const bytes = pdfTableBytes({ title: `Tax invoice ${v.number}`, subtitle: 'Nest Demo Private Limited', info: [`Bill to: ${v.contact.legalName ?? v.contact.name}`, `Invoice date ${v.issueDate} · Due ${v.dueDate}`], footer: `Nest Demo Private Limited · ${v.number}`, rows: invoiceRows({ ...v, currency: v.currency ?? 'INR' }, currencyDigits(v.currency ?? 'INR')), after: v.currency ? undefined : [`Amount in words: ${rupeesInWords(v.total)}`], qr: upi ? { modules: qrMatrix(upi), caption: ['Scan to pay with any UPI app', `Rs ${(v.balance / 100).toFixed(2)} to ${upiId}`] } : undefined });
      return { blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), filename: `invoice-${(v.number ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf` };
    },
    exportList: async (q) => {
      const all = (await api.list({ ...q, page: 1, pageSize: 10_000 })).items;
      const rows = [['number', 'state', 'issue_date', 'due_date', 'customer', 'reference', 'currency', 'total', 'paid', 'balance'], ...all.map((i) => { const cur = i.currency ?? 'INR'; return [i.number ?? 'Draft', i.state, i.issueDate, i.dueDate, i.contact.name, i.reference ?? '', cur, major(i.total, cur), i.status === 'issued' ? major(i.amountPaid, cur) : '', i.status === 'issued' ? major(i.balance, cur) : '']; })];
      return { blob: csvBlob(rows), filename: 'invoices.csv' };
    },
    list: (q) =>
      wait(async () => {
        const all = (await load()).map(view);
        const s = q.search?.trim().toLowerCase();
        const items = all
          .filter((i) => !q.state || (q.state === 'unpaid' ? i.status === 'issued' && i.balance > 0 : q.state === 'issued' ? i.status === 'issued' : i.state === q.state))
          .filter((i) => !q.contactId || i.contact.id === q.contactId)
          .filter((i) => !s || [i.number, i.reference, i.contact.name].some((x) => x?.toLowerCase().includes(s)))
          .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || (b.number ?? '').localeCompare(a.number ?? ''));
        const open = all.filter((i) => i.status === 'issued' && i.balance > 0 && !i.currency);
        return {
          total: items.length,
          page: q.page,
          pageSize: q.pageSize,
          summary: { outstanding: open.reduce((t, i) => t + i.balance, 0), overdue: open.filter((i) => i.dueDate < today()).reduce((t, i) => t + i.balance, 0) },
          items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((i) => ({ id: i.id, number: i.number, status: i.status, state: i.state, contact: { id: i.contact.id, name: i.contact.name }, issueDate: i.issueDate, dueDate: i.dueDate, currency: i.currency, total: i.total, amountPaid: i.amountPaid, balance: i.balance, reference: i.reference })),
        };
      }),
    get: (iid) => wait(async () => view(find(await load(), iid))),
    create: (input) =>
      wait(async () => {
        guard();
        const rows = await load();
        const i: Stored = { id: crypto.randomUUID(), number: null, yearName: null, status: 'draft', amountPaid: 0, journalEntryId: null, journalNumber: null, voidEntryId: null, voidNumber: null, ...prepare(input) };
        rows.push(i);
        save(rows);
        return view(i);
      }),
    update: (iid, input) =>
      wait(async () => {
        guard();
        const rows = await load();
        const i = find(rows, iid);
        if (i.status !== 'draft') throw refuse(409, 'not_draft');
        Object.assign(i, prepare(input));
        save(rows);
        return view(i);
      }),
    remove: (iid) =>
      wait(async () => {
        guard();
        const rows = await load();
        if (find(rows, iid).status !== 'draft') throw refuse(409, 'not_draft');
        save(rows.filter((r) => r.id !== iid));
      }),
    issue: (iid) =>
      wait(async () => {
        guard();
        const rows = await load();
        const i = find(rows, iid);
        if (i.status !== 'draft') throw refuse(409, 'not_draft');
        const v = view(i);
        if (v.total <= 0) throw refuse(400, 'zero_total');
        const receivable = v.receivableAccount;
        if (!receivable) throw refuse(409, 'no_receivable_account', { currency: i.currency });
        const { years } = await createDemoPeriodsApi(() => true).list();
        const year = years.find((y) => y.startDate <= i.issueDate && i.issueDate <= y.endDate);
        if (!year) throw refuse(409, 'no_period');
        const number = Math.max(0, ...rows.filter((r) => r.yearName === year.name && r.number).map((r) => r.number!)) + 1;
        const label = invoiceNumber(year.name, number);
        let rate: string | null = null;
        if (i.currency) {
          rate = i.rate ?? demoRateOn(i.currency, i.issueDate);
          if (!rate) throw refuse(400, 'no_rate', { currency: i.currency, date: i.issueDate });
        }
        const journals = createDemoJournalsApi(() => true);
        // Foreign invoices keep the receivable in their currency; income is in rupees at the same rate
        const toInr = (minor: number) => (rate ? toBase(minor, rate, currencyDigits(i.currency!), 2) : minor);
        const lines = [
          i.currency ? { accountId: receivable.id, description: label, currency: i.currency, foreignDebit: v.total, rate: rate! } : { accountId: receivable.id, description: label, debit: v.total },
          ...v.lines.filter((l) => l.amount > 0).map((l) => ({ accountId: l.account!.id, description: l.description, credit: toInr(l.amount), taxGroupId: i.currency ? null : (l.taxGroup?.id ?? null), costCentreId: l.costCentre?.id ?? null })),
        ];
        // Tracked goods leave stock at their average cost, to cost of sales
        const cost = demoCostOfSale(v.lines.map((l) => ({ itemId: l.item?.id ?? null, quantity: l.quantity, costCentreId: l.costCentre?.id ?? null })));
        const draft = await journals.create({ date: i.issueDate, memo: `Invoice ${label} · ${v.contact.name}`, reference: label, lines: [...lines, ...cost.journal] });
        const posted = await journals.post(draft.id).catch(async (e: unknown) => {
          await journals.remove(draft.id);
          throw e;
        });
        demoSaveMovements('invoice', i.id, i.issueDate, posted.id, cost.movements);
        Object.assign(i, { status: 'issued', number, yearName: year.name, rate, journalEntryId: posted.id, journalNumber: posted.number });
        save(rows);
        return view(i);
      }),
    void: (iid, input) =>
      wait(async () => {
        guard();
        const rows = await load();
        const i = find(rows, iid);
        if (i.status !== 'issued') throw refuse(409, 'not_issued');
        if (i.amountPaid > 0) throw refuse(409, 'has_payments');
        const r = await createDemoJournalsApi(() => true).reverse(i.journalEntryId!, { date: input.date ?? today(), memo: `Invoice voided${input.reason ? `: ${input.reason}` : ''}` });
        demoUndoDocument('invoice', i.id, input.date ?? today(), r.id);
        Object.assign(i, { status: 'void', voidEntryId: r.id, voidNumber: r.number });
        save(rows);
        return view(i);
      }),
    einvoice: async (iid) => {
      const v = view(find(await load(), iid));
      if (v.status !== 'issued') throw refuse(409, 'not_issued');
      const input = demoEinvoiceInput(v);
      const problems = einvoiceProblems(input);
      if (problems.length) throw new ApiError('conflict', 409, undefined, undefined, { reason: 'einvoice_incomplete', problems });
      return { blob: new Blob([JSON.stringify(buildEinvoice(input), null, 2)], { type: 'application/json' }), filename: `e-invoice-${input.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json` };
    },
    einvoices: async (from, to) => {
      const views = (await load()).map(view).filter((v) => v.status === 'issued' && v.contact.taxId && v.issueDate >= from && v.issueDate <= to);
      const out: EinvoiceBatch = { from, to, invoices: [], skipped: [] };
      for (const v of views) {
        const input = demoEinvoiceInput(v);
        const problems = einvoiceProblems(input);
        if (problems.length) out.skipped.push({ id: v.id, number: input.number, problems });
        else out.invoices.push(buildEinvoice(input));
      }
      return out;
    },
    share: (iid) =>
      wait(async () => {
        guard();
        const rows = await load();
        const i = find(rows, iid);
        if (i.status !== 'issued') throw refuse(409, 'not_issued');
        if (!i.share) {
          const bytes = crypto.getRandomValues(new Uint8Array(24));
          const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          i.share = { token, views: 0, lastViewedAt: null };
          save(rows);
        }
        return { ...i.share };
      }),
    unshare: (iid) =>
      wait(async () => {
        guard();
        const rows = await load();
        const i = find(rows, iid);
        i.share = null;
        save(rows);
      }),
    remind: (iid, input) =>
      wait(async () => {
        guard();
        const q = invoiceReminderSchema.safeParse(input);
        if (!q.success) throw new ApiError('validation', 400, undefined, undefined, { fields: q.error.issues });
        const rows = await load();
        const i = find(rows, iid);
        const v = view(i);
        if (v.status !== 'issued' || v.balance <= 0) throw refuse(409, 'nothing_owed');
        const to = q.data.email ?? v.contact.email;
        if (!to) throw refuse(400, 'no_email');
        Object.assign(i, { lastRemindedAt: new Date().toISOString(), reminders: (i.reminders ?? 0) + 1 });
        save(rows);
        return { sentTo: to, lastRemindedAt: i.lastRemindedAt!, reminders: i.reminders! };
      }),
    remindOverdue: (contactId) =>
      wait(async () => {
        guard();
        const contact = demoContactRows().find((c) => c.id === contactId);
        if (!contact) throw new ApiError('not_found', 404);
        if (!contact.email) throw refuse(400, 'no_email');
        const rows = await load();
        const due = rows.filter((i) => i.contactId === contactId && i.status === 'issued' && i.dueDate < today() && view(i).balance > 0);
        const now = new Date().toISOString();
        for (const i of due) Object.assign(i, { lastRemindedAt: now, reminders: (i.reminders ?? 0) + 1 });
        save(rows);
        return { sentTo: contact.email, sent: due.length, failed: [] };
      }),
    email: (iid, input) =>
      wait(async () => {
        guard();
        const q = invoiceReminderSchema.safeParse(input);
        if (!q.success) throw new ApiError('validation', 400, undefined, undefined, { fields: q.error.issues });
        const v = view(find(await load(), iid));
        if (v.status !== 'issued') throw refuse(409, 'not_issued');
        const to = q.data.email ?? v.contact.email;
        if (!to) throw refuse(400, 'no_email');
        return { sentTo: to };
      }),
    reminderPolicy: () =>
      wait(() => {
        try {
          const raw = localStorage.getItem(POLICY_KEY);
          return raw ? reminderPolicySchema.parse(JSON.parse(raw)) : DEFAULT_REMINDER_POLICY;
        } catch {
          return DEFAULT_REMINDER_POLICY;
        }
      }),
    setReminderPolicy: (policy) =>
      wait(() => {
        guard();
        const p = reminderPolicySchema.safeParse(policy);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        try {
          localStorage.setItem(POLICY_KEY, JSON.stringify(p.data));
        } catch {
          // storage blocked: it lasts until the page closes
        }
        return p.data;
      }),
  };
  return api;
}
