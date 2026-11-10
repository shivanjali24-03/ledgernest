import { fiscalYearOf, fiscalYearSpan, balanceConfirmationResponseSchema, statementRows, statementTitle, pdfTableBytes, type BalanceConfirmationResponse, type ConfirmationSide, type ConfirmationStatus } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import type { ConfirmationSource, ConfirmationView } from '../public/confirmationApi';

/** The demo's balance confirmations, kept in this browser */
export interface DemoConfirmation {
  id: string;
  contactId: string;
  contactName: string;
  partyName: string;
  phone: string | null;
  side: ConfirmationSide;
  asOf: string;
  currency: string;
  balance: number;
  token: string;
  status: ConfirmationStatus;
  theirBalance: number | null;
  note: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  views: number;
}

const KEY = 'ledgernest.demo.confirmations.v1';
export function demoConfirmationRows(): DemoConfirmation[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as DemoConfirmation[]) ?? [];
  } catch {
    return [];
  }
}
export function saveDemoConfirmations(rows: DemoConfirmation[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* not kept */
  }
}
export const resetDemoConfirmations = () => saveDemoConfirmations([]);

const token = () => {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const newDemoToken = token;

const viewOf = (r: DemoConfirmation): ConfirmationView => ({
  organization: { name: 'Nest Demo Private Limited', taxId: '27AAPFN1234C1Z5' },
  party: { name: r.partyName },
  side: r.side,
  asOf: r.asOf,
  currency: r.currency,
  balance: r.balance,
  status: r.status,
  theirBalance: r.theirBalance,
  note: r.note,
  respondedBy: r.respondedBy,
  respondedAt: r.respondedAt,
});

export async function demoConfirmationSource(t: string): Promise<ConfirmationSource | null> {
  const rows = demoConfirmationRows();
  const r = rows.find((x) => x.token === t);
  if (!r) return null;
  r.views += 1;
  saveDemoConfirmations(rows);
  return {
    view: viewOf(r),
    statement: {
      blob: async () => {
        const { createDemoReportsApi } = await import('./demoReportsApi');
        const from = fiscalYearSpan(fiscalYearOf(r.asOf, 4), 4).periods[0]!.startDate;
        const s = await createDemoReportsApi(() => true).statement(r.contactId, r.side === 'receivable' ? 'receivables' : 'payables', from, r.asOf);
        return new Blob([pdfTableBytes({ title: `${statementTitle(s.side)}: ${s.contact.name}`, subtitle: `Nest Demo Private Limited · ${s.from} to ${s.to}`, footer: 'Nest Demo Private Limited · LedgerNest', rows: statementRows(s) }).buffer as ArrayBuffer], { type: 'application/pdf' });
      },
    },
    respond: async (input: BalanceConfirmationResponse) => {
      const p = balanceConfirmationResponseSchema.safeParse(input);
      if (!p.success) throw new ApiError('validation', 400);
      const all = demoConfirmationRows();
      const row = all.find((x) => x.token === t)!;
      if (row.status !== 'pending') throw new ApiError('conflict', 409, undefined, undefined, { reason: 'answered' });
      Object.assign(row, { status: p.data.response === 'agree' ? 'agreed' : 'disputed', theirBalance: p.data.response === 'dispute' ? (p.data.theirBalance ?? null) : null, note: p.data.note ?? null, respondedBy: p.data.name, respondedAt: new Date().toISOString() });
      saveDemoConfirmations(all);
      return viewOf(row);
    },
  };
}
