import { contactCreateSchema, IMPORT_FIELDS, IMPORT_PERMISSIONS, importAccountType, importContactKind, importSubtype, itemCreateSchema, todayIn, toMinor, type ImportKind, type OrganizationPermission } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { createDemoAccountsApi, demoAccountRows } from '../accounts/demoAccountsApi';
import { createDemoContactsApi, demoContactRows } from '../contacts/demoContactsApi';
import { createDemoItemsApi, demoItemRows } from '../items/demoItemsApi';
import { createDemoJournalsApi } from '../journals/demoJournalsApi';
import type { ImportResult, ImportRowResult, ImportsApi } from './types';

type Row = Record<string, string>;
type Checked = { results: ImportRowResult[]; build: (() => Promise<string>)[]; summary?: ImportResult['summary']; lines?: { accountId: string; debit: number; credit: number }[] };

/**
 * Imports in demo mode: the same row checks as the API against the demo company's books, then each row
 * added through the demo's own APIs. Nothing is saved unless every row is right.
 */
export function createDemoImportsApi(can: (p: OrganizationPermission) => boolean): ImportsApi {
  const check = (kind: ImportKind, rows: Row[]): Checked => {
    if (!can(IMPORT_PERMISSIONS[kind])) throw new ApiError('forbidden', 403, undefined, undefined, { missing: [IMPORT_PERMISSIONS[kind]] });
    const required = IMPORT_FIELDS[kind].filter((f) => f.required);
    const results: ImportRowResult[] = rows.map((r, n) => ({ row: n + 1, ok: true, errors: required.filter((f) => !r[f.key]?.trim()).map((f) => ({ field: f.key, message: 'This is required.' })) }));
    const fail = (n: number, field: string | null, message: string) => (results[n]!.ok = false, results[n]!.errors.push({ field, message }));
    for (const r of results) r.ok = !r.errors.length;
    const accounts = demoAccountRows();
    const build: Checked['build'] = [];
    if (kind === 'accounts') {
      const codes = new Set(accounts.map((a) => a.code));
      const inFile = new Set(rows.map((r) => r.code?.trim()).filter(Boolean));
      rows.forEach((r, n) => {
        if (!results[n]!.ok) return;
        const type = importAccountType(r.type ?? '');
        if (!type) return fail(n, 'type', `“${r.type}” isn’t an account type: use asset, liability, equity, income or expense.`);
        const subtype = importSubtype(type, r.subtype ?? '');
        if (!subtype) return fail(n, 'subtype', `“${r.subtype}” isn’t a sub-type of ${type}.`);
        if (codes.has(r.code!.trim()) || rows.findIndex((x) => x.code?.trim() === r.code!.trim()) !== n) return fail(n, 'code', 'Another account already has this code.');
        const parent = r.parentCode?.trim();
        if (parent && !codes.has(parent) && !inFile.has(parent)) return fail(n, 'parentCode', `There’s no account with the code ${parent}.`);
        results[n]!.label = `${r.code!.trim()} · ${r.name!.trim()}`;
      });
      // Parents first
      const order = rows.map((_r, n) => n).sort((a, b) => (rows[a]!.parentCode?.trim() ? 1 : 0) - (rows[b]!.parentCode?.trim() ? 1 : 0) || rows[a]!.code!.localeCompare(rows[b]!.code!, 'en', { numeric: true }));
      for (const n of order) {
        const r = rows[n]!;
        build.push(async () => {
          const type = importAccountType(r.type ?? '')!;
          const parentId = r.parentCode?.trim() ? (demoAccountRows().find((a) => a.code === r.parentCode!.trim())?.id ?? null) : null;
          const a = await createDemoAccountsApi(() => true).create({ code: r.code!.trim(), name: r.name!.trim(), type, subtype: importSubtype(type, r.subtype ?? '')!, parentId, description: r.description?.trim() || null, currency: r.currency?.trim().toUpperCase() || null });
          return `${a.code} · ${a.name}`;
        });
      }
    } else if (kind === 'contacts') {
      const names = new Set(demoContactRows().map((c) => c.name.toLowerCase()));
      rows.forEach((r, n) => {
        if (!results[n]!.ok) return;
        const kindOf = importContactKind(r.kind ?? '');
        if (!kindOf) return fail(n, 'kind', `“${r.kind}” isn’t customer, vendor or both.`);
        const terms = r.paymentTermsDays?.trim() ? Number(r.paymentTermsDays.replace(/\s*days?$/i, '')) : undefined;
        const p = contactCreateSchema.safeParse({ name: r.name, ...kindOf, legalName: r.legalName || null, taxId: r.taxId?.toUpperCase() || null, email: r.email || null, phone: r.phone || null, billingAddress: { line1: r.line1 || null, line2: null, city: r.city || null, region: r.region || null, postalCode: r.postalCode || null, country: r.country?.toUpperCase() || (r.taxId ? 'IN' : null) }, currency: r.currency?.toUpperCase() || null, ...(terms !== undefined && { paymentTermsDays: terms }), notes: r.notes || null });
        if (!p.success) return p.error.issues.forEach((i) => fail(n, i.path.length ? i.path.join('.') : null, i.message));
        if (names.has(p.data.name.toLowerCase())) return fail(n, 'name', 'Another contact already has this name.');
        names.add(p.data.name.toLowerCase());
        results[n]!.label = p.data.name;
        build.push(async () => (await createDemoContactsApi(() => true).create(p.data)).name);
      });
    } else if (kind === 'items') {
      const names = new Set(demoItemRows().map((i) => i.name.toLowerCase()));
      rows.forEach((r, n) => {
        if (!results[n]!.ok) return;
        const money = (field: string) => (r[field]?.trim() ? toMinor(r[field]!, 2) : null);
        for (const f of ['salePrice', 'purchasePrice']) if (r[f]?.trim() && money(f) === null) return fail(n, f, `“${r[f]}” isn’t an amount.`);
        const byCode = (field: string) => (r[field]?.trim() ? (accounts.find((a) => a.code === r[field]!.trim())?.id ?? undefined) : null);
        for (const f of ['incomeAccountCode', 'expenseAccountCode']) if (byCode(f) === undefined) return fail(n, f, `There’s no account with the code ${r[f]}.`);
        const kindText = (r.kind ?? '').trim().toLowerCase();
        const p = itemCreateSchema.safeParse({ name: r.name, kind: !kindText ? 'service' : ['goods', 'good', 'product'].includes(kindText) ? 'goods' : ['service', 'services'].includes(kindText) ? 'service' : kindText, sku: r.sku || null, unit: r.unit || null, description: r.description || null, salePrice: money('salePrice'), purchasePrice: money('purchasePrice'), hsnSac: r.hsnSac || null, incomeAccountId: byCode('incomeAccountCode') ?? null, expenseAccountId: byCode('expenseAccountCode') ?? null, mrp: money('mrp'), barcode: r.barcode || null, brand: r.brand || null, category: r.category || null });
        if (!p.success) return p.error.issues.forEach((i) => fail(n, i.path.length ? i.path.join('.') : null, i.message));
        if (names.has(p.data.name.toLowerCase())) return fail(n, 'name', 'Another item already has this name.');
        names.add(p.data.name.toLowerCase());
        results[n]!.label = p.data.name;
        build.push(async () => (await createDemoItemsApi(() => true).create(p.data)).name);
      });
    } else {
      const parents = new Set(accounts.map((a) => a.parentId).filter(Boolean));
      const lines: Checked['lines'] = [];
      rows.forEach((r, n) => {
        if (!results[n]!.ok) return;
        const a = accounts.find((x) => x.code === r.accountCode!.trim());
        if (!a) return fail(n, 'accountCode', `There’s no account with the code ${r.accountCode}.`);
        if (a.archivedAt) return fail(n, 'accountCode', 'That account is archived.');
        if (parents.has(a.id)) return fail(n, 'accountCode', 'That account has sub-accounts: give the balance to one of them.');
        if (a.currency) return fail(n, 'accountCode', 'Foreign-currency balances go in by hand, with their rate.');
        const debit = toMinor(r.debit?.trim() ?? '', 2);
        const credit = toMinor(r.credit?.trim() ?? '', 2);
        if (debit === null) return fail(n, 'debit', `“${r.debit}” isn’t an amount.`);
        if (credit === null) return fail(n, 'credit', `“${r.credit}” isn’t an amount.`);
        if (debit > 0 === credit > 0) return fail(n, 'debit', 'Give a debit or a credit.');
        lines.push({ accountId: a.id, debit, credit });
        results[n]!.label = `${a.code} · ${a.name}`;
      });
      const debit = lines.reduce((s, l) => s + l.debit, 0);
      const credit = lines.reduce((s, l) => s + l.credit, 0);
      return { results, build, summary: { debit, credit, difference: debit - credit }, lines };
    }
    return { results, build };
  };
  const result = (kind: ImportKind, c: Checked, saved: boolean, journalEntry?: { id: string } | null): ImportResult => ({ kind, saved, rows: c.results.length, valid: c.results.filter((r) => r.ok).length, results: c.results, ...(c.summary && { summary: c.summary, journalEntry: journalEntry ?? null }) });
  const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 150));
  return {
    preview: (kind, rows) => wait(() => result(kind, check(kind, rows), false)),
    run: (kind, rows, date) =>
      wait(async () => {
        const c = check(kind, rows);
        if (c.results.some((r) => !r.ok)) return result(kind, c, false);
        if (kind === 'opening_balances') {
          if (!c.lines!.length) return result(kind, c, false);
          const equity = demoAccountRows().find((a) => a.code === '3990')!;
          const diff = c.summary!.difference;
          const e = await createDemoJournalsApi(() => true).create({ date: date ?? todayIn('Asia/Kolkata'), memo: 'Opening balances', reference: 'OPENING', lines: [...c.lines!.map((l) => ({ ...l, description: 'Opening balance' })), ...(diff ? [{ accountId: equity.id, description: 'Opening balance difference', debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0 }] : [])] });
          return result(kind, c, true, { id: e.id });
        }
        for (const make of c.build) await make();
        return result(kind, c, true);
      }),
  };
}
