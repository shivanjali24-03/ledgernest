import { z } from 'zod';
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, type AccountType } from '../accounts/index.js';
import type { OrganizationPermission } from '../access/permissions.js';
import { isoDaySchema } from '../periods/index.js';

/**
 * Bringing existing books in from a spreadsheet: the chart of accounts, contacts, items and opening balances.
 * The browser reads the CSV or XLSX and maps its columns to these fields (guessed from the headers, then
 * corrected); the API checks every row, saving nothing until all of them are right.
 */
export const IMPORT_KINDS = ['accounts', 'contacts', 'items', 'opening_balances', 'opening_invoices', 'opening_bills'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const MAX_IMPORT_ROWS = 2000;

export interface ImportField {
  key: string;
  required?: boolean;
  /** Header names it's recognised by, lower case */
  aliases: string[];
}
export const IMPORT_FIELDS: Record<ImportKind, ImportField[]> = {
  accounts: [
    { key: 'code', required: true, aliases: ['code', 'account code', 'a/c code', 'number', 'account number', 'no', 'ledger code'] },
    { key: 'name', required: true, aliases: ['name', 'account name', 'account', 'ledger', 'ledger name', 'title'] },
    { key: 'type', required: true, aliases: ['type', 'account type', 'category', 'group', 'class'] },
    { key: 'subtype', aliases: ['subtype', 'sub-type', 'sub type', 'detail type'] },
    { key: 'parentCode', aliases: ['parent', 'parent code', 'parent account', 'under'] },
    { key: 'description', aliases: ['description', 'notes'] },
    { key: 'currency', aliases: ['currency'] },
  ],
  contacts: [
    { key: 'name', required: true, aliases: ['name', 'contact', 'contact name', 'display name', 'customer', 'vendor', 'party', 'party name'] },
    { key: 'kind', aliases: ['kind', 'type', 'contact type', 'role'] },
    { key: 'legalName', aliases: ['legal name', 'company', 'company name', 'business name'] },
    { key: 'taxId', aliases: ['gstin', 'gst', 'gst number', 'tax id', 'vat', 'vat number', 'tax number'] },
    { key: 'email', aliases: ['email', 'e-mail', 'email address'] },
    { key: 'phone', aliases: ['phone', 'mobile', 'telephone', 'phone number'] },
    { key: 'line1', aliases: ['address', 'address line 1', 'street'] },
    { key: 'city', aliases: ['city', 'town'] },
    { key: 'region', aliases: ['state', 'region', 'province', 'county'] },
    { key: 'postalCode', aliases: ['pin', 'pin code', 'pincode', 'postal code', 'postcode', 'zip', 'zip code'] },
    { key: 'country', aliases: ['country', 'country code'] },
    { key: 'currency', aliases: ['currency'] },
    { key: 'paymentTermsDays', aliases: ['payment terms', 'terms', 'credit days', 'due days'] },
    { key: 'notes', aliases: ['notes', 'remarks'] },
  ],
  items: [
    { key: 'name', required: true, aliases: ['name', 'item', 'item name', 'product', 'service'] },
    { key: 'kind', aliases: ['kind', 'type', 'goods or service'] },
    { key: 'sku', aliases: ['sku', 'code', 'item code', 'product code'] },
    { key: 'unit', aliases: ['unit', 'uom', 'unit of measure'] },
    { key: 'salePrice', aliases: ['sale price', 'selling price', 'price', 'rate'] },
    { key: 'purchasePrice', aliases: ['purchase price', 'cost', 'cost price', 'buying price'] },
    { key: 'hsnSac', aliases: ['hsn', 'sac', 'hsn/sac', 'hsn code', 'sac code'] },
    { key: 'incomeAccountCode', aliases: ['income account', 'sales account', 'income account code'] },
    { key: 'expenseAccountCode', aliases: ['expense account', 'purchase account', 'expense account code'] },
    { key: 'description', aliases: ['description', 'notes'] },
    { key: 'mrp', aliases: ['mrp', 'maximum retail price'] },
    { key: 'barcode', aliases: ['barcode', 'ean', 'upc', 'gtin'] },
    { key: 'brand', aliases: ['brand', 'make'] },
    { key: 'category', aliases: ['category', 'group', 'item group'] },
  ],
  opening_balances: [
    { key: 'accountCode', required: true, aliases: ['code', 'account code', 'account', 'a/c code', 'ledger code'] },
    { key: 'debit', aliases: ['debit', 'dr', 'debit balance'] },
    { key: 'credit', aliases: ['credit', 'cr', 'credit balance'] },
  ],
  // What customers and vendors owed when the books started here, invoice by invoice (Tally's bill-wise outstanding)
  opening_invoices: [
    { key: 'party', required: true, aliases: ['customer', 'customer name', 'party', 'party name', 'party\'s name', 'name', 'debtor', 'ledger', 'ledger name'] },
    { key: 'number', required: true, aliases: ['invoice', 'invoice no', 'invoice number', 'number', 'no', 'ref no', 'ref', 'reference', 'voucher no', 'bill no', 'bill number'] },
    { key: 'date', required: true, aliases: ['date', 'invoice date', 'voucher date', 'bill date'] },
    { key: 'dueDate', aliases: ['due date', 'due', 'due on'] },
    { key: 'amount', required: true, aliases: ['amount', 'balance', 'outstanding', 'pending', 'pending amount', 'amount due', 'balance due', 'closing balance'] },
  ],
  opening_bills: [
    { key: 'party', required: true, aliases: ['vendor', 'vendor name', 'supplier', 'supplier name', 'party', 'party name', 'party\'s name', 'name', 'creditor', 'ledger', 'ledger name'] },
    { key: 'number', required: true, aliases: ['bill', 'bill no', 'bill number', 'invoice', 'invoice no', 'invoice number', 'number', 'no', 'ref no', 'ref', 'reference', 'voucher no'] },
    { key: 'date', required: true, aliases: ['date', 'bill date', 'invoice date', 'voucher date'] },
    { key: 'dueDate', aliases: ['due date', 'due', 'due on'] },
    { key: 'amount', required: true, aliases: ['amount', 'balance', 'outstanding', 'pending', 'pending amount', 'amount due', 'balance due', 'closing balance'] },
  ],
};

/** A date as spreadsheets write it in India: 2026-03-31, 31/03/2026, 31-03-2026 or 31.03.2026 (and two-digit years) */
export function parseImportDate(v: string): string | null {
  const t = v.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Who may import each kind */
export const IMPORT_PERMISSIONS: Record<ImportKind, OrganizationPermission> = { accounts: 'accounts.manage', contacts: 'contacts.manage', items: 'invoices.manage', opening_balances: 'journals.create', opening_invoices: 'invoices.manage', opening_bills: 'bills.manage' };

const norm = (h: string) => h.toLowerCase().replace(/[_*.:]/g, ' ').replace(/\s+/g, ' ').trim();

/** Which column each field comes from, guessed from the headers (each column used once) */
export function guessImportMapping(headers: readonly string[], kind: ImportKind): Record<string, number | null> {
  const taken = new Set<number>();
  const out: Record<string, number | null> = {};
  for (const f of IMPORT_FIELDS[kind]) {
    const at = headers.findIndex((h, i) => !taken.has(i) && f.aliases.includes(norm(h)));
    out[f.key] = at >= 0 ? at : null;
    if (at >= 0) taken.add(at);
  }
  return out;
}

/** Spreadsheet rows as field values, from the mapping */
export function mapImportRows(rows: readonly (readonly string[])[], mapping: Record<string, number | null>): Record<string, string>[] {
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(Object.entries(mapping).flatMap(([k, i]) => (i === null || i === undefined ? [] : [[k, (r[i] ?? '').trim()]]))));
}

const TYPE_WORDS: Record<string, AccountType> = { asset: 'asset', assets: 'asset', liability: 'liability', liabilities: 'liability', equity: 'equity', capital: 'equity', income: 'income', revenue: 'income', sales: 'income', expense: 'expense', expenses: 'expense', cost: 'expense', costs: 'expense' };
/** "Assets", "revenue", "EXPENSE" … as an account type */
export const importAccountType = (text: string): AccountType | null => TYPE_WORDS[norm(text)] ?? ((ACCOUNT_TYPES as readonly string[]).includes(norm(text)) ? (norm(text) as AccountType) : null);
const DEFAULT_SUBTYPE: Record<AccountType, string> = { asset: 'current_asset', liability: 'current_liability', equity: 'owner_equity', income: 'operating_income', expense: 'operating_expense' };
/** "Fixed asset", "bank" or empty (the type's usual one) as a sub-type of the type; null if it doesn't belong */
export function importSubtype(type: AccountType, text: string): string | null {
  if (!text.trim()) return DEFAULT_SUBTYPE[type];
  const s = norm(text).replace(/ /g, '_');
  return (ACCOUNT_SUBTYPES[type] as readonly string[]).includes(s) ? s : null;
}
/** "Customer", "vendor", "supplier", "both" … */
export function importContactKind(text: string): { isCustomer: boolean; isVendor: boolean } | null {
  const s = norm(text);
  if (!s || ['customer', 'client', 'debtor'].includes(s)) return { isCustomer: true, isVendor: false };
  if (['vendor', 'supplier', 'creditor'].includes(s)) return { isCustomer: false, isVendor: true };
  if (['both', 'customer and vendor', 'customer & vendor'].includes(s)) return { isCustomer: true, isVendor: true };
  return null;
}

export const importRequestSchema = z.object({
  rows: z.array(z.record(z.string(), z.string().max(1000))).min(1, 'The file has no rows.').max(MAX_IMPORT_ROWS, `Import up to ${MAX_IMPORT_ROWS} rows at a time.`),
  /** Opening balances: the day they're as of */
  date: isoDaySchema.optional(),
});
export type ImportRequest = z.input<typeof importRequestSchema>;
