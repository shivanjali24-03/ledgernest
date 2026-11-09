import { contactCreateSchema, contactStateCode, contactUpdateSchema, gstinCheckChar, type ContactAddress } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoEnabledCurrencies, DEMO_BASE_CURRENCY } from '../currencies/demoCurrenciesApi';
import type { Contact, ContactsApi } from './types';

/**
 * Customers and vendors of the sample company (a Pune software firm): Indian clients with real-format GSTINs,
 * a US client billed in USD, and vendors in India, the US and Dubai.
 */
const KEY = 'ledgernest.demo.contacts';
const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;
const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const address = (a: Partial<ContactAddress>): ContactAddress => ({ line1: null, line2: null, city: null, region: null, postalCode: null, country: null, ...a });

function seed(): Contact[] {
  const at = '2026-04-01T09:00:00Z';
  const c = (n: number, v: Partial<Contact> & Pick<Contact, 'name'>): Contact => {
    const row: Contact = { id: id(n), isCustomer: false, isVendor: false, legalName: null, taxId: null, email: null, phone: null, billingAddress: address({}), shippingAddress: null, stateCode: null, currency: null, paymentTermsDays: 30, notes: null, archived: false, createdAt: at, ...v };
    return { ...row, stateCode: contactStateCode(row) };
  };
  return [
    c(1, { name: 'Kumar Logistics', isCustomer: true, legalName: 'Kumar Logistics Private Limited', taxId: gstin('27AAKCK4821R1Z'), email: 'accounts@kumarlogistics.in', phone: '+91 20 4011 2200', billingAddress: address({ line1: 'Plot 18, Hinjewadi Phase 2', city: 'Pune', region: 'Maharashtra', postalCode: '411057', country: 'IN' }), paymentTermsDays: 15 }),
    c(2, { name: 'Bluewave Clinics', isCustomer: true, legalName: 'Bluewave Healthcare LLP', taxId: gstin('29AAQFB7310K1Z'), email: 'finance@bluewave.health', billingAddress: address({ line1: '80 Feet Road, Koramangala', city: 'Bengaluru', region: 'Karnataka', postalCode: '560034', country: 'IN' }), paymentTermsDays: 30 }),
    c(3, { name: 'Northwind Inc.', isCustomer: true, legalName: 'Northwind Traders Inc.', taxId: 'EIN 84-1234567', email: 'ap@northwind.example', billingAddress: address({ line1: '500 Congress Ave', city: 'Austin', region: 'Texas', postalCode: '78701', country: 'US' }), currency: 'USD', paymentTermsDays: 45 }),
    c(4, { name: 'Sharma Office Supplies', isVendor: true, taxId: gstin('27ABZPS6519M1Z'), phone: '+91 98220 31144', billingAddress: address({ line1: 'Shop 4, Laxmi Road', city: 'Pune', region: 'Maharashtra', postalCode: '411030', country: 'IN' }), paymentTermsDays: 7 }),
    c(5, { name: 'Amazon Web Services', isVendor: true, legalName: 'Amazon Web Services, Inc.', email: 'aws-receivables@amazon.example', billingAddress: address({ city: 'Seattle', region: 'Washington', country: 'US' }), currency: 'USD', paymentTermsDays: 0 }),
    c(6, { name: 'Gulf Traders LLC', isCustomer: true, isVendor: true, billingAddress: address({ line1: 'Office 1204, Bay Square', city: 'Dubai', country: 'AE' }), currency: 'AED', paymentTermsDays: 30, notes: 'Buys our support plans and resells hardware to us.' }),
  ];
}
function load(): Contact[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Contact[];
  } catch {
    /* fall through */
  }
  return seed();
}
function save(rows: Contact[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* private mode */
  }
}
export const resetDemoContacts = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};
/** The demo's contacts, for invoices and bills */
export const demoContactRows = () => load();

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));

