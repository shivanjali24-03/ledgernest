import { nextOccurrence, recurringBillSchema, todayIn, type RecurringStatus } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { createDemoBillsApi, demoStoredBillViews } from '../bills/demoBillsApi';
import { demoContactRows } from '../contacts/demoContactsApi';
import type { RecurringBillSchedule, RecurringBillsApi } from './types';

const KEY = 'ledgernest.demo.recurringBills';
type Stored = Omit<RecurringBillSchedule, 'contact' | 'currency' | 'bills'> & { contactId: string; billIds: string[] };

const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));
const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
function load(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored[]) : [];
  } catch {
    return [];
  }
}
function save(rows: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* private mode */
  }
}
export const resetDemoRecurringBills = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

function view(s: Stored): RecurringBillSchedule {
  const contact = demoContactRows().find((c) => c.id === s.contactId);
  const bills = demoStoredBillViews().filter((b) => s.billIds.includes(b.id));
  const { contactId: _c, billIds: _b, ...rest } = s;
  return { ...rest, contact: { id: s.contactId, name: contact?.name ?? '' }, currency: contact?.currency ?? null, bills: bills.sort((a, b) => b.billDate.localeCompare(a.billDate)).slice(0, 12).map((b) => ({ id: b.id, number: b.number, status: b.status, billDate: b.billDate, total: b.total })) };
}

/** Bill schedules in demo mode: the same rules as the API, making bills through the demo's bills */
export function createDemoRecurringBillsApi(canManage: () => boolean): RecurringBillsApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['bills.manage'] });
  };
  const parse = (input: unknown) => {
    const p = recurringBillSchema.safeParse(input);
    if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
    const vendor = demoContactRows().find((c) => c.id === p.data.contactId);
    if (!vendor) throw refuse(400, 'contact_not_found');
    if (!vendor.isVendor) throw refuse(400, 'not_vendor');
    return p.data;
  };
  const shape = (d: ReturnType<typeof parse>, count: number) => {
    const next = nextOccurrence(d, count);
    return { name: d.name, contactId: d.contactId, frequency: d.frequency, interval: d.interval, startDate: d.startDate, endDate: d.endDate, maxCount: d.maxCount, autoRecord: d.autoRecord, notes: d.notes, placeOfSupply: d.placeOfSupply, lines: d.lines.map((l) => ({ ...l, discount: l.discount / 10_000 })), nextDate: next };
  };
  return {
    list: () => wait(() => load().map(view)),
    create: (input) =>
      wait(() => {
        guard();
        const d = parse(input);
        const s: Stored = { id: crypto.randomUUID(), ...shape(d, 0), count: 0, status: (nextOccurrence(d, 0) ? 'active' : 'ended') as RecurringStatus, lastRunAt: null, lastError: null, billIds: [] };
        save([...load(), s]);
        return view(s);
      }),
    update: (id, input) =>
      wait(() => {
        guard();
        const rows = load();
        const s = rows.find((x) => x.id === id);
        if (!s) throw new ApiError('not_found', 404);
        const d = parse(input);
        if (s.count > 0 && d.startDate !== s.startDate) throw refuse(409, 'has_bills');
        Object.assign(s, shape(d, s.count), { lastError: null });
        s.status = !s.nextDate ? 'ended' : s.status === 'ended' ? 'active' : s.status;
        save(rows);
        return view(s);
      }),
    setPaused: (id, paused) =>
      wait(() => {
        guard();
        const rows = load();
        const s = rows.find((x) => x.id === id);
        if (!s) throw new ApiError('not_found', 404);
        if (s.status === 'ended') throw refuse(409, 'ended');
        s.status = paused ? 'paused' : 'active';
        save(rows);
        return view(s);
      }),
    remove: (id) =>
      wait(() => {
        guard();
        const rows = load();
        const s = rows.find((x) => x.id === id);
        if (!s) throw new ApiError('not_found', 404);
        if (s.count > 0) throw refuse(409, 'has_bills');
        save(rows.filter((x) => x.id !== id));
      }),
    run: () =>
      wait(async () => {
        guard();
        const today = todayIn('Asia/Kolkata');
        const bills = createDemoBillsApi(() => true);
        const made: { scheduleId: string; billId: string; date: string; recorded: boolean }[] = [];
        const failed: { scheduleId: string; date: string; reason: string }[] = [];
        const rows = load();
        for (const s of rows) {
          for (let guardN = 0; guardN < 400 && s.status === 'active' && s.nextDate && s.nextDate <= today; guardN++) {
            const date = s.nextDate;
            try {
              let b = await bills.create({ contactId: s.contactId, billDate: date, notes: s.notes, placeOfSupply: s.placeOfSupply, lines: s.lines });
              if (s.autoRecord) {
                try {
                  b = await bills.record(b.id);
                } catch (e) {
                  s.lastError = e instanceof Error ? e.message : String(e);
                }
              }
              s.billIds.push(b.id);
              s.count += 1;
              s.nextDate = nextOccurrence(s, s.count);
              if (!s.nextDate) s.status = 'ended';
              s.lastRunAt = new Date().toISOString();
              made.push({ scheduleId: s.id, billId: b.id, date, recorded: b.status === 'open' });
            } catch (e) {
              s.lastError = e instanceof Error ? e.message : String(e);
              failed.push({ scheduleId: s.id, date, reason: s.lastError });
              break;
            }
          }
        }
        save(rows);
        return { made, failed };
      }),
  };
}
