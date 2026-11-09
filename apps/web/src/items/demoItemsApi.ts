import { formatRate, itemCreateSchema, itemUpdateSchema, type ItemKind } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoAccountRows, sampleId } from '../accounts/demoAccountsApi';
import { demoTaxState } from '../taxes/demoTaxesApi';
import type { Item, ItemsApi } from './types';

/** The sample software firm's products and services. */
const KEY = 'ledgernest.demo.items';
type Stored = Omit<Item, 'taxGroup' | 'incomeAccount' | 'expenseAccount'>;
const id = (n: number) => `17e00000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function seed(): Stored[] {
  const gst18 = demoTaxState().groups.find((g) => g.name === 'GST 18%')?.id ?? null;
  const i = (n: number, v: Partial<Stored> & Pick<Stored, 'name' | 'kind'>): Stored => ({ id: id(n), sku: null, description: null, unit: null, salePrice: null, purchasePrice: null, taxGroupId: gst18, hsnSac: null, incomeAccountId: null, expenseAccountId: null, archived: false, ...v });
  return [
    i(1, { name: 'Software development', kind: 'service', sku: 'DEV-HR', unit: 'hrs', salePrice: 250_000, hsnSac: '998314', incomeAccountId: sampleId('4100.01'), description: 'Design, build and test, billed by the hour.' }),
    i(2, { name: 'Annual maintenance contract', kind: 'service', sku: 'AMC-12', unit: 'year', salePrice: 12_000_000, hsnSac: '998313', incomeAccountId: sampleId('4200') }),
    i(3, { name: 'Managed cloud hosting', kind: 'service', sku: 'HOST-M', unit: 'month', salePrice: 1_500_000, purchasePrice: 900_000, hsnSac: '998315', incomeAccountId: sampleId('4100.01'), expenseAccountId: sampleId('5100') }),
    i(4, { name: 'Laptop – Dell Latitude 5440', kind: 'goods', sku: 'LAP-5440', unit: 'nos', salePrice: 8_500_000, purchasePrice: 7_200_000, hsnSac: '84713010', expenseAccountId: sampleId('1710') }),
    i(5, { name: 'Printer paper A4 (ream)', kind: 'goods', sku: 'PAP-A4', unit: 'ream', purchasePrice: 28_000, hsnSac: '4802', expenseAccountId: sampleId('5900') }),
  ];
}
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
export const resetDemoItems = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};
/** The demo's items, for invoices and bills */
export const demoItemRows = (): Item[] => load().map(view);

function view(i: Stored): Item {
  const tax = demoTaxState();
  const g = i.taxGroupId ? tax.groups.find((x) => x.id === i.taxGroupId) : undefined;
  const accounts = demoAccountRows();
  const ref = (aid: string | null) => {
    const a = aid ? accounts.find((x) => x.id === aid) : undefined;
    return a ? { id: a.id, code: a.code, name: a.name } : null;
  };
  return {
    ...i,
    taxGroup: g ? { id: g.id, name: g.name, total: formatRate(g.rateIds.reduce((s, rid) => s + (tax.rates.find((r) => r.id === rid)?.ratePpm ?? 0), 0)) } : null,
    incomeAccount: ref(i.incomeAccountId),
    expenseAccount: ref(i.expenseAccountId),
  };
}

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));

export function createDemoItemsApi(canManage: () => boolean): ItemsApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['invoices.manage'] });
  };
  const find = (rows: Stored[], iid: string) => {
    const i = rows.find((r) => r.id === iid);
    if (!i) throw new ApiError('not_found', 404);
    return i;
  };
  /** The same checks as the API */
  const check = (rows: Stored[], v: Omit<Stored, 'id' | 'archived'>, exceptId?: string) => {
    if (rows.some((r) => r.id !== exceptId && r.name.toLocaleLowerCase() === v.name.toLocaleLowerCase())) throw refuse(409, 'name_taken', { field: 'name' });
    if (v.sku && rows.some((r) => r.id !== exceptId && r.sku === v.sku)) throw refuse(409, 'sku_taken', { field: 'sku' });
    const accounts = demoAccountRows();
    const type = (aid: string | null) => (aid ? accounts.find((a) => a.id === aid)?.type : undefined);
    if (v.incomeAccountId && type(v.incomeAccountId) !== 'income') throw refuse(400, 'income_account_type', { field: 'incomeAccountId' });
    if (v.expenseAccountId && !['expense', 'asset'].includes(type(v.expenseAccountId) ?? '')) throw refuse(400, 'expense_account_type', { field: 'expenseAccountId' });
  };
  return {
    list: (q) =>
      wait(() => {
        const s = q.search?.trim().toLowerCase();
        return load()
          .filter((i) => !!q.archived === i.archived && (!q.kind || i.kind === q.kind))
          .filter((i) => !s || i.name.toLowerCase().includes(s) || i.sku?.toLowerCase().includes(s) || i.hsnSac?.startsWith(s))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(view);
      }),
    create: (input) =>
      wait(() => {
        guard();
        const p = itemCreateSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const rows = load();
        check(rows, p.data);
        const i: Stored = { id: crypto.randomUUID(), ...p.data, kind: p.data.kind as ItemKind, archived: false };
        rows.push(i);
        save(rows);
        return view(i);
      }),
    update: (iid, input) =>
      wait(() => {
        guard();
        const p = itemUpdateSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const rows = load();
        const i = find(rows, iid);
        const next = { ...i, ...p.data };
        check(rows, next, iid);
        Object.assign(i, next);
        save(rows);
        return view(i);
      }),
    archive: (iid, archive) =>
      wait(() => {
        guard();
        const rows = load();
        const i = find(rows, iid);
        if (archive === i.archived) throw refuse(409, archive ? 'already_archived' : 'not_archived');
        i.archived = archive;
        save(rows);
        return view(i);
      }),
    remove: (iid) =>
      wait(() => {
        guard();
        const rows = load();
        find(rows, iid);
        save(rows.filter((r) => r.id !== iid));
      }),
  };
}
