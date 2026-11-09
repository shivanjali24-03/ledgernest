import { invoiceAmounts, nextOccurrence, recurringSchema, todayIn, type RecurringFrequency } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoContactRows } from '../contacts/demoContactsApi';
import { createDemoInvoicesApi, demoInvoiceViews } from '../invoices/demoInvoicesApi';
import { demoTaxState } from '../taxes/demoTaxesApi';
import type { RecurringApi, RecurringSchedule, UpcomingInvoice } from './types';

/** Recurring schedules in demo mode: the same rules as the API, raising invoices through the demo's invoices. */
const KEY = 'ledgernest.demo.recurring';
type Stored = Omit<RecurringSchedule, 'invoices' | 'contact' | 'currency'> & { contactId: string; invoiceIds: string[] };

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
export const resetDemoRecurring = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));
const today = () => todayIn('Asia/Kolkata');
const sched = (s: Stored) => ({ startDate: s.startDate, frequency: s.frequency as RecurringFrequency, interval: s.interval, endDate: s.endDate, maxCount: s.maxCount });

async function view(s: Stored): Promise<RecurringSchedule> {
  const contact = demoContactRows().find((c) => c.id === s.contactId)!;
  const invoices = (await demoInvoiceViews()).filter((i) => s.invoiceIds.includes(i.id)).sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const { contactId: _c, invoiceIds: _i, ...rest } = s;
  return { ...rest, contact: { id: contact.id, name: contact.name }, currency: contact.currency, invoices: invoices.slice(0, 12).map((i) => ({ id: i.id, number: i.number, status: i.status, issueDate: i.issueDate, total: i.total })) };
}

export function createDemoRecurringApi(canManage: () => boolean): RecurringApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['invoices.manage'] });
  };
  const find = (rows: Stored[], id: string) => {
    const s = rows.find((r) => r.id === id);
    if (!s) throw new ApiError('not_found', 404);
    return s;
  };
  const parse = (input: unknown) => {
    const p = recurringSchema.safeParse(input);
    if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
    const c = demoContactRows().find((x) => x.id === p.data.contactId);
    if (!c) throw refuse(400, 'contact_not_found');
    if (!c.isCustomer) throw refuse(400, 'not_customer');
    if (c.archived) throw refuse(400, 'contact_archived');
    const d = p.data;
    // Kept as a schedule takes them back: discount as a percentage
    return { name: d.name, contactId: d.contactId, frequency: d.frequency, interval: d.interval, startDate: d.startDate, endDate: d.endDate, maxCount: d.maxCount, autoIssue: d.autoIssue, reference: d.reference, notes: d.notes, placeOfSupply: d.placeOfSupply, lines: d.lines.map((l) => ({ ...l, discount: l.discount / 10_000 })) };
  };
  return {
    list: () =>
      wait(async () => {
        const order = { active: 0, paused: 1, ended: 2 } as const;
        const rows = load().sort((a, b) => order[a.status] - order[b.status] || (a.nextDate ?? '9').localeCompare(b.nextDate ?? '9') || a.name.localeCompare(b.name));
        return Promise.all(rows.map(view));
      }),
    upcoming: (days) =>
      wait(() => {
        const until = new Date(Date.parse(`${today()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
        const tax = demoTaxState();
        const out: UpcomingInvoice[] = [];
        for (const s of load().filter((x) => x.status === 'active')) {
          const contact = demoContactRows().find((c) => c.id === s.contactId)!;
          const total = invoiceAmounts(s.lines.map((l) => ({ quantity: String(l.quantity), unitPrice: l.unitPrice, discountPpm: Math.round(l.discount * 10_000), rates: (tax.groups.find((g) => g.id === l.taxGroupId)?.rateIds ?? []).map((rid) => ({ rateId: rid, ratePpm: tax.rates.find((r) => r.id === rid)!.ratePpm })) }))).total;
          for (let n = s.count; ; n++) {
            const date = nextOccurrence(sched(s), n);
            if (!date || date > until || out.length > 500) break;
            out.push({ scheduleId: s.id, name: s.name, contact: { id: contact.id, name: contact.name }, currency: contact.currency, date, total, autoIssue: s.autoIssue, overdue: date < today() });
          }
        }
        return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
      }),
    create: (input) =>
      wait(async () => {
        guard();
        const d = parse(input);
        const next = nextOccurrence(d, 0);
        const s: Stored = { id: crypto.randomUUID(), ...d, count: 0, nextDate: next, status: next ? 'active' : 'ended', lastRunAt: null, lastError: null, invoiceIds: [] };
        save([...load(), s]);
        return view(s);
      }),
    update: (id, input) =>
      wait(async () => {
        guard();
        const rows = load();
        const s = find(rows, id);
        const d = parse(input);
        if (s.count > 0 && d.startDate !== s.startDate) throw refuse(409, 'has_invoices');
        const next = nextOccurrence(d, s.count);
        Object.assign(s, d, { nextDate: next, status: !next ? 'ended' : s.status === 'ended' ? 'active' : s.status, lastError: null });
        save(rows);
        return view(s);
      }),
    setPaused: (id, paused) =>
      wait(async () => {
        guard();
        const rows = load();
        const s = find(rows, id);
        if (s.status === 'ended') throw refuse(409, 'ended');
        s.status = paused ? 'paused' : 'active';
        save(rows);
        return view(s);
      }),
    remove: (id) =>
      wait(() => {
        guard();
        const rows = load();
        if (find(rows, id).count > 0) throw refuse(409, 'has_invoices');
        save(rows.filter((r) => r.id !== id));
      }),
    run: () =>
      wait(async () => {
        guard();
        const invoices = createDemoInvoicesApi(() => true);
        const raised: { scheduleId: string; invoiceId: string; date: string; issued: boolean }[] = [];
        const failed: { scheduleId: string; date: string; reason: string }[] = [];
        for (const s of load().filter((x) => x.status === 'active' && x.nextDate && x.nextDate <= today())) {
          while (s.status === 'active' && s.nextDate && s.nextDate <= today()) {
            const date = s.nextDate;
            try {
              const draft = await invoices.create({ contactId: s.contactId, issueDate: date, reference: s.reference, notes: s.notes, placeOfSupply: s.placeOfSupply, lines: s.lines });
              const inv = s.autoIssue ? await invoices.issue(draft.id).catch(() => draft) : draft;
              s.count += 1;
              s.nextDate = nextOccurrence(sched(s), s.count);
              s.status = s.nextDate ? 'active' : 'ended';
              s.lastError = s.autoIssue && inv.status !== 'issued' ? 'Raised, but it could not be issued.' : null;
              s.lastRunAt = new Date().toISOString();
              s.invoiceIds.push(inv.id);
              raised.push({ scheduleId: s.id, invoiceId: inv.id, date, issued: inv.status === 'issued' });
            } catch (e) {
              s.lastError = e instanceof Error ? e.message : String(e);
              failed.push({ scheduleId: s.id, date, reason: s.lastError });
              break;
            }
            // Save after each one, so a later failure keeps what was raised
            save(load().map((r) => (r.id === s.id ? s : r)));
          }
          save(load().map((r) => (r.id === s.id ? s : r)));
        }
        return { raised, failed };
      }),
  };
}
