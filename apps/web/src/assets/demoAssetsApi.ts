import { assetTag, depreciationFor, fiscalYearOf, fiscalYearSpan, fixedAssetSchema, nextDay, todayIn } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoAccountRows, sampleId } from '../accounts/demoAccountsApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import type { AssetsApi, DepreciationRun, FixedAsset } from './types';

/** Fixed assets in demo mode: the same rules as the API, posted through the demo's journals. */
const KEY = 'ledgernest.demo.assets';
type Store = { assets: FixedAsset[]; runs: (DepreciationRun & { previous: Record<string, string | null> })[] };

const ref = (code: string) => {
  const a = demoAccountRows().find((x) => x.id === sampleId(code))!;
  return { id: a.id, code: a.code, name: a.name };
};
function seed(): Store {
  const yearStart = fiscalYearSpan(fiscalYearOf(todayIn('Asia/Kolkata'), 4), 4).startDate;
  return {
    assets: [
      { id: crypto.randomUUID(), name: 'Dell Latitude laptops (3)', tag: assetTag(1), description: 'For the development team', cost: 21_600_000, residual: 0, inServiceDate: yearStart, method: 'straight_line', usefulLifeMonths: 36, wdvRate: null, openingAccumulated: 0, accumulated: 0, bookValue: 21_600_000, depreciatedTo: null, status: 'active', disposedOn: null, proceeds: null, costAccount: ref('1710'), accumulatedAccount: ref('1790'), expenseAccount: ref('5700'), disposalEntry: null },
    ],
    runs: [],
  };
}
function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* fall through */
  }
  const s = seed();
  save(s);
  return s;
}
function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
export const resetDemoAssets = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const refuse = (status: 400 | 409, reason: string) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason });
const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));
const charge = (a: FixedAsset, upTo: string) => {
  const from = a.depreciatedTo ? nextDay(a.depreciatedTo) : a.inServiceDate;
  return { from, amount: from > upTo ? 0 : depreciationFor({ method: a.method, cost: a.cost, residual: a.residual, accumulated: a.accumulated, usefulLifeMonths: a.usefulLifeMonths, wdvRatePpm: a.wdvRate === null ? null : Math.round(a.wdvRate * 10_000) }, from, upTo) };
};

