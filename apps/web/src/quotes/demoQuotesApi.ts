import { currencyDigits, invoiceAmounts, pdfTableBytes, quoteRows, QUOTE_MOVES, quoteDraftSchema, quoteEmailSchema, quoteEditable, quoteNumber, quoteState, QUOTE_TITLES, QUOTE_VALID_DAYS, todayIn, type QuoteKind, type QuoteStatus } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoAccountRows } from '../accounts/demoAccountsApi';
import { demoContactRows } from '../contacts/demoContactsApi';
import { demoCostCentreRef } from '../cost-centres/demoCostCentresApi';
import { createDemoInvoicesApi, demoInvoiceViews, demoPrepareSale, groupOf } from '../invoices/demoInvoicesApi';
import { demoItemRows } from '../items/demoItemsApi';
import type { Quote, QuotesApi } from './types';

const KEY = 'ledgernest.demo.quotes';
type StoredLine = ReturnType<typeof demoPrepareSale>['lines'][number];
type Stored = {
  id: string;
  number: number;
  kind?: QuoteKind;
  status: QuoteStatus;
  contactId: string;
  quoteDate: string;
  expiryDate: string;
  currency: string | null;
  placeOfSupply: string | null;
  reference: string | null;
  notes: string | null;
  lines: StoredLine[];
  invoiceId: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  decidedBy?: string | null;
  decisionNote?: string | null;
  shareToken?: string | null;
  shareViews?: number;
  createdAt: string;
  updatedAt: string;
};

const today = () => todayIn('Asia/Kolkata');
const plusDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));
const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });

/** The sample company has one quote out with Bluewave Clinics */
function seed(): Stored[] {
  const bluewave = demoContactRows().find((c) => c.name === 'Bluewave Clinics');
  const [dev, hosting] = [demoItemRows().find((i) => i.name === 'Software development'), demoItemRows().find((i) => i.name === 'Managed cloud hosting')];
  if (!bluewave || !dev || !hosting) return [];
  const date = plusDays(today(), -5);
  const p = demoPrepareSale({
    contactId: bluewave.id,
    issueDate: date,
    dueDate: plusDays(date, QUOTE_VALID_DAYS),
    reference: 'Clinic app, phase 1',
    lines: [
      { itemId: dev.id, description: 'Patient booking app: design and build', quantity: '120', unitPrice: dev.salePrice!, taxGroupId: dev.taxGroupId },
      { itemId: hosting.id, description: 'Managed cloud hosting, first year', quantity: '12', unitPrice: hosting.salePrice!, discount: 10, taxGroupId: hosting.taxGroupId },
    ],
  });
  const now = new Date().toISOString();
  return [{ id: crypto.randomUUID(), number: 1, status: 'sent', contactId: bluewave.id, quoteDate: date, expiryDate: plusDays(date, QUOTE_VALID_DAYS), currency: p.currency, placeOfSupply: p.placeOfSupply, reference: p.reference, notes: null, lines: p.lines, invoiceId: null, sentAt: now, decidedAt: null, createdAt: now, updatedAt: now }];
}

function load(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch {
    /* start again */
  }
  const rows = seed();
  save(rows);
  return rows;
}
function save(rows: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* storage blocked: lasts until the page closes */
  }
}
export const resetDemoQuotes = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

async function view(q: Stored): Promise<Quote> {
  const contact = demoContactRows().find((c) => c.id === q.contactId)!;
  const accounts = demoAccountRows();
  const items = demoItemRows();
  const groups = q.lines.map((l) => groupOf(l.taxGroupId));
  const a = invoiceAmounts(q.lines.map((l, n) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPpm: l.discountPpm, rates: (groups[n]?.rates ?? []).map((r) => ({ rateId: r.id, ratePpm: r.ratePpm })) })));
  // A draft invoice deleted since: the quote is accepted again
  const invoice = q.invoiceId ? (await demoInvoiceViews()).find((i) => i.id === q.invoiceId) : undefined;
  const status: QuoteStatus = q.status === 'invoiced' && !invoice ? 'accepted' : q.status;
  return {
    id: q.id,
    kind: q.kind ?? 'quote',
    number: quoteNumber(q.number, q.kind ?? 'quote'),
    status,
    state: quoteState({ status, expiryDate: q.expiryDate }, today()),
    quoteDate: q.quoteDate,
    expiryDate: q.expiryDate,
    currency: q.currency,
    placeOfSupply: q.placeOfSupply,
    reference: q.reference,
    notes: q.notes,
    contact: { id: contact.id, name: contact.name, email: contact.email },
    subtotal: a.subtotal,
    taxTotal: a.tax,
    total: a.total,
    invoice: invoice ? { id: invoice.id, number: invoice.number, status: invoice.status } : null,
    sentAt: q.sentAt,
    decidedAt: q.decidedAt,
    decidedBy: q.decidedBy ?? null,
    decisionNote: q.decisionNote ?? null,
    share: q.shareToken ? { token: q.shareToken, views: q.shareViews ?? 0, lastViewedAt: null } : null,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    lines: q.lines.map((l, n) => {
      const item = l.itemId ? items.find((x) => x.id === l.itemId) : undefined;
      const acc = accounts.find((x) => x.id === l.accountId);
      const g = groups[n];
      return {
        id: `${q.id.slice(0, 32)}${n.toString(16).padStart(4, '0')}`,
        lineNo: n + 1,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discountPpm / 10_000,
        amount: a.lines[n]!.net,
        taxAmount: a.lines[n]!.tax,
        item: item ? { id: item.id, name: item.name } : null,
        account: acc ? { id: acc.id, code: acc.code, name: acc.name } : null,
        taxGroup: g ? { id: g.id, name: g.name } : null,
        costCentre: demoCostCentreRef(l.costCentreId) ?? null,
      };
    }),
  };
}

