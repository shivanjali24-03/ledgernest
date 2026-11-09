import { accountCreateSchema, accountUpdateSchema, MAX_ACCOUNT_DEPTH, namedTemplate, NORMAL_SIDE, subtypeBelongsTo, type AccountSubtype, type AccountType } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoEnabledCurrencies } from '../currencies/demoCurrenciesApi';
import { heightOf, levelOf, subtreeIds } from './tree';
import type { Account, AccountsApi } from './types';

/**
 * The chart of accounts in demo mode: a realistic Indian IT-services company, stored in the browser.
 * It applies the same rules and refusal reasons as the API, so the screens behave the same in both.
 */

// v2: the sample chart has USD accounts
const KEY = 'ledgernest.demo.accounts.v2';
type Stored = Omit<Account, 'normalSide' | 'system' | 'archived' | 'childCount'>;

/** A stable UUID for a sample account, so ids pass the same validation as real ones and survive reloads. */
export function sampleId(code: string): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of code) h = BigInt.asUintN(64, (h ^ BigInt(ch.charCodeAt(0))) * 0x100000001b3n);
  const hex = h.toString(16).padStart(16, '0');
  return `a0000000-0000-4000-8${hex.slice(0, 3)}-${hex.slice(4, 16)}`;
}

function seed(): Stored[] {
  const rows: Stored[] = [];
  const add = (code: string, name: string, type: AccountType, subtype: AccountSubtype, parent?: string, extra: Partial<Stored> = {}) => {
    const parentId = parent ? rows.find((r) => r.code === parent)!.id : null;
    rows.push({ id: sampleId(code), code, name, type, subtype, description: null, parentId, systemKey: null, archivedAt: null, currency: null, ...extra });
  };
  add('1100', 'Bank accounts', 'asset', 'bank');
  add('1100.01', 'HDFC Bank current account', 'asset', 'bank', '1100');
  add('1100.02', 'ICICI Bank savings account', 'asset', 'bank', '1100');
  add('1200', 'Cash', 'asset', 'cash');
  add('1200.01', 'Petty cash – Pune office', 'asset', 'cash', '1200');
  add('1150', 'Wise USD account', 'asset', 'bank', undefined, { currency: 'USD', description: 'Receives payments from US clients.' });
  add('1300', 'Accounts receivable', 'asset', 'accounts_receivable', undefined, { description: 'Amounts clients owe us for invoices.' });
  add('1310', 'Receivables – export clients (USD)', 'asset', 'accounts_receivable', undefined, { currency: 'USD' });
  add('1400', 'GST input credit', 'asset', 'current_asset');
  add('1400.01', 'CGST input', 'asset', 'current_asset', '1400');
  add('1400.02', 'SGST input', 'asset', 'current_asset', '1400');
  add('1400.03', 'IGST input', 'asset', 'current_asset', '1400');
  add('1500', 'TDS receivable', 'asset', 'current_asset');
  add('1700', 'Fixed assets', 'asset', 'fixed_asset');
  add('1710', 'Computers and laptops', 'asset', 'fixed_asset', '1700');
  add('1720', 'Furniture and fixtures', 'asset', 'fixed_asset', '1700');
  add('1790', 'Accumulated depreciation', 'asset', 'fixed_asset', '1700');
  add('2100', 'Accounts payable', 'liability', 'accounts_payable');
  add('2200', 'GST payable', 'liability', 'tax_payable');
  add('2200.01', 'CGST output', 'liability', 'tax_payable', '2200');
  add('2200.02', 'SGST output', 'liability', 'tax_payable', '2200');
  add('2200.03', 'IGST output', 'liability', 'tax_payable', '2200');
  add('2300', 'TDS payable', 'liability', 'tax_payable');
  add('2400', 'Salaries payable', 'liability', 'current_liability');
  add('2500', 'Corporate credit card', 'liability', 'credit_card');
  add('2800', 'Term loan – HDFC Bank', 'liability', 'long_term_liability');
  add('3100', 'Share capital', 'equity', 'owner_equity');
  add('3900', 'Retained earnings', 'equity', 'retained_earnings', undefined, { systemKey: 'retained_earnings' });
  add('3990', 'Opening balance equity', 'equity', 'other_equity', undefined, { systemKey: 'opening_balance_equity' });
  add('4100', 'Software services', 'income', 'operating_income');
  add('4100.01', 'Domestic clients', 'income', 'operating_income', '4100');
  add('4100.02', 'Export clients', 'income', 'operating_income', '4100');
  add('4200', 'Annual maintenance contracts', 'income', 'operating_income');
  add('4800', 'Interest income', 'income', 'other_income');
  add('5100', 'Cloud hosting', 'expense', 'cost_of_sales');
  add('5200', 'Salaries and wages', 'expense', 'payroll');
  add('5200.01', 'Salaries', 'expense', 'payroll', '5200');
  add('5200.02', 'Provident fund contribution', 'expense', 'payroll', '5200');
  add('5300', 'Office rent', 'expense', 'operating_expense');
  add('5400', 'Internet and phone', 'expense', 'operating_expense');
  add('5500', 'Professional fees', 'expense', 'operating_expense');
  add('5600', 'Travel', 'expense', 'operating_expense');
  add('5650', 'Conference travel', 'expense', 'operating_expense', undefined, { archivedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() });
  add('5700', 'Depreciation', 'expense', 'depreciation');
  add('5900', 'Bank charges', 'expense', 'other_expense');
  return rows;
}

