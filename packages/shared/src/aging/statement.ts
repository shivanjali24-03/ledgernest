import { z } from 'zod';
import { currencyDigits } from '../currencies/index.js';
import { isoDaySchema } from '../periods/index.js';
import { AGING_SIDES, type AgingSide } from './index.js';

/**
 * A statement of account: everything that changed what a contact owes us (receivables) or what we owe them
 * (payables) over some days, with the balance brought forward, a running balance and the balance carried down.
 * One section per currency the contact has documents in. Voided documents stay, with the void as its own line
 * on the day it was voided, so a statement sent last month still agrees with this one.
 */
export const ACCOUNT_STATEMENT_KINDS = ['invoice', 'credit_note', 'receipt', 'bill', 'payment', 'void'] as const;
export type AccountStatementKind = (typeof ACCOUNT_STATEMENT_KINDS)[number];

export const statementQuerySchema = z
  .object({ contactId: z.uuid(), side: z.enum(AGING_SIDES), from: isoDaySchema, to: isoDaySchema })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'The end date is before the start date.' });
export const statementExportSchema = z
  .object({ contactId: z.uuid(), side: z.enum(AGING_SIDES), from: isoDaySchema, to: isoDaySchema, format: z.enum(['csv', 'pdf']).default('csv') })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'The end date is before the start date.' });

/** Emailing a statement as a PDF: to the contact's own email unless another is given, with an optional note */
export const statementEmailSchema = z
  .object({
    contactId: z.uuid(),
    side: z.enum(AGING_SIDES),
    from: isoDaySchema,
    to: isoDaySchema,
    email: z.email('Enter a valid email address.').optional(),
    message: z.string().trim().max(2000).optional(),
  })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'The end date is before the start date.' });
export type StatementEmailInput = z.input<typeof statementEmailSchema>;

/** Something that moved the balance: positive adds to what's owed, negative takes off it */
export interface AccountStatementEvent {
  date: string;
  kind: AccountStatementKind;
  /** For a void: what was voided */
  voided?: Exclude<AccountStatementKind, 'void'>;
  documentId: string;
  number: string;
  reference: string | null;
  currency: string;
  amount: number;
}

export interface AccountStatementLine {
  date: string;
  kind: AccountStatementKind;
  voided: Exclude<AccountStatementKind, 'void'> | null;
  documentId: string;
  number: string;
  reference: string | null;
  /** Adds to what's owed */
  debit: number;
  /** Takes off what's owed */
  credit: number;
  balance: number;
}

export interface AccountStatementSection {
  currency: string;
  opening: number;
  lines: AccountStatementLine[];
  debits: number;
  credits: number;
  closing: number;
}

export interface AccountStatement {
  contact: { id: string; name: string; email: string | null };
  side: AgingSide;
  from: string;
  to: string;
  sections: AccountStatementSection[];
}

const ORDER: Record<AccountStatementKind, number> = { invoice: 0, bill: 0, credit_note: 1, receipt: 2, payment: 2, void: 3 };

/** Builds the sections from every event up to `to` (earlier ones make the balance brought forward) */
export function buildStatement(events: AccountStatementEvent[], from: string, to: string, baseCurrency: string): AccountStatementSection[] {
  const byCurrency = new Map<string, AccountStatementEvent[]>();
  for (const e of events) {
    if (e.date > to) continue;
    byCurrency.set(e.currency, [...(byCurrency.get(e.currency) ?? []), e]);
  }
  const sections: AccountStatementSection[] = [];
  for (const [currency, list] of byCurrency) {
    list.sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind] || a.number.localeCompare(b.number));
    let balance = list.filter((e) => e.date < from).reduce((s, e) => s + e.amount, 0);
    const opening = balance;
    let debits = 0;
    let credits = 0;
    const lines: AccountStatementLine[] = [];
    for (const e of list) {
      if (e.date < from) continue;
      balance += e.amount;
      const debit = e.amount > 0 ? e.amount : 0;
      const credit = e.amount < 0 ? -e.amount : 0;
      debits += debit;
      credits += credit;
      lines.push({ date: e.date, kind: e.kind, voided: e.voided ?? null, documentId: e.documentId, number: e.number, reference: e.reference, debit, credit, balance });
    }
    if (opening !== 0 || lines.length) sections.push({ currency, opening, lines, debits, credits, closing: balance });
  }
  // The base currency first, then the others by code
  return sections.sort((a, b) => (a.currency === baseCurrency ? -1 : b.currency === baseCurrency ? 1 : a.currency.localeCompare(b.currency)));
}

const LABELS: Record<AccountStatementKind, string> = { invoice: 'Invoice', credit_note: 'Credit note', receipt: 'Receipt', bill: 'Bill', payment: 'Payment', void: 'Void' };

/** The statement as rows for CSV, Excel or PDF (amounts in major units, e.g. rupees) */
export function statementRows(s: AccountStatement): string[][] {
  const rows: string[][] = [['Date', 'Type', 'Document number', 'Reference', 'Currency', 'Debit', 'Credit', 'Balance']];
  for (const sec of s.sections) {
    const digits = currencyDigits(sec.currency);
    const fmt = (minor: number) => (minor === 0 ? '' : (minor / 10 ** digits).toFixed(digits));
    const bal = (minor: number) => (minor / 10 ** digits).toFixed(digits);
    rows.push([s.from, 'Balance brought forward', '', '', sec.currency, '', '', bal(sec.opening)]);
    for (const l of sec.lines) rows.push([l.date, l.voided ? `${LABELS[l.voided]} voided` : LABELS[l.kind], l.number, l.reference ?? '', sec.currency, fmt(l.debit), fmt(l.credit), bal(l.balance)]);
    rows.push([s.to, 'Balance carried down', '', '', sec.currency, fmt(sec.debits), fmt(sec.credits), bal(sec.closing)]);
  }
  return rows;
}

export const statementTitle = (side: AgingSide) => (side === 'receivables' ? 'Statement of account' : 'Vendor statement');
