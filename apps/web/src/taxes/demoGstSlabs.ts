import { formatRate, percentToPpm, type GstSlabCreateInput, type GstSlabUpdateInput } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import type { GstSlab, GstSlabsApi } from './types';

/**
 * India's GST slabs in demo mode, seeded like the real database: GST 2.0 (22 September 2025) kept 0%, 0.25%,
 * 3%, 5% and 18% and added 40%; 12% and 28% were retired and stay for older entries.
 * Shared by the Super Admin page and the demo company's taxes.
 */
const KEY = 'ledgernest.demo.gstSlabs';
export type StoredSlab = Omit<GstSlab, 'rate' | 'usage'>;

const id = (n: number) => `65700000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SEED: StoredSlab[] = [
  { id: id(1), ratePpm: 0, label: 'Nil rated', description: 'Essentials such as fresh produce, milk, education and healthcare services', effectiveFrom: '2017-07-01', effectiveTo: null },
  { id: id(2), ratePpm: 2_500, label: 'Rough diamonds', description: 'Rough precious and semi-precious stones', effectiveFrom: '2017-07-01', effectiveTo: null },
  { id: id(3), ratePpm: 30_000, label: 'Gold and jewellery', description: 'Gold, silver, jewellery and precious metals', effectiveFrom: '2017-07-01', effectiveTo: null },
  { id: id(4), ratePpm: 50_000, label: 'Merit rate', description: 'Everyday goods and services', effectiveFrom: '2017-07-01', effectiveTo: null },
  { id: id(5), ratePpm: 180_000, label: 'Standard rate', description: 'Most goods and services', effectiveFrom: '2017-07-01', effectiveTo: null },
  { id: id(6), ratePpm: 400_000, label: 'Demerit rate', description: 'Luxury and sin goods such as tobacco, pan masala, aerated drinks and luxury cars', effectiveFrom: '2025-09-22', effectiveTo: null },
  { id: id(7), ratePpm: 120_000, label: 'Former 12% rate', description: 'Retired by GST 2.0; for entries dated before 22 September 2025', effectiveFrom: '2017-07-01', effectiveTo: '2025-09-21' },
  { id: id(8), ratePpm: 280_000, label: 'Former 28% rate', description: 'Retired by GST 2.0; for entries dated before 22 September 2025', effectiveFrom: '2017-07-01', effectiveTo: '2025-09-21' },
];

export function loadSlabs(): StoredSlab[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as StoredSlab[];
  } catch {
    /* fall through */
  }
  return SEED.map((s) => ({ ...s }));
}
function save(rows: StoredSlab[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* private mode */
  }
}
export const resetDemoGstSlabs = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

export const slabView = (s: StoredSlab, usage: number): GstSlab => ({ ...s, rate: formatRate(s.ratePpm), usage });
const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => (async () => fn())().then(resolve, reject), 150));

const overlaps = (a: { effectiveFrom: string; effectiveTo: string | null }, b: { effectiveFrom: string; effectiveTo: string | null }) =>
  (a.effectiveTo === null || a.effectiveTo >= b.effectiveFrom) && (b.effectiveTo === null || b.effectiveTo >= a.effectiveFrom);

/** The Super Admin's slab list in demo mode; `usage` counts the demo company's groups. */
export function createDemoGstSlabsApi(canManage: () => boolean, usage: (slabId: string) => number): GstSlabsApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['platform.settings.manage'] });
  };
  const clash = (rows: StoredSlab[], s: StoredSlab) => {
    const other = rows.find((r) => r.id !== s.id && r.ratePpm === s.ratePpm && overlaps(r, s));
    if (other) throw refuse(409, 'overlap', { slabId: other.id });
  };
  return {
    list: () =>
      wait(() => {
        guard();
        return loadSlabs()
          .sort((a, b) => a.ratePpm - b.ratePpm || b.effectiveFrom.localeCompare(a.effectiveFrom))
          .map((s) => slabView(s, usage(s.id)));
      }),
    create: (input: GstSlabCreateInput) =>
      wait(() => {
        guard();
        const ppm = percentToPpm(input.rate);
        if (ppm === null || ppm % 2) throw refuse(400, 'invalid');
        const rows = loadSlabs();
        const s: StoredSlab = { id: crypto.randomUUID(), ratePpm: ppm, label: input.label.trim(), description: input.description?.trim() || null, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null };
        clash(rows, s);
        rows.push(s);
        save(rows);
        return slabView(s, 0);
      }),
    update: (slabId: string, patch: GstSlabUpdateInput) =>
      wait(() => {
        guard();
        const rows = loadSlabs();
        const s = rows.find((r) => r.id === slabId);
        if (!s) throw new ApiError('not_found', 404);
        const next = { ...s, ...patch, description: patch.description === undefined ? s.description : patch.description?.trim() || null };
        if (next.effectiveTo && next.effectiveTo < next.effectiveFrom) throw refuse(400, 'dates');
        clash(rows, next);
        Object.assign(s, next);
        save(rows);
        return slabView(s, usage(s.id));
      }),
    remove: (slabId: string) =>
      wait(() => {
        guard();
        const rows = loadSlabs();
        if (!rows.some((r) => r.id === slabId)) throw new ApiError('not_found', 404);
        if (usage(slabId)) throw refuse(409, 'in_use', { usage: usage(slabId) });
        save(rows.filter((r) => r.id !== slabId));
      }),
  };
}
