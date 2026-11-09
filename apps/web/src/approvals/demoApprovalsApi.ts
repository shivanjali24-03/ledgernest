import { APPROVAL_DOCUMENTS, needsApproval, type ApprovalDocument, type ApprovalStatus } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import type { ApprovalRequest, ApprovalRule, ApprovalsApi } from './types';

/**
 * Approvals in demo mode. There is one person in the demo, so the role being previewed stands for who did it:
 * send a large entry while previewing as an Accountant, then approve it as the Admin.
 */
const KEY = 'ledgernest.demo.approvals';
type Stored = Omit<ApprovalRequest, 'requestedBy' | 'decidedBy'> & { payload: unknown; requestedAs: string; decidedAs: string | null };
type State = { rules: Partial<Record<ApprovalDocument, number>>; requests: Stored[] };

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* fall through */
  }
  return { rules: {}, requests: [] };
}
function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
/** How many demo requests are waiting, for the demo's dashboard */
export const demoPendingApprovals = () => load().requests.filter((r) => r.status === 'pending').length;

export const resetDemoApprovals = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const conflict = (reason: string, extra: object = {}) => new ApiError('conflict', 409, undefined, undefined, { reason, ...extra });
const person = (role: string) => ({ name: `${role.charAt(0).toUpperCase()}${role.slice(1).replace('_', ' ')} (demo)`, email: `${role}@ledgernest.demo` });

/**
 * Called before a demo journal posts, a bill is recorded or a vendor paid from the app. Held when a rule covers
 * it, like the API: a pending request is made and posting is refused with approval_required.
 */
export function demoApprovalCheck(documentType: ApprovalDocument, held: { documentId: string | null; amount: number; summary: string; payload?: unknown }, requestedAs: string) {
  const s = load();
  const min = s.rules[documentType];
  if (!needsApproval(min === undefined ? null : { minAmount: min }, held.amount)) return;
  const waiting = held.documentId ? s.requests.find((r) => r.documentType === documentType && r.documentId === held.documentId && r.status === 'pending') : undefined;
  if (waiting) throw conflict('approval_pending', { requestId: waiting.id });
  const r: Stored = { id: crypto.randomUUID(), documentType, documentId: held.documentId, amount: held.amount, summary: held.summary, status: 'pending', note: null, createdAt: new Date().toISOString(), decidedAt: null, payment: documentType === 'payment' ? (held.payload as ApprovalRequest['payment']) : null, payload: held.payload ?? null, requestedAs, decidedAs: null };
  save({ ...s, requests: [...s.requests, r] });
  throw conflict('approval_required', { requestId: r.id, minAmount: min });
}

const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 120));

/** What approving does in the demo: post the journal, record the bill or make the payment, without asking again */
export type DemoApprovalActions = {
  postJournal(id: string): Promise<{ status: string; totals: { debit: number } }>;
  journal(id: string): Promise<{ status: string; totals: { debit: number } } | null>;
  recordBill(id: string): Promise<unknown>;
  bill(id: string): Promise<{ status: string; total: number } | null>;
  pay(payload: unknown): Promise<{ id: string }>;
  spend(payload: unknown): Promise<{ id: string }>;
};

export function createDemoApprovalsApi(can: { manage: () => boolean; approve: () => boolean }, role: () => string, actions: () => DemoApprovalActions): ApprovalsApi {
  const forbid = (p: string) => new ApiError('forbidden', 403, undefined, undefined, { missing: [p] });
  const rules = (s: State): ApprovalRule[] => APPROVAL_DOCUMENTS.map((d) => ({ documentType: d, enabled: s.rules[d] !== undefined, minAmount: s.rules[d] ?? null }));
  const view = (r: Stored): ApprovalRequest => {
    const { payload: _p, requestedAs, decidedAs, ...rest } = r;
    return { ...rest, requestedBy: person(requestedAs), decidedBy: decidedAs ? person(decidedAs) : null };
  };
  const find = (s: State, id: string) => {
    const r = s.requests.find((x) => x.id === id);
    if (!r) throw new ApiError('not_found', 404);
    return r;
  };
  const decide = (id: string, status: ApprovalStatus, note: string | null, documentId?: string | null) => {
    const s = load();
    const r = find(s, id);
    Object.assign(r, { status, note, decidedAt: new Date().toISOString(), decidedAs: role(), ...(documentId !== undefined && { documentId }) });
    save(s);
    return view(r);
  };
  return {
    rules: () => wait(() => rules(load())),
    setRule: (documentType, minAmount) =>
      wait(() => {
        if (!can.manage()) throw forbid('approvals.manage');
        const s = load();
        s.rules[documentType] = minAmount;
        save(s);
        return rules(s);
      }),
    removeRule: (documentType) =>
      wait(() => {
        if (!can.manage()) throw forbid('approvals.manage');
        const s = load();
        delete s.rules[documentType];
        save(s);
        return rules(s);
      }),
    list: (status) =>
      wait(() => {
        const s = load();
        const items = s.requests.filter((r) => !status || r.status === status).sort((a, b) => (status === 'pending' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
        return { items: items.map(view), pending: s.requests.filter((r) => r.status === 'pending').length };
      }),
    approve: (id, note) =>
      wait(async () => {
        if (!can.approve()) throw forbid('approvals.approve');
        const r = find(load(), id);
        if (r.status !== 'pending') throw conflict('already_decided');
        if (r.requestedAs === role()) throw conflict('own_request');
        const a = actions();
        let documentId = r.documentId;
        if (r.documentType === 'journal') {
          const e = await a.journal(r.documentId!);
          if (!e || e.status !== 'draft') return (decide(id, 'cancelled', null), Promise.reject(conflict('document_gone')));
          if (e.totals.debit !== r.amount) throw conflict('document_changed');
          await a.postJournal(r.documentId!);
        } else if (r.documentType === 'bill') {
          const b = await a.bill(r.documentId!);
          if (!b || b.status !== 'draft') return (decide(id, 'cancelled', null), Promise.reject(conflict('document_gone')));
          if (b.total !== r.amount) throw conflict('document_changed');
          await a.recordBill(r.documentId!);
        } else if (r.documentType === 'bank_spend') documentId = (await a.spend(r.payload)).id;
        else documentId = (await a.pay(r.payload)).id;
        return decide(id, 'approved', note ?? null, documentId);
      }),
    reject: (id, note) =>
      wait(() => {
        if (!can.approve()) throw forbid('approvals.approve');
        if (find(load(), id).status !== 'pending') throw conflict('already_decided');
        return decide(id, 'rejected', note);
      }),
    cancel: (id) =>
      wait(() => {
        const r = find(load(), id);
        if (r.requestedAs !== role()) throw conflict('not_yours');
        decide(id, 'cancelled', null);
      }),
  };
}