/** A demo quote opened from its link in this browser: counted, as the real one is */
export async function demoQuoteByToken(token: string): Promise<Quote | null> {
  const rows = load();
  const q = rows.find((r) => r.shareToken === token);
  if (!q) return null;
  q.shareViews = (q.shareViews ?? 0) + 1;
  save(rows);
  return view(q);
}
/** The customer's answer from the demo link */
export async function demoDecideQuote(token: string, input: { response: 'accept' | 'decline'; name: string; note?: string | null }): Promise<Quote> {
  const rows = load();
  const q = rows.find((r) => r.shareToken === token);
  if (!q) throw new ApiError('not_found', 404);
  if (q.status !== 'sent') throw refuse(409, 'answered');
  if (q.expiryDate < today()) throw refuse(409, 'expired');
  Object.assign(q, { status: input.response === 'accept' ? 'accepted' : 'declined', decidedAt: new Date().toISOString(), decidedBy: input.name, decisionNote: input.note ?? null });
  save(rows);
  return view(q);
}
/** The PDF of a demo quote */
export async function demoQuotePdf(q: Quote) {
  const cur = q.currency ?? 'INR';
  return new Blob([pdfTableBytes({ title: `Quote ${q.number}`, subtitle: `Nest Demo Private Limited for ${q.contact.name} · ${q.quoteDate}, valid until ${q.expiryDate}`, footer: `Nest Demo Private Limited · ${q.number}`, rows: quoteRows({ ...q, currency: cur }, currencyDigits(cur)) }).buffer as ArrayBuffer], { type: 'application/pdf' });
}

