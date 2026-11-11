import { findIndianState, formatRate, percentToPpm, slabInForce, todayIn, type TaxGroupCreateInput, type TaxKind, type TaxRateCreateInput, type TaxRateUpdateInput } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { demoAccountRows, sampleId } from '../accounts/demoAccountsApi';
import { loadSlabs, slabView, type StoredSlab } from './demoGstSlabs';
import type { GstSetupResult, TaxGroup, TaxRate, TaxesApi, TaxesResponse } from './types';

/**
 * Taxes in demo mode. The sample company is in Pune, Maharashtra, so GST is already set up from the slabs in
 * force: CGST + SGST within the state, IGST between states, posting to its 1400 and 2200 GST accounts.
 */
const KEY = 'ledgernest.demo.taxes';
const REGION = 'Maharashtra';
type StoredRate = { id: string; name: string; kind: TaxKind; ratePpm: number; outputAccountId: string; inputAccountId: string | null; archivedAt: string | null };
type StoredGroup = { id: string; name: string; gstSlabId: string | null; supply: 'intra' | 'inter' | null; archivedAt: string | null; rateIds: string[] };
type State = { rates: StoredRate[]; groups: StoredGroup[] };

const ACCOUNTS: Record<'cgst' | 'sgst' | 'igst', { input: string; output: string }> = {
  cgst: { input: '1400.01', output: '2200.01' },
  sgst: { input: '1400.02', output: '2200.02' },
  igst: { input: '1400.03', output: '2200.03' },
};
const today = () => todayIn('Asia/Kolkata');
/** Within the state (CGST + SGST) before between states (IGST), then groups of the organisation's own */
const supplyOrder = (s: string | null) => (s === 'intra' ? 0 : s === 'inter' ? 1 : 2);

/** The same steps as the API's GST setup: reuse a rate of the same tax and percentage, add the groups that are missing. */
function setUp(s: State, slabs: StoredSlab[]) {
  const created = { rates: [] as string[], groups: [] as string[] };
  const rateId = (kind: 'cgst' | 'sgst' | 'igst', ppm: number) => {
    const existing = s.rates.find((r) => r.kind === kind && r.ratePpm === ppm && !r.archivedAt);
    if (existing) return existing.id;
    const name = `${kind.toUpperCase()} ${formatRate(ppm)}`;
    s.rates.push({ id: crypto.randomUUID(), name, kind, ratePpm: ppm, outputAccountId: sampleId(ACCOUNTS[kind].output), inputAccountId: sampleId(ACCOUNTS[kind].input), archivedAt: null });
    created.rates.push(name);
    return s.rates[s.rates.length - 1]!.id;
  };
  for (const slab of [...slabs].sort((a, b) => a.ratePpm - b.ratePpm)) {
    const retired = slab.effectiveTo !== null && slab.effectiveTo < today();
    for (const supply of ['intra', 'inter'] as const) {
      if (s.groups.some((g) => g.gstSlabId === slab.id && g.supply === supply)) continue;
      const rateIds = supply === 'intra' ? [rateId('cgst', slab.ratePpm / 2), rateId('sgst', slab.ratePpm / 2)] : [rateId('igst', slab.ratePpm)];
      const name = `${supply === 'intra' ? 'GST' : 'IGST'} ${formatRate(slab.ratePpm)}${retired ? ` (to ${slab.effectiveTo})` : ''}`;
      s.groups.push({ id: crypto.randomUUID(), name, gstSlabId: slab.id, supply, archivedAt: null, rateIds });
      created.groups.push(name);
    }
  }
  return created;
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* fall through */
  }
  const s: State = { rates: [], groups: [] };
  setUp(
    s,
    loadSlabs().filter((x) => slabInForce(x, today())),
  );
  // Saved straight away: the sample has random ids, which must stay the same between reads
  save(s);
  return s;
}
function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
export const resetDemoTaxes = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

/** How many of the demo company's groups use a slab (for the Super Admin's slab list). */
export const demoSlabUsage = (slabId: string) => load().groups.filter((g) => g.gstSlabId === slabId).length;

/** The demo company's tax groups with their rates and accounts, for the journal editor. */
export const demoTaxState = () => load();

const refuse = (status: 400 | 409, reason: string, extra: object = {}) => new ApiError(status === 400 ? 'validation' : 'conflict', status, undefined, undefined, { reason, ...extra });
const wait = <T>(fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => (async () => fn())().then(resolve, reject), 150));