function load(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch {
    /* fall through to the sample chart */
  }
  return seed();
}
function save(rows: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* private mode: changes last until reload */
  }
}

/** The demo company's accounts, for other demo features (taxes check account types against them). */
export const demoAccountRows = (): readonly Pick<Stored, 'id' | 'code' | 'name' | 'type' | 'archivedAt' | 'currency'>[] => load();

/** Test helper */
export const resetDemoAccounts = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const view = (rows: Stored[]) => (r: Stored): Account => ({
  ...r,
  normalSide: NORMAL_SIDE[r.type],
  system: r.systemKey !== null,
  archived: r.archivedAt !== null,
  childCount: rows.filter((c) => c.parentId === r.id).length,
});
const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => (async () => fn())().then(resolve, reject), 150));

export function createDemoAccountsApi(canManage: () => boolean): AccountsApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['accounts.manage'] });
  };
  const find = (rows: Stored[], id: string) => {
    const a = rows.find((r) => r.id === id);
    if (!a) throw new ApiError('not_found', 404);
    return a;
  };
  const unique = (rows: Stored[], v: { code?: string; name?: string }, exceptId?: string) => {
    if (v.code && rows.some((r) => r.id !== exceptId && r.code === v.code)) throw refuse(409, 'code_taken');
    if (v.name && rows.some((r) => r.id !== exceptId && r.name.toLocaleLowerCase() === v.name!.toLocaleLowerCase())) throw refuse(409, 'name_taken');
  };
  const checkParent = (rows: Stored[], parentId: string, type: string, height: number) => {
    const p = rows.find((r) => r.id === parentId);
    if (!p) throw refuse(400, 'parent_not_found');
    if (p.archivedAt) throw refuse(409, 'parent_archived');
    if (p.type !== type) throw refuse(400, 'parent_type');
    const all = rows.map(view(rows));
    if (levelOf(all, parentId) + height > MAX_ACCOUNT_DEPTH) throw refuse(400, 'too_deep', { max: MAX_ACCOUNT_DEPTH });
  };

  return {
    list: (includeArchived) => wait(() => load().filter((r) => includeArchived || !r.archivedAt).map(view(load()))),
    create: (input) =>
      wait(() => {
        guard();
        const parsed = accountCreateSchema.safeParse(input);
        if (!parsed.success) throw new ApiError('validation', 400, undefined, undefined, { fields: parsed.error.issues });
        const a = parsed.data;
        const rows = load();
        unique(rows, a);
        if (a.parentId) checkParent(rows, a.parentId, a.type, 1);
        if (a.currency && !demoEnabledCurrencies().includes(a.currency)) throw refuse(400, 'currency_not_enabled', { field: 'currency' });
        const row: Stored = { id: crypto.randomUUID(), code: a.code, name: a.name, type: a.type, subtype: a.subtype as AccountSubtype, description: a.description, parentId: a.parentId, systemKey: null, archivedAt: null, currency: a.currency };
        rows.push(row);
        save(rows);
        return view(rows)(row);
      }),
    update: (id, input) =>
      wait(() => {
        guard();
        const parsed = accountUpdateSchema.safeParse(input);
        if (!parsed.success) throw new ApiError('validation', 400, undefined, undefined, { fields: parsed.error.issues });
        const rows = load();
        const a = find(rows, id);
        const next = { ...a, ...parsed.data } as Stored;
        const changed = (Object.keys(parsed.data) as (keyof Stored)[]).filter((k) => next[k] !== a[k]);
        if (a.systemKey && changed.some((k) => k === 'type' || k === 'subtype' || k === 'parentId')) throw refuse(400, 'system');
        if (changed.includes('type') && rows.some((r) => r.parentId === id)) throw refuse(409, 'has_children');
        if (!subtypeBelongsTo(next.type, next.subtype)) throw refuse(400, 'subtype');
        if (changed.includes('currency') && next.currency && !demoEnabledCurrencies().includes(next.currency)) throw refuse(400, 'currency_not_enabled', { field: 'currency' });
        if (next.currency && next.type !== 'asset' && next.type !== 'liability') throw refuse(400, 'currency_type', { field: 'currency' });
        unique(rows, { code: changed.includes('code') ? next.code : undefined, name: changed.includes('name') ? next.name : undefined }, id);
        if (next.parentId && (changed.includes('parentId') || changed.includes('type'))) {
          const all = rows.map(view(rows));
          if (subtreeIds(all, id).has(next.parentId)) throw refuse(400, 'cycle');
          checkParent(rows, next.parentId, next.type, heightOf(all, id));
        }
        Object.assign(a, next);
        save(rows);
        return view(rows)(a);
      }),
    archive: (id) =>
      wait(() => {
        guard();
        const rows = load();
        const a = find(rows, id);
        if (a.systemKey) throw refuse(400, 'system');
        if (rows.some((r) => r.parentId === id && !r.archivedAt)) throw refuse(409, 'has_active_children');
        a.archivedAt = new Date().toISOString();
        save(rows);
        return view(rows)(a);
      }),
    restore: (id) =>
      wait(() => {
        guard();
        const rows = load();
        const a = find(rows, id);
        if (a.parentId && rows.find((r) => r.id === a.parentId)?.archivedAt) throw refuse(409, 'parent_archived');
        a.archivedAt = null;
        save(rows);
        return view(rows)(a);
      }),
    previewTemplate: (industry) => wait(() => namedTemplate(industry, 'en-IN')),
    applyTemplate: (industry) =>
      wait(() => {
        guard();
        const rows = load();
        if (rows.some((r) => !r.systemKey)) throw refuse(409, 'chart_not_empty');
        const ids = new Map<string, string>();
        const template = namedTemplate(industry, 'en-IN');
        for (const a of template) {
          const id = crypto.randomUUID();
          ids.set(a.code, id);
          rows.push({ id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, description: null, parentId: a.parent ? ids.get(a.parent)! : null, systemKey: null, archivedAt: null, currency: null });
        }
        save(rows);
        return { industry, created: template.length };
      }),
    remove: (id) =>
      wait(() => {
        guard();
        const rows = load();
        const a = find(rows, id);
        if (a.systemKey) throw refuse(400, 'system');
        if (rows.some((r) => r.parentId === id)) throw refuse(409, 'has_children');
        save(rows.filter((r) => r.id !== id));
      }),
  };
}
