import type { ImportKind } from '@ledgernest/shared';

export interface ImportRowResult {
  row: number;
  ok: boolean;
  errors: { field: string | null; message: string }[];
  /** What the row became, e.g. "1100 · Bank accounts" */
  label?: string;
}
export interface ImportResult {
  kind: ImportKind;
  /** Only when every row was right */
  saved: boolean;
  rows: number;
  valid: number;
  results: ImportRowResult[];
  /** Opening balances: the totals, and the draft entry made; opening invoices or bills: how many, and what's owed */
  summary?: { debit: number; credit: number; difference: number } | { count: number; total: number };
  journalEntry?: { id: string } | null;
}

/** Spreadsheet imports. Live and demo both implement it. */
export interface ImportsApi {
  preview(kind: ImportKind, rows: Record<string, string>[], date?: string): Promise<ImportResult>;
  run(kind: ImportKind, rows: Record<string, string>[], date?: string): Promise<ImportResult>;
}