function respond(s: State): TaxesResponse {
  const accounts = demoAccountRows();
  const ref = (id: string | null) => {
    const a = id ? accounts.find((x) => x.id === id) : undefined;
    return a ? { id: a.id, code: a.code, name: a.name } : null;
  };
  const rates: TaxRate[] = s.rates
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, ratePpm: r.ratePpm, rate: formatRate(r.ratePpm), outputAccount: ref(r.outputAccountId)!, inputAccount: ref(r.inputAccountId), archived: !!r.archivedAt, groupCount: s.groups.filter((g) => g.rateIds.includes(r.id)).length }))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.kind.localeCompare(b.kind) || a.ratePpm - b.ratePpm || a.name.localeCompare(b.name));
  const slabs = loadSlabs();
  const groups: TaxGroup[] = s.groups
    .map((g) => {
      const rs = g.rateIds.map((id) => s.rates.find((r) => r.id === id)!).map((r) => ({ id: r.id, name: r.name, kind: r.kind, ratePpm: r.ratePpm, rate: formatRate(r.ratePpm), archived: !!r.archivedAt }));
      const totalPpm = rs.reduce((t, r) => t + r.ratePpm, 0);
      const slab = slabs.find((x) => x.id === g.gstSlabId);
      return {
        id: g.id,
        name: g.name,
        supply: g.supply,
        gstSlab: slab ? { id: slab.id, rate: formatRate(slab.ratePpm), label: slab.label, effectiveFrom: slab.effectiveFrom, effectiveTo: slab.effectiveTo } : null,
        archived: !!g.archivedAt,
        totalPpm,
        total: formatRate(totalPpm),
        rates: rs,
      };
    })
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.totalPpm - b.totalPpm || supplyOrder(a.supply) - supplyOrder(b.supply) || a.name.localeCompare(b.name));
  const state = findIndianState(REGION)!;
  return {
    rates,
    groups,
    gst: {
      state: { code: state.code, name: state.name },
      utgst: state.utgst,
      slabs: slabs
        .sort((a, b) => a.ratePpm - b.ratePpm || b.effectiveFrom.localeCompare(a.effectiveFrom))
        .map((x) => ({ ...slabView(x, s.groups.filter((g) => g.gstSlabId === x.id).length), inForce: slabInForce(x, today()), setUp: ['intra', 'inter'].every((sup) => s.groups.some((g) => g.gstSlabId === x.id && g.supply === sup)) })),
    },
  };
}

