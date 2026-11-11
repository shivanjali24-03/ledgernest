import { DEFAULT_SERIES, formatDocNumber, NUMBERED_DOCUMENTS, numberSeriesSchema, numberSeriesUpdateSchema, seriesPreview, seriesProblems, fiscalYearName, fiscalYearOf, todayIn, type NumberSeries, type NumberedDocument } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import type { NumberingApi } from './types';

/** The demo company's number series, kept in the browser: the three LedgerNest starts with, until changed */
const KEY = 'ledgernest.demo.numberSeries';
type Stored = Omit<NumberSeries, 'preview' | 'used'>;
const seed = (): Stored[] =>
  NUMBERED_DOCUMENTS.map((type, n) => ({ id: `5e000000-0000-4000-8000-00000000000${n + 1}`, type, ...DEFAULT_SERIES[type], startNumber: 1, resetYearly: true, isDefault: true, archived: false }));
function load(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch {
    /* fall through */
  }
  return seed();
}
function save(rows: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* private mode */
  }
}
export const resetDemoNumbering = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};
const yearName = () => fiscalYearName(fiscalYearOf(todayIn('Asia/Kolkata'), 4), 4);

/** How the demo numbers a document when it's issued: its chosen series, or the type's default */
export function demoDocNumber(type: NumberedDocument, seriesId: string | null | undefined, fiscalYear: string, serial: number) {
  const rows = load().filter((s) => s.type === type);
  const s = rows.find((r) => r.id === seriesId && !r.archived) ?? rows.find((r) => r.isDefault) ?? { ...DEFAULT_SERIES[type] };
  return formatDocNumber(s, fiscalYear, serial);
}
/** The demo's invoice series still in use, for the invoice form */
export const demoInvoiceSeries = () => load().filter((s) => s.type === 'invoice' && !s.archived);

const refuse = (status: 400 | 409, reason: string, field?: string) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...(field ? { field } : {}) });
const wait = <T>(fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 120));

export function createDemoNumberingApi(canManage: () => boolean): NumberingApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['org.settings.manage'] });
  };
  const view = (s: Stored): NumberSeries => ({ ...s, preview: seriesPreview(s, yearName()), used: 0 });
  const check = (s: Pick<Stored, 'prefix' | 'suffix' | 'digits' | 'startNumber'>) => {
    const p = seriesProblems(s, yearName());
    if (p.includes('too_long')) throw refuse(400, 'too_long', 'prefix');
    if (p.includes('no_room')) throw refuse(400, 'no_room', 'startNumber');
  };
  return {
    list: () => wait(() => ({ yearName: yearName(), items: load().map(view) })),
    create: (input) =>
      wait(() => {
        guard();
        const v = numberSeriesSchema.parse(input);
        check(v);
        const rows = load();
        if (rows.some((r) => r.type === v.type && r.name.toLowerCase() === v.name.toLowerCase())) throw refuse(409, 'name_taken', 'name');
        if (v.isDefault) rows.forEach((r) => r.type === v.type && (r.isDefault = false));
        const s: Stored = { id: crypto.randomUUID(), ...v, archived: false };
        rows.push(s);
        save(rows);
        return view(s);
      }),
    update: (id, patch) =>
      wait(() => {
        guard();
        const p = numberSeriesUpdateSchema.parse(patch);
        const rows = load();
        const s = rows.find((r) => r.id === id);
        if (!s) throw new ApiError('not_found', 404);
        const next = { ...s, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as Stored;
        check(next);
        if (s.isDefault && (!next.isDefault || next.archived)) throw refuse(409, 'default_needed');
        if (rows.some((r) => r.id !== id && r.type === s.type && r.name.toLowerCase() === next.name.toLowerCase())) throw refuse(409, 'name_taken', 'name');
        if (next.isDefault && !s.isDefault) rows.forEach((r) => r.type === s.type && (r.isDefault = false));
        Object.assign(s, next);
        save(rows);
        return view(s);
      }),
    remove: (id) =>
      wait(() => {
        guard();
        const rows = load();
        const s = rows.find((r) => r.id === id);
        if (!s) throw new ApiError('not_found', 404);
        if (s.isDefault) throw refuse(409, 'default_needed');
        save(rows.filter((r) => r.id !== id));
      }),
  };
}
