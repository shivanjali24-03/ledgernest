import { z } from 'zod';

/**
 * Reading bank statements. Banks differ in everything: delimiters, header rows above the header, column names,
 * date order, decimal commas, Dr/Cr suffixes. This reads CSV and OFX into dated, signed amounts (in the
 * account's smallest unit: money in positive, out negative), reporting each row it can't read.
 */

export const DATE_FORMATS = ['DMY', 'MDY', 'YMD'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const statementMappingSchema = z.object({
  /** Rows above the first transaction (the header row included) */
  headerRows: z.number().int().min(0).max(50),
  delimiter: z.enum([',', ';', '\t', '|']),
  date: z.number().int().min(0),
  description: z.number().int().min(0),
  reference: z.number().int().min(0).nullable(),
  /** One signed amount column, or separate money-in and money-out columns */
  amount: z.number().int().min(0).nullable(),
  moneyIn: z.number().int().min(0).nullable(),
  moneyOut: z.number().int().min(0).nullable(),
  balance: z.number().int().min(0).nullable(),
  dateFormat: z.enum(DATE_FORMATS),
  decimal: z.enum(['.', ',']),
});
export type StatementMapping = z.infer<typeof statementMappingSchema>;

export interface StatementLine {
  /** The row in the file, from 1 */
  row: number;
  date: string;
  description: string;
  reference: string | null;
  /** In the account's smallest unit: in positive, out negative */
  amount: number;
  balance: number | null;
  /** The bank's own id for the transaction (OFX FITID), when it gives one */
  fitId: string | null;
}
export interface StatementIssue {
  row: number;
  problem: 'date' | 'amount' | 'description' | 'columns';
  text: string;
}

/** CSV into rows: quoted fields, doubled quotes, newlines inside quotes, CRLF */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (c === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field.trim());
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** The delimiter that splits the first lines most evenly */
export function detectDelimiter(text: string): StatementMapping['delimiter'] {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best: StatementMapping['delimiter'] = ',';
  let score = -1;
  for (const d of [',', ';', '\t', '|'] as const) {
    const counts = sample.map((l) => l.split(d).length - 1);
    const common = counts.filter((c) => c > 0 && c === counts[counts.length - 1]).length;
    if (common > score) {
      score = common;
      best = d;
    }
  }
  return best;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const valid = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1) return null;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
};
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** A statement date in the given order: 04/05/2026, 4-May-26, 2026-05-04, 04.05.2026 10:32 */
export function parseStatementDate(text: string, format: DateFormat): string | null {
  const t = text.trim().toLowerCase().replace(/[t\s]\d{1,2}:\d{2}(:\d{2})?.*$/, '');
  const named = t.match(/^(\d{1,2})[\s\-/.]*([a-z]{3})[a-z]*[\s\-/.,]*(\d{2,4})$/) ?? null;
  if (named) {
    const m = MONTHS.indexOf(named[2]!);
    return m < 0 ? null : valid(year(named[3]!), m + 1, Number(named[1]));
  }
  const monthFirst = t.match(/^([a-z]{3})[a-z]*[\s\-/.]*(\d{1,2})[\s,\-/.]+(\d{2,4})$/);
  if (monthFirst) {
    const m = MONTHS.indexOf(monthFirst[1]!);
    return m < 0 ? null : valid(year(monthFirst[3]!), m + 1, Number(monthFirst[2]));
  }
  const compact = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return valid(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  const parts = t.split(/[\s\-/.]+/);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  if (parts[0]!.length === 4) return valid(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  const [a, b, c] = parts as [string, string, string];
  return format === 'MDY' ? valid(year(c), Number(a), Number(b)) : valid(year(c), Number(b), Number(a));
}

/**
 * An amount in the account's smallest unit: 1,234.56 · 1.234,56 · (1,234.56) · -1234.56 · ₹ 1,234.56 Dr · 1234.56 CR.
 * Brackets, a minus, or Dr make it money out; Cr makes it in. Empty is null.
 */
export function parseStatementAmount(text: string, decimal: '.' | ',', digits: number): number | null {
  let t = text.trim();
  if (!t || t === '-') return null;
  let sign = 1;
  if (/\bdr\.?$/i.test(t)) {
    sign = -1;
    t = t.replace(/\bdr\.?$/i, '');
  } else if (/\bcr\.?$/i.test(t)) t = t.replace(/\bcr\.?$/i, '');
  if (/^\(.*\)$/.test(t.trim())) {
    sign = -sign;
    t = t.trim().slice(1, -1);
  }
  t = t.replace(/[^\d.,\-+]/g, '');
  if (t.startsWith('-')) {
    sign = -sign;
    t = t.slice(1);
  } else if (t.endsWith('-')) {
    sign = -sign;
    t = t.slice(0, -1);
  }
  t = t.replace(/^\+/, '');
  const [whole, frac = ''] = decimal === '.' ? [t.replace(/,/g, '').split('.')[0]!, t.replace(/,/g, '').split('.')[1]] : [t.replace(/\./g, '').split(',')[0]!, t.replace(/\./g, '').split(',')[1]];
  if (!/^\d+$/.test(whole || '0') || !/^\d*$/.test(frac ?? '') || (frac ?? '').length > digits) return null;
  const minor = Number(whole || '0') * 10 ** digits + Number((frac ?? '').padEnd(digits, '0') || '0');
  return Number.isSafeInteger(minor) ? sign * minor : null;
}

const HEADS: Record<'date' | 'description' | 'reference' | 'amount' | 'moneyIn' | 'moneyOut' | 'balance', RegExp> = {
  date: /^(txn|tran|transaction|posting|booking|trans\.?)?\s*date$|^date$|^(buchungs(tag|datum)|datum|fecha(\s+operaci[oó]n)?|date\s+op[ée]ration|tarih)$/i,
  description: /narration|description|particulars|details|remarks|memo|payee|transaction$|verwendungszweck|buchungstext|beschreibung|concepto|libell[ée]|descripci[oó]n/i,
  reference: /ref|chq|cheque|check|utr|instrument/i,
  amount: /^(transaction\s*)?amount(\s*\(.*\))?$|^amt$|^(betrag|importe|montant)(\s*\(.*\))?$/i,
  moneyOut: /debit|withdrawal|paid\s*out|money\s*out|^dr\.?$|^out$|^soll$|lastschrift|^cargo|d[ée]bit/i,
  moneyIn: /credit|deposit|paid\s*in|money\s*in|^cr\.?$|^in$|^haben$|gutschrift|^abono|cr[ée]dit/i,
  balance: /balance/i,
};

/** Guesses how a CSV statement is laid out: where the header is, which column is which, the date order. */
export function guessMapping(text: string): StatementMapping | null {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  for (let h = 0; h < Math.min(rows.length, 20); h++) {
    const head = rows[h]!.map((c) => c.trim());
    const find = (re: RegExp, not: number[] = []) => {
      const i = head.findIndex((c, k) => !not.includes(k) && re.test(c));
      return i < 0 ? null : i;
    };
    // "Value date" and "Txn date" both match: prefer the one that isn't the value date
    const dates = head.map((c, k) => (HEADS.date.test(c) || /date/i.test(c) ? k : -1)).filter((k) => k >= 0);
    const date = dates.find((k) => !/value/i.test(head[k]!)) ?? dates[0];
    if (date === undefined) continue;
    const balance = find(HEADS.balance);
    const moneyOut = find(HEADS.moneyOut, [date, ...(balance === null ? [] : [balance])]);
    const moneyIn = find(HEADS.moneyIn, [date, ...(balance === null ? [] : [balance]), ...(moneyOut === null ? [] : [moneyOut])]);
    const amount = moneyIn === null || moneyOut === null ? find(HEADS.amount, [date]) : null;
    if (amount === null && (moneyIn === null || moneyOut === null)) continue;
    const taken = [date, balance, moneyIn, moneyOut, amount].filter((x): x is number => x !== null);
    const reference = find(HEADS.reference, taken);
    const description = find(HEADS.description, [...taken, ...(reference === null ? [] : [reference])]) ?? head.findIndex((_c, k) => !taken.includes(k) && k !== reference);
    if (description < 0) continue;
    // Date order: a first number over 12 means day first; a second over 12 means month first
    const samples = rows.slice(h + 1, h + 40).map((r) => r[date] ?? '');
    let dateFormat: DateFormat = samples.some((s) => /^\d{4}/.test(s.trim())) ? 'YMD' : 'DMY';
    if (dateFormat !== 'YMD' && samples.some((s) => Number(s.trim().split(/[\s\-/.]+/)[1]) > 12) && !samples.some((s) => Number(s.trim().split(/[\s\-/.]+/)[0]) > 12)) dateFormat = 'MDY';
    // Decimal comma: amounts like 1.234,56 or 12,50
    const amounts = rows.slice(h + 1, h + 40).flatMap((r) => [amount, moneyIn, moneyOut].filter((x): x is number => x !== null).map((k) => r[k] ?? ''));
    const decimal = amounts.some((a) => /,\d{1,2}(\s*(cr|dr)\.?)?$/i.test(a.trim()) && !/\.\d{1,2}(\s*(cr|dr)\.?)?$/i.test(a.trim())) ? ',' : '.';
    return { headerRows: h + 1, delimiter, date, description, reference, amount, moneyIn, moneyOut, balance, dateFormat, decimal };
  }
  return null;
}

/** The lines of a CSV statement, read with a mapping */
export function statementFromCsv(text: string, m: StatementMapping, digits: number): { lines: StatementLine[]; issues: StatementIssue[] } {
  const rows = parseCsv(text, m.delimiter);
  const lines: StatementLine[] = [];
  const issues: StatementIssue[] = [];
  rows.slice(m.headerRows).forEach((r, k) => {
    const row = m.headerRows + k + 1;
    const cell = (i: number | null) => (i === null ? '' : (r[i] ?? '').trim());
    // Footers ("Closing balance", "Total") have no date: skip them quietly unless they carry an amount
    const dateText = cell(m.date);
    const date = parseStatementDate(dateText, m.dateFormat);
    let amount: number | null;
    if (m.amount !== null) amount = parseStatementAmount(cell(m.amount), m.decimal, digits);
    else {
      const inn = parseStatementAmount(cell(m.moneyIn), m.decimal, digits);
      const out = parseStatementAmount(cell(m.moneyOut), m.decimal, digits);
      amount = inn === null && out === null ? null : Math.abs(inn ?? 0) - Math.abs(out ?? 0);
    }
    if (!date) {
      if (amount) issues.push({ row, problem: 'date', text: dateText });
      return;
    }
    if (!amount) {
      issues.push({ row, problem: 'amount', text: cell(m.amount ?? m.moneyIn ?? m.moneyOut) || cell(m.moneyOut) });
      return;
    }
    const description = cell(m.description).replace(/\s+/g, ' ');
    if (!description) {
      issues.push({ row, problem: 'description', text: '' });
      return;
    }
    lines.push({ row, date, description: description.slice(0, 500), reference: cell(m.reference) || null, amount, balance: m.balance === null ? null : parseStatementAmount(cell(m.balance), m.decimal, digits), fitId: null });
  });
  return { lines, issues };
}

/** The lines of an OFX (or QFX) statement: each STMTTRN with its date, amount, name or memo, and FITID */
export function statementFromOfx(text: string, digits: number): { lines: StatementLine[]; issues: StatementIssue[] } {
  const lines: StatementLine[] = [];
  const issues: StatementIssue[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, name: string) => b.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'))?.[1]?.trim() ?? '';
  blocks.forEach((raw, k) => {
    const b = raw.split(/<\/STMTTRN>/i)[0]!;
    const row = k + 1;
    const date = parseStatementDate(tag(b, 'DTPOSTED').slice(0, 8), 'YMD');
    const amount = parseStatementAmount(tag(b, 'TRNAMT'), '.', digits);
    const name = tag(b, 'NAME');
    const memo = tag(b, 'MEMO');
    const description = [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' · ').replace(/&amp;/g, '&');
    if (!date) return void issues.push({ row, problem: 'date', text: tag(b, 'DTPOSTED') });
    if (!amount) return void issues.push({ row, problem: 'amount', text: tag(b, 'TRNAMT') });
    if (!description) return void issues.push({ row, problem: 'description', text: '' });
    lines.push({ row, date, description: description.slice(0, 500), reference: tag(b, 'CHECKNUM') || tag(b, 'REFNUM') || null, amount, balance: null, fitId: tag(b, 'FITID') || null });
  });
  return { lines, issues };
}

export const looksLikeOfx = (text: string) => /<OFX>|OFXHEADER/i.test(text.slice(0, 2000));

/**
 * What makes a statement line itself, so importing the same file twice adds nothing: the bank's id when it has
 * one, otherwise the day, amount and description, counted (two identical coffees the same day are two lines).
 */
export function statementFingerprints(lines: readonly Pick<StatementLine, 'date' | 'amount' | 'description' | 'fitId'>[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    if (l.fitId) return `fit:${l.fitId}`;
    const base = `${l.date}|${l.amount}|${l.description.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}

export const MAX_STATEMENT_BYTES = 2_000_000;
export const statementImportSchema = z.object({
  bankAccountId: z.uuid(),
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1, 'The file is empty.').max(MAX_STATEMENT_BYTES, 'Statements can be up to 2 MB.'),
  /** CSV only; omitted = the account's saved layout, or a guess */
  mapping: statementMappingSchema.nullable().optional().default(null),
});
export type StatementImportInput = z.input<typeof statementImportSchema>;

export const STATEMENT_LINE_STATUSES = ['unmatched', 'matched', 'ignored'] as const;
export type StatementLineStatus = (typeof STATEMENT_LINE_STATUSES)[number];
export const statementLinesQuerySchema = z.object({
  bankAccountId: z.uuid(),
  status: z.enum(STATEMENT_LINE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