export function createDemoTaxesApi(canManage: () => boolean): TaxesApi {
  const guard = () => {
    if (!canManage()) throw new ApiError('forbidden', 403, undefined, undefined, { missing: ['taxes.manage'] });
  };
  const nameFree = (rows: { id: string; name: string }[], name: string, exceptId?: string) => {
    if (rows.some((r) => r.id !== exceptId && r.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())) throw refuse(409, 'name_taken');
  };
  const checkAccounts = (outputAccountId: string, inputAccountId: string | null) => {
    const accounts = demoAccountRows();
    const out = accounts.find((a) => a.id === outputAccountId);
    if (!out) throw refuse(400, 'account_not_found', { field: 'outputAccountId' });
    if (out.type !== 'liability') throw refuse(400, 'output_not_liability', { field: 'outputAccountId' });
    if (out.archivedAt) throw refuse(400, 'account_archived', { field: 'outputAccountId' });
    if (inputAccountId) {
      if (inputAccountId === outputAccountId) throw refuse(400, 'same_account', { field: 'inputAccountId' });
      const inp = accounts.find((a) => a.id === inputAccountId);
      if (!inp) throw refuse(400, 'account_not_found', { field: 'inputAccountId' });
      if (inp.type !== 'asset') throw refuse(400, 'input_not_asset', { field: 'inputAccountId' });
      if (inp.archivedAt) throw refuse(400, 'account_archived', { field: 'inputAccountId' });
    }
  };
  const rateOf = (s: State, id: string) => respond(s).rates.find((r) => r.id === id)!;
  const groupOf = (s: State, id: string) => respond(s).groups.find((g) => g.id === id)!;

  return {
    list: () => wait(() => respond(load())),
    setupGst: (slabIds) =>
      wait((): GstSetupResult => {
        guard();
        const s = load();
        const all = loadSlabs();
        const slabs = slabIds ? all.filter((x) => slabIds.includes(x.id)) : all.filter((x) => slabInForce(x, today()));
        if (!slabs.length) throw refuse(400, 'no_slabs');
        const created = setUp(s, slabs);
        save(s);
        return { created: { state: REGION, utgst: false, accounts: [], ...created }, ...respond(s) };
      }),
    addCess: (input) =>
      wait(() => {
        guard();
        const s = load();
        const live = s.rates.filter((r) => !r.archivedAt);
        const cgst = live.find((r) => r.kind === 'cgst' && r.ratePpm === input.gstRatePpm / 2);
        const sgst = live.find((r) => r.kind === 'sgst' && r.ratePpm === input.gstRatePpm / 2);
        const igst = live.find((r) => r.kind === 'igst' && r.ratePpm === input.gstRatePpm);
        if (!cgst || !sgst || !igst) throw refuse(409, 'gst_not_set_up');
        const pct = (ppm: number) => `${ppm / 10_000}%`;
        let cess = live.find((r) => r.kind === 'cess' && r.ratePpm === input.cessRatePpm);
        if (!cess) {
          cess = { id: crypto.randomUUID(), name: `Cess ${pct(input.cessRatePpm)}`, kind: 'cess', ratePpm: input.cessRatePpm, outputAccountId: igst.outputAccountId, inputAccountId: igst.inputAccountId, archivedAt: null };
          s.rates.push(cess);
        }
        const groups: string[] = [];
        for (const supply of ['intra', 'inter'] as const) {
          const name = `${supply === 'intra' ? 'GST' : 'IGST'} ${pct(input.gstRatePpm)} + Cess ${pct(input.cessRatePpm)}`;
          if (s.groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) continue;
          s.groups.push({ id: crypto.randomUUID(), name, gstSlabId: null, supply, archivedAt: null, rateIds: supply === 'intra' ? [cgst.id, sgst.id, cess.id] : [igst.id, cess.id] });
          groups.push(name);
        }
        save(s);
        return { created: { groups }, ...respond(s) };
      }),
    createRate: (input: TaxRateCreateInput) =>
      wait(() => {
        guard();
        const s = load();
        const ppm = percentToPpm(input.rate);
        if (ppm === null) throw refuse(400, 'invalid');
        nameFree(s.rates, input.name);
        checkAccounts(input.outputAccountId, input.inputAccountId ?? null);
        const r: StoredRate = { id: crypto.randomUUID(), name: input.name.trim(), kind: input.kind, ratePpm: ppm, outputAccountId: input.outputAccountId, inputAccountId: input.inputAccountId ?? null, archivedAt: null };
        s.rates.push(r);
        save(s);
        return rateOf(s, r.id);
      }),
    updateRate: (id: string, patch: TaxRateUpdateInput) =>
      wait(() => {
        guard();
        const s = load();
        const r = s.rates.find((x) => x.id === id);
        if (!r) throw new ApiError('not_found', 404);
        if (patch.name !== undefined) nameFree(s.rates, patch.name, id);
        const next = { ...r, ...patch, name: patch.name?.trim() ?? r.name };
        if (patch.outputAccountId !== undefined || patch.inputAccountId !== undefined) checkAccounts(next.outputAccountId, next.inputAccountId);
        Object.assign(r, next);
        save(s);
        return rateOf(s, id);
      }),
    archiveRate: (id, archive) =>
      wait(() => {
        guard();
        const s = load();
        const r = s.rates.find((x) => x.id === id);
        if (!r) throw new ApiError('not_found', 404);
        if (archive && s.groups.some((g) => !g.archivedAt && g.rateIds.includes(id))) throw refuse(409, 'in_active_group');
        r.archivedAt = archive ? new Date().toISOString() : null;
        save(s);
        return rateOf(s, id);
      }),
    createGroup: (input: TaxGroupCreateInput) =>
      wait(() => {
        guard();
        const s = load();
        nameFree(s.groups, input.name);
        const rates = input.rateIds.map((id) => s.rates.find((r) => r.id === id));
        if (rates.some((r) => !r)) throw refuse(400, 'rate_not_found');
        if (rates.some((r) => r!.archivedAt)) throw refuse(400, 'rate_archived');
        const g: StoredGroup = { id: crypto.randomUUID(), name: input.name.trim(), gstSlabId: null, supply: null, archivedAt: null, rateIds: [...input.rateIds] };
        s.groups.push(g);
        save(s);
        return groupOf(s, g.id);
      }),
    renameGroup: (id, name) =>
      wait(() => {
        guard();
        const s = load();
        const g = s.groups.find((x) => x.id === id);
        if (!g) throw new ApiError('not_found', 404);
        nameFree(s.groups, name, id);
        g.name = name.trim();
        save(s);
        return groupOf(s, id);
      }),
    archiveGroup: (id, archive) =>
      wait(() => {
        guard();
        const s = load();
        const g = s.groups.find((x) => x.id === id);
        if (!g) throw new ApiError('not_found', 404);
        if (!archive && g.rateIds.some((rid) => s.rates.find((r) => r.id === rid)?.archivedAt)) throw refuse(409, 'rate_archived');
        g.archivedAt = archive ? new Date().toISOString() : null;
        save(s);
        return groupOf(s, id);
      }),
  };
}
