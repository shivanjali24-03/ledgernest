import { costCentreSchema } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoJournalLinesTagged } from '../journals/demoJournalsApi';
import type { CostCentre, CostCentresApi } from './types';

/** Cost centres in demo mode for the sample company, kept in this browser. */
const KEY = 'ledgernest.demo.costCentres';
type Stored = Omit<CostCentre, 'lines'>;

const seed = (): Stored[] => [
  { id: 'c0000000-0000-4000-8000-000000000001', code: 'PUNE', name: 'Pune office', kind: 'department', description: 'Head office and operations', archived: false },
  { id: 'c0000000-0000-4000-8000-000000000002', code: 'MUM', name: 'Mumbai branch', kind: 'department', description: null, archived: false },
  { id: 'c0000000-0000-4000-8000-000000000003', code: 'PRJ-WAREHOUSE', name: 'Warehouse fit-out', kind: 'project', description: 'Bhiwandi warehouse, 2026', archived: false },
];
function load(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch {
    /* fall through */
  }
  const s = seed();
  save(s);
  return s;
}
function save(s: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
export const resetDemoCostCentres = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};
/** The demo's cost centres, for the demo journals and reports */
export const demoCostCentreRows = (): readonly Stored[] => load();

const countLines = (id: string) => demoJournalLinesTagged(id);

const refuse = (status: 400 | 404 | 409, reason: string) => new ApiError(status === 400 ? 'validation' : status === 404 ? 'not_found' : 'conflict', status, undefined, undefined, { reason });
const wait = <T>(fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 100));

export function createDemoCostCentresApi(canManage: () => boolean): CostCentresApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['accounts.manage'] });
  };
  const parse = (input: unknown) => {
    const p = costCentreSchema.safeParse(input);
    if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
    return p.data;
  };
  const find = (id: string) => {
    const c = load().find((x) => x.id === id);
    if (!c) throw refuse(404, 'not_found');
    return c;
  };
  const put = (c: Stored) => save(load().map((x) => (x.id === c.id ? c : x)));
  return {
    list: (includeArchived) =>
      wait(() =>
        load()
          .filter((c) => includeArchived || !c.archived)
          .sort((a, b) => Number(a.archived) - Number(b.archived) || a.code.localeCompare(b.code))
          .map((c) => ({ ...c, lines: countLines(c.id) })),
      ),
    create: (input) =>
      wait(() => {
        guard();
        const d = parse(input);
        if (load().some((c) => c.code === d.code)) throw refuse(409, 'code_taken');
        const c: Stored = { id: crypto.randomUUID(), ...d, archived: false };
        save([...load(), c]);
        return c;
      }),
    update: (id, input) =>
      wait(() => {
        guard();
        const d = parse(input);
        const c = find(id);
        if (load().some((x) => x.code === d.code && x.id !== id)) throw refuse(409, 'code_taken');
        const next = { ...c, ...d };
        put(next);
        return next;
      }),
    archive: (id, archived) =>
      wait(() => {
        guard();
        const next = { ...find(id), archived };
        put(next);
        return next;
      }),
    remove: (id) =>
      wait(() => {
        guard();
        find(id);
        if (countLines(id)) throw refuse(409, 'in_use');
        save(load().filter((c) => c.id !== id));
      }),
  };
}
