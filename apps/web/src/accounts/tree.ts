import { compareCodes, MAX_ACCOUNT_DEPTH, type AccountType } from '@ledgernest/shared';
import type { Account } from './types';

export interface TreeRow {
  account: Account;
  depth: number;
  /** Has sub-accounts in the current list */
  hasChildren: boolean;
}

/** Accounts as an ordered tree (parents before children, siblings by code), flattened for display. */
export function flattenTree(accounts: Account[], collapsed: ReadonlySet<string> = new Set()): TreeRow[] {
  const byParent = new Map<string | null, Account[]>();
  const ids = new Set(accounts.map((a) => a.id));
  for (const a of accounts) {
    // An account whose parent isn't in the list (e.g. filtered out) shows at the top level
    const key = a.parentId && ids.has(a.parentId) ? a.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), a]);
  }
  const rows: TreeRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of (byParent.get(parent) ?? []).sort((x, y) => compareCodes(x.code, y.code))) {
      const kids = byParent.get(a.id)?.length ?? 0;
      rows.push({ account: a, depth, hasChildren: kids > 0 });
      if (!collapsed.has(a.id)) walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Accounts matching a search (code or name), plus their ancestors so each match keeps its place in the tree. */
export function searchAccounts(accounts: Account[], query: string): Account[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return accounts;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const keep = new Set<string>();
  for (const a of accounts) {
    if (!a.code.toLowerCase().startsWith(q) && !a.name.toLocaleLowerCase().includes(q)) continue;
    for (let at: Account | undefined = a; at && !keep.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) keep.add(at.id);
  }
  return accounts.filter((a) => keep.has(a.id));
}

/** Level of an account (top level = 1). */
export function levelOf(accounts: Account[], id: string): number {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let level = 0;
  for (let at = byId.get(id); at; at = at.parentId ? byId.get(at.parentId) : undefined) level++;
  return level;
}

/** The account and everything beneath it. */
export function subtreeIds(accounts: Account[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of accounts) {
      if (a.parentId && out.has(a.parentId) && !out.has(a.id)) {
        out.add(a.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Height of an account's subtree including itself (a leaf is 1). */
export function heightOf(accounts: Account[], id: string): number {
  const kids = accounts.filter((a) => a.parentId === id);
  return 1 + Math.max(0, ...kids.map((k) => heightOf(accounts, k.id)));
}

/**
 * Accounts that can be the parent of `type` accounts: same type, active, deep enough to fit,
 * and (when moving an existing account) not the account itself or anything beneath it.
 */
export function parentChoices(accounts: Account[], type: AccountType, moving?: Account): Account[] {
  const blocked = moving ? subtreeIds(accounts, moving.id) : new Set<string>();
  const height = moving ? heightOf(accounts, moving.id) : 1;
  return accounts
    .filter((a) => a.type === type && !a.archived && !blocked.has(a.id) && levelOf(accounts, a.id) + height <= MAX_ACCOUNT_DEPTH)
    .sort((x, y) => compareCodes(x.code, y.code));
}

/** Next free code after the parent's (or the type's usual range), as a suggestion for new accounts. */
export function suggestCode(accounts: Account[], type: AccountType, parent?: Account): string {
  const taken = new Set(accounts.map((a) => a.code));
  if (parent) {
    for (let i = 1; i < 100; i++) {
      const c = `${parent.code}.${String(i).padStart(2, '0')}`;
      if (!taken.has(c) && c.length <= 12) return c;
    }
    return '';
  }
  const start = { asset: 1000, liability: 2000, equity: 3000, income: 4000, expense: 5000 }[type];
  for (let c = start; c < start + 1000; c += 10) if (!taken.has(String(c))) return String(c);
  return '';
}