export function createDemoContactsApi(canManage: () => boolean): ContactsApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['contacts.manage'] });
  };
  const find = (rows: Contact[], cid: string) => {
    const c = rows.find((r) => r.id === cid);
    if (!c) throw new ApiError('not_found', 404);
    return c;
  };
  /** The same whole-contact checks as the API */
  const check = (rows: Contact[], v: Omit<Contact, 'id' | 'archived' | 'createdAt' | 'stateCode'>, exceptId?: string) => {
    if (rows.some((r) => r.id !== exceptId && r.name.toLocaleLowerCase() === v.name.toLocaleLowerCase())) throw refuse(409, 'name_taken', { field: 'name' });
    const currency = v.currency === DEMO_BASE_CURRENCY ? null : v.currency;
    if (currency && !demoEnabledCurrencies().includes(currency)) throw refuse(400, 'currency_not_enabled', { field: 'currency' });
    const whole = contactCreateSchema.safeParse(v);
    if (!whole.success) throw new ApiError('validation', 400, whole.error.issues[0]!.message, undefined, { reason: 'invalid', field: whole.error.issues[0]!.path.join('.') });
    return { ...whole.data, currency, stateCode: contactStateCode(whole.data) };
  };
  return {
    list: (q) =>
      wait(async () => {
        // What each customer owes and each vendor is owed: unpaid documents less advances (loaded on demand: invoices use contacts too)
        const { demoInvoiceViews } = await import('../invoices/demoInvoicesApi');
        const { demoAdvances } = await import('../payments/demoPaymentsApi');
        const { demoStoredBillViews } = await import('../bills/demoBillsApi');
        const invoices = await demoInvoiceViews();
        const bills = demoStoredBillViews();
        const owed = (cid: string) => invoices.filter((i) => i.contact.id === cid && i.status === 'issued').reduce((s, i) => s + i.balance, 0) - demoAdvances(cid);
        const owing = (cid: string) => bills.filter((b) => b.contact.id === cid && b.status === 'open').reduce((s, b) => s + b.balance, 0) - demoAdvances(cid, 'payment');
        const s = q.search?.trim().toLowerCase();
        const items = load()
          .filter((c) => !!q.archived === c.archived)
          .filter((c) => !q.type || (q.type === 'customer' ? c.isCustomer : c.isVendor))
          .filter((c) => !s || [c.name, c.legalName, c.email, c.taxId].some((x) => x?.toLowerCase().includes(s)))
          .sort((a, b) => a.name.localeCompare(b.name));
        return { total: items.length, page: q.page, pageSize: q.pageSize, items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((c) => ({ ...c, receivable: owed(c.id), payable: owing(c.id) })) };
      }),
    get: (cid) => wait(() => find(load(), cid)),
    create: (input) =>
      wait(() => {
        guard();
        const parsed = contactCreateSchema.safeParse(input);
        if (!parsed.success) throw new ApiError('validation', 400, undefined, undefined, { fields: parsed.error.issues });
        const rows = load();
        const v = check(rows, parsed.data);
        const c: Contact = { id: crypto.randomUUID(), ...v, archived: false, createdAt: new Date().toISOString() };
        rows.push(c);
        save(rows);
        return c;
      }),
    update: (cid, input) =>
      wait(() => {
        guard();
        const parsed = contactUpdateSchema.safeParse(input);
        if (!parsed.success) throw new ApiError('validation', 400, undefined, undefined, { fields: parsed.error.issues });
        const rows = load();
        const c = find(rows, cid);
        const { id: _i, archived: _a, createdAt: _c, stateCode: _s, ...current } = c;
        Object.assign(c, check(rows, { ...current, ...parsed.data } as typeof current, cid));
        save(rows);
        return c;
      }),
    archive: (cid, archive) =>
      wait(() => {
        guard();
        const rows = load();
        const c = find(rows, cid);
        if (archive === c.archived) throw refuse(409, archive ? 'already_archived' : 'not_archived');
        c.archived = archive;
        save(rows);
        return c;
      }),
    remove: (cid) =>
      wait(() => {
        guard();
        const rows = load();
        find(rows, cid);
        save(rows.filter((r) => r.id !== cid));
      }),
  };
}