export function createDemoQuotesApi(canManage: () => boolean): QuotesApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['invoices.manage'] });
  };
  const find = (rows: Stored[], id: string) => {
    const q = rows.find((r) => r.id === id);
    if (!q) throw new ApiError('not_found', 404);
    return q;
  };
  /** The same checks as the API: the quote's dates, then the invoice rules for the lines */
  const prepare = (input: unknown) => {
    const p = quoteDraftSchema.safeParse(input);
    if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
    const raw = input as { lines: unknown[] };
    const d = p.data;
    const s = demoPrepareSale({ contactId: d.contactId, issueDate: d.quoteDate, dueDate: d.expiryDate, reference: d.reference, notes: d.notes, placeOfSupply: d.placeOfSupply, lines: raw.lines });
    return { kind: d.kind, contactId: s.contactId, quoteDate: d.quoteDate, expiryDate: d.expiryDate, currency: s.currency, placeOfSupply: s.placeOfSupply, reference: d.reference, notes: d.notes, lines: s.lines };
  };
  return {
    pdf: (id) =>
      wait(async () => {
        const q = await view(find(load(), id));
        const cur = q.currency ?? 'INR';
        const kind = q.kind ?? 'quote';
        const bytes = pdfTableBytes({ title: `${QUOTE_TITLES[kind]} ${q.number}`, subtitle: `Nest Demo Pvt. Ltd. for ${q.contact.name} · ${q.quoteDate}, valid until ${q.expiryDate}`, after: kind === 'proforma' ? ['This is a proforma invoice, not a tax invoice. A tax invoice follows on supply.'] : undefined, footer: `Nest Demo Pvt. Ltd. · ${q.number}`, rows: quoteRows({ ...q, currency: cur }, currencyDigits(cur)) });
        return { blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }), filename: `${kind.replace('_', '-')}-${q.number.toLowerCase()}.pdf` };
      }),
    list: (q) =>
      wait(async () => {
        const all = await Promise.all(load().map(view));
        const s = q.search?.trim().toLowerCase();
        const items = all
          .filter((x) => !q.kind || x.kind === q.kind)
          .filter((x) => !q.state || (q.state === 'open' ? x.state === 'draft' || x.state === 'sent' : x.state === q.state))
          .filter((x) => !q.contactId || x.contact.id === q.contactId)
          .filter((x) => !s || [x.number, x.reference, x.contact.name].some((v) => v?.toLowerCase().includes(s)))
          .sort((a, b) => b.quoteDate.localeCompare(a.quoteDate) || b.number.localeCompare(a.number));
        return { total: items.length, page: q.page, pageSize: q.pageSize, items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(({ lines: _l, ...rest }) => rest) };
      }),
    get: (id) => wait(() => view(find(load(), id))),
    create: (input) =>
      wait(() => {
        guard();
        const p = prepare(input);
        const rows = load();
        const now = new Date().toISOString();
        // Each kind numbers on its own
        const q: Stored = { id: crypto.randomUUID(), number: Math.max(0, ...rows.filter((r) => (r.kind ?? 'quote') === p.kind).map((r) => r.number)) + 1, status: 'draft', ...p, invoiceId: null, sentAt: null, decidedAt: null, createdAt: now, updatedAt: now };
        rows.push(q);
        save(rows);
        return view(q);
      }),
    update: (id, input) =>
      wait(async () => {
        guard();
        const rows = load();
        const q = find(rows, id);
        if (!quoteEditable((await view(q)).status)) throw refuse(409, 'not_editable');
        Object.assign(q, prepare(input), { updatedAt: new Date().toISOString() });
        save(rows);
        return view(q);
      }),
    remove: (id) =>
      wait(() => {
        guard();
        const rows = load();
        if (find(rows, id).status !== 'draft') throw refuse(409, 'not_draft');
        save(rows.filter((r) => r.id !== id));
      }),
    move: (id, status) =>
      wait(async () => {
        guard();
        const rows = load();
        const q = find(rows, id);
        const from = (await view(q)).status;
        if (!QUOTE_MOVES[from].includes(status)) throw refuse(409, 'bad_move', { from, to: status });
        const now = new Date().toISOString();
        Object.assign(q, { status, invoiceId: null, updatedAt: now, sentAt: status === 'sent' ? (q.sentAt ?? now) : q.sentAt, decidedAt: status === 'accepted' || status === 'declined' ? now : null });
        save(rows);
        return view(q);
      }),
    copy: (id, kind) =>
      wait(async () => {
        guard();
        const rows = load();
        const src = find(rows, id);
        const now = new Date().toISOString();
        const today = todayIn('Asia/Kolkata');
        const days = Math.round((Date.parse(src.expiryDate) - Date.parse(src.quoteDate)) / 86_400_000);
        const q: Stored = { ...src, id: crypto.randomUUID(), kind, number: Math.max(0, ...rows.filter((r) => (r.kind ?? 'quote') === kind).map((r) => r.number)) + 1, status: 'draft', quoteDate: today, expiryDate: new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10), reference: quoteNumber(src.number, src.kind ?? 'quote'), invoiceId: null, sentAt: null, decidedAt: null, decidedBy: null, decisionNote: null, shareToken: null, shareViews: 0, createdAt: now, updatedAt: now };
        rows.push(q);
        save(rows);
        return view(q);
      }),
    convert: (id, input) =>
      wait(async () => {
        guard();
        const rows = load();
        const q = find(rows, id);
        const status = (await view(q)).status;
        if (status === 'invoiced') throw refuse(409, 'already_invoiced');
        if (status === 'declined') throw refuse(409, 'declined');
        const inv = await createDemoInvoicesApi(() => true).create({
          contactId: q.contactId,
          issueDate: input.issueDate ?? today(),
          reference: q.reference ?? quoteNumber(q.number),
          notes: q.notes,
          placeOfSupply: q.placeOfSupply,
          lines: q.lines.map((l) => ({ itemId: l.itemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discountPpm / 10_000, taxGroupId: l.taxGroupId, accountId: l.accountId, costCentreId: l.costCentreId })),
        });
        Object.assign(q, { status: 'invoiced', invoiceId: inv.id, decidedAt: new Date().toISOString() });
        save(rows);
        return { quote: await view(q), invoiceId: inv.id };
      }),
    email: (id, input) =>
      wait(async () => {
        guard();
        const p = quoteEmailSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const rows = load();
        const q = find(rows, id);
        const v = await view(q);
        if (v.status === 'declined' || v.status === 'invoiced') throw refuse(409, 'not_sendable');
        const to = p.data.email ?? v.contact.email;
        if (!to) throw refuse(400, 'no_email');
        if (q.status === 'draft') Object.assign(q, { status: 'sent', sentAt: new Date().toISOString() });
        save(rows);
        return { sentTo: to, quote: await view(q) };
      }),
    share: (id) =>
      wait(async () => {
        guard();
        const rows = load();
        const q = find(rows, id);
        if (q.status === 'declined' || q.status === 'invoiced') throw refuse(409, 'not_sendable');
        if (!q.shareToken) {
          const b = new Uint8Array(24);
          crypto.getRandomValues(b);
          q.shareToken = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          q.shareViews = 0;
          if (q.status === 'draft') Object.assign(q, { status: 'sent', sentAt: new Date().toISOString() });
          save(rows);
        }
        return view(q);
      }),
    unshare: (id) =>
      wait(async () => {
        guard();
        const rows = load();
        const q = find(rows, id);
        q.shareToken = null;
        save(rows);
        return view(q);
      }),
  };
}