export function createDemoAssetsApi(canManage: () => boolean): AssetsApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['journals.post'] });
  };
  const journals = () => createDemoJournalsApi(() => true);
  const post = async (input: Parameters<ReturnType<typeof createDemoJournalsApi>['create']>[0]) => {
    const j = journals();
    const d = await j.create(input);
    return j.post(d.id).catch(async (e: unknown) => {
      await j.remove(d.id);
      throw e;
    });
  };
  return {
    list: () => wait(() => load().assets.sort((a, b) => a.status.localeCompare(b.status) || a.tag.localeCompare(b.tag))),
    create: (input) =>
      wait(() => {
        guard();
        const p = fixedAssetSchema.safeParse(input);
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const d = p.data;
        const accounts = demoAccountRows();
        const one = (id: string) => accounts.find((a) => a.id === id);
        const cost = one(d.costAccountId);
        if (!cost || cost.type !== 'asset') throw refuse(400, 'cost_account');
        if (!one(d.accumulatedAccountId) || d.accumulatedAccountId === d.costAccountId) throw refuse(400, 'accumulated_account');
        if (one(d.expenseAccountId)?.type !== 'expense') throw refuse(400, 'expense_account');
        const s = load();
        const r = (a: (typeof accounts)[number]) => ({ id: a.id, code: a.code, name: a.name });
        const asset: FixedAsset = { id: crypto.randomUUID(), name: d.name, tag: d.tag ?? assetTag(s.assets.length + 1), description: d.description, cost: d.cost, residual: d.residual, inServiceDate: d.inServiceDate, method: d.method, usefulLifeMonths: d.method === 'straight_line' ? d.usefulLifeMonths : null, wdvRate: d.method === 'wdv' ? d.wdvRate! / 10_000 : null, openingAccumulated: d.openingAccumulated, accumulated: d.openingAccumulated, bookValue: d.cost - d.openingAccumulated, depreciatedTo: d.openingTo, status: 'active', disposedOn: null, proceeds: null, costAccount: r(cost), accumulatedAccount: r(one(d.accumulatedAccountId)!), expenseAccount: r(one(d.expenseAccountId)!), disposalEntry: null };
        if (s.assets.some((a) => a.tag === asset.tag)) throw refuse(409, 'tag_taken');
        s.assets.push(asset);
        save(s);
        return asset;
      }),
    remove: (id) =>
      wait(() => {
        guard();
        const s = load();
        const a = s.assets.find((x) => x.id === id);
        if (!a) throw new ApiError('not_found', 404);
        if (a.accumulated !== a.openingAccumulated || a.status === 'disposed') throw refuse(409, 'has_depreciation');
        save({ ...s, assets: s.assets.filter((x) => x.id !== id) });
      }),
    preview: (upTo) =>
      wait(() => {
        const lines = load()
          .assets.filter((a) => a.status === 'active' && a.inServiceDate <= upTo)
          .map((a) => ({ assetId: a.id, tag: a.tag, name: a.name, to: upTo, ...charge(a, upTo) }))
          .filter((l) => l.amount > 0);
        return { upTo, lines, total: lines.reduce((s, l) => s + l.amount, 0) };
      }),
    run: (upTo) =>
      wait(async () => {
        guard();
        const s = load();
        const lines = s.assets
          .filter((a) => a.status === 'active' && a.inServiceDate <= upTo)
          .map((a) => ({ a, ...charge(a, upTo) }))
          .filter((l) => l.amount > 0);
        if (!lines.length) throw refuse(409, 'nothing_to_depreciate');
        const entry = await post({ date: upTo, memo: `Depreciation to ${upTo}`, reference: 'DEPRECIATION', lines: lines.flatMap((l) => [{ accountId: l.a.expenseAccount.id, description: `${l.a.tag} ${l.a.name}`, debit: l.amount }, { accountId: l.a.accumulatedAccount.id, description: `${l.a.tag} ${l.a.name}`, credit: l.amount }]) });
        const previous: Record<string, string | null> = {};
        for (const l of lines) {
          previous[l.a.id] = l.a.depreciatedTo;
          l.a.accumulated += l.amount;
          l.a.bookValue = l.a.cost - l.a.accumulated;
          l.a.depreciatedTo = upTo;
        }
        const run = { id: crypto.randomUUID(), upTo, total: lines.reduce((t, l) => t + l.amount, 0), journalEntry: { id: entry.id, number: entry.number }, lines: lines.map((l) => ({ asset: { id: l.a.id, tag: l.a.tag, name: l.a.name }, from: l.from, to: upTo, amount: l.amount })), previous };
        s.runs.unshift(run);
        save(s);
        return run;
      }),
    runs: () => wait(() => load().runs),
    undoRun: (id) =>
      wait(async () => {
        guard();
        const s = load();
        if (s.runs[0]?.id !== id) throw refuse(409, 'not_latest');
        const r = s.runs[0]!;
        await journals().reverse(r.journalEntry.id, { date: r.upTo, memo: `Depreciation to ${r.upTo} undone` });
        for (const l of r.lines) {
          const a = s.assets.find((x) => x.id === l.asset.id)!;
          a.accumulated -= l.amount;
          a.bookValue = a.cost - a.accumulated;
          a.depreciatedTo = r.previous[a.id] ?? null;
        }
        s.runs.shift();
        save(s);
      }),
    dispose: (id, input) =>
      wait(async () => {
        guard();
        const s = load();
        const a = s.assets.find((x) => x.id === id);
        if (!a) throw new ApiError('not_found', 404);
        if (a.status === 'disposed') throw refuse(409, 'disposed');
        if (a.depreciatedTo && input.date < a.depreciatedTo) throw refuse(400, 'before_depreciated');
        const c = charge(a, input.date).amount;
        const accumulated = a.accumulated + c;
        const result = input.proceeds - (a.cost - accumulated);
        const memo = `Disposal of ${a.tag} ${a.name}`;
        const entry = await post({
          date: input.date,
          memo,
          reference: a.tag,
          lines: [
            ...(c ? [{ accountId: a.expenseAccount.id, description: memo, debit: c }] : []),
            ...(a.accumulated ? [{ accountId: a.accumulatedAccount.id, description: memo, debit: a.accumulated }] : []),
            ...(input.proceeds ? [{ accountId: input.bankAccountId!, description: memo, debit: input.proceeds }] : []),
            { accountId: a.costAccount.id, description: memo, credit: a.cost },
            ...(result ? [{ accountId: input.gainLossAccountId, description: result > 0 ? 'Gain on disposal' : 'Loss on disposal', ...(result > 0 ? { credit: result } : { debit: -result }) }] : []),
          ],
        });
        Object.assign(a, { status: 'disposed', disposedOn: input.date, proceeds: input.proceeds, accumulated, bookValue: 0, depreciatedTo: input.date, disposalEntry: { id: entry.id, number: entry.number } });
        save(s);
        return a;
      }),
    schedule: (from, to) =>
      wait(() => {
        const s = load();
        const rows = s.assets
          .filter((a) => a.inServiceDate <= to && (!a.disposedOn || a.disposedOn >= from))
          .map((a) => {
            const lines = s.runs.flatMap((r) => r.lines.filter((l) => l.asset.id === a.id));
            const before = a.openingAccumulated + lines.filter((l) => l.to < from).reduce((t, l) => t + l.amount, 0);
            const charged = lines.filter((l) => l.to >= from && l.to <= to).reduce((t, l) => t + l.amount, 0);
            const disposed = !!a.disposedOn && a.disposedOn <= to;
            const atDisposal = disposed ? a.accumulated - a.openingAccumulated - lines.reduce((t, l) => t + l.amount, 0) : 0;
            const openingCost = a.inServiceDate < from ? a.cost : 0;
            const openingDepreciation = a.inServiceDate < from ? before : 0;
            const depreciation = charged + atDisposal;
            const additions = a.inServiceDate >= from ? a.cost : 0;
            const disposals = disposed ? a.cost : 0;
            const depreciationOnDisposals = disposed ? openingDepreciation + depreciation : 0;
            const closingCost = openingCost + additions - disposals;
            const closingDepreciation = openingDepreciation + depreciation - depreciationOnDisposals;
            return { assetId: a.id, tag: a.tag, name: a.name, openingCost, additions, disposals, closingCost, openingDepreciation, depreciation, depreciationOnDisposals, closingDepreciation, closingBookValue: closingCost - closingDepreciation };
          });
        const keys = ['openingCost', 'additions', 'disposals', 'closingCost', 'openingDepreciation', 'depreciation', 'depreciationOnDisposals', 'closingDepreciation', 'closingBookValue'] as const;
        return { from, to, rows, totals: Object.fromEntries(keys.map((k) => [k, rows.reduce((t, r) => t + r[k], 0)])) as Record<(typeof keys)[number], number> };
      }),
  };
}
