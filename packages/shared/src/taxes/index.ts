import { z } from 'zod';
import { isoDaySchema } from '../periods/index.js';

/**
 * Taxes: GST, VAT or sales tax. A tax *rate* is one component (CGST 9%) posted to its own accounts;
 * a tax *group* is what a journal line picks (GST 18% = CGST 9% + SGST 9%).
 *
 * Rates are integers in parts per million, so 18% = 180000 and CGST on the 0.25% slab (0.125%) = 1250:
 * no floating point anywhere in tax arithmetic.
 */
export const RATE_SCALE = 1_000_000;
/** 100% */
export const MAX_RATE_PPM = RATE_SCALE;

/** "18" → 180000; null when the text isn't a percentage with at most 4 decimals. */
export function percentToPpm(text: string | number): number | null {
  const clean = String(text).trim().replace(/%$/, '').trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(clean)) return null;
  const [whole = '0', frac = ''] = clean.split('.');
  const ppm = Number(whole) * 10_000 + Number(frac.padEnd(4, '0'));
  return ppm <= MAX_RATE_PPM ? ppm : null;
}

/** 180000 → "18%", 1250 → "0.125%" */
export function formatRate(ppm: number): string {
  const whole = Math.floor(ppm / 10_000);
  const frac = String(ppm % 10_000).padStart(4, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''}%`;
}

export const TAX_KINDS = ['cgst', 'sgst', 'utgst', 'igst', 'cess', 'vat', 'sales_tax', 'other'] as const;
export type TaxKind = (typeof TAX_KINDS)[number];
export const GST_KINDS: readonly TaxKind[] = ['cgst', 'sgst', 'utgst', 'igst', 'cess'];

/** Intra-state supplies carry CGST + SGST/UTGST; inter-state supplies carry IGST. */
export const SUPPLY_TYPES = ['intra', 'inter'] as const;
export type SupplyType = (typeof SUPPLY_TYPES)[number];

// ---------- India ----------

export interface IndianState {
  /** GST state code, the first two digits of a GSTIN */
  code: string;
  name: string;
  /** Union Territories without a legislature charge UTGST instead of SGST */
  utgst: boolean;
}

/** States and Union Territories with their GST state codes. */
export const INDIAN_STATES: readonly IndianState[] = [
  { code: '01', name: 'Jammu and Kashmir', utgst: false },
  { code: '02', name: 'Himachal Pradesh', utgst: false },
  { code: '03', name: 'Punjab', utgst: false },
  { code: '04', name: 'Chandigarh', utgst: true },
  { code: '05', name: 'Uttarakhand', utgst: false },
  { code: '06', name: 'Haryana', utgst: false },
  { code: '07', name: 'Delhi', utgst: false },
  { code: '08', name: 'Rajasthan', utgst: false },
  { code: '09', name: 'Uttar Pradesh', utgst: false },
  { code: '10', name: 'Bihar', utgst: false },
  { code: '11', name: 'Sikkim', utgst: false },
  { code: '12', name: 'Arunachal Pradesh', utgst: false },
  { code: '13', name: 'Nagaland', utgst: false },
  { code: '14', name: 'Manipur', utgst: false },
  { code: '15', name: 'Mizoram', utgst: false },
  { code: '16', name: 'Tripura', utgst: false },
  { code: '17', name: 'Meghalaya', utgst: false },
  { code: '18', name: 'Assam', utgst: false },
  { code: '19', name: 'West Bengal', utgst: false },
  { code: '20', name: 'Jharkhand', utgst: false },
  { code: '21', name: 'Odisha', utgst: false },
  { code: '22', name: 'Chhattisgarh', utgst: false },
  { code: '23', name: 'Madhya Pradesh', utgst: false },
  { code: '24', name: 'Gujarat', utgst: false },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', utgst: true },
  { code: '27', name: 'Maharashtra', utgst: false },
  { code: '29', name: 'Karnataka', utgst: false },
  { code: '30', name: 'Goa', utgst: false },
  { code: '31', name: 'Lakshadweep', utgst: true },
  { code: '32', name: 'Kerala', utgst: false },
  { code: '33', name: 'Tamil Nadu', utgst: false },
  { code: '34', name: 'Puducherry', utgst: false },
  { code: '35', name: 'Andaman and Nicobar Islands', utgst: true },
  { code: '36', name: 'Telangana', utgst: false },
  { code: '37', name: 'Andhra Pradesh', utgst: false },
  { code: '38', name: 'Ladakh', utgst: true },
];

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');

/** The state an organisation's region names, by name ("Tamil Nadu", "tamil-nadu") or GST code ("33"). */
export function findIndianState(region: string | null | undefined): IndianState | null {
  if (!region) return null;
  const key = squash(region);
  if (!key) return null;
  return INDIAN_STATES.find((s) => s.code === key.padStart(2, '0') || squash(s.name) === key) ?? null;
}

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The check character of a GSTIN's first 14 characters (the GSTN's mod-36 scheme). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

/** A well-formed GSTIN: state code, PAN, entity number, "Z" and a valid check character. */
export function isGstin(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(v)) return false;
  const state = Number(v.slice(0, 2));
  if (!((state >= 1 && state <= 38) || state === 97)) return false;
  return gstinCheckChar(v.slice(0, 14)) === v[14];
}

// ---------- GST slabs (platform, managed by the Super Admin) ----------

/** Whether a slab applies on a day (both ends inclusive; no end = still in force). */
export const slabInForce = (slab: { effectiveFrom: string; effectiveTo: string | null }, day: string) => slab.effectiveFrom <= day && (slab.effectiveTo === null || slab.effectiveTo >= day);

const rateField = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const ppm = percentToPpm(v);
    if (ppm === null) {
      ctx.addIssue({ code: 'custom', message: 'Enter a rate between 0 and 100, with at most 4 decimals.' });
      return z.NEVER;
    }
    return ppm;
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

const datesInOrder = (v: { effectiveFrom?: string; effectiveTo?: string | null }) => !v.effectiveFrom || !v.effectiveTo || v.effectiveTo >= v.effectiveFrom;
const datesMessage = { message: 'The end date can’t be before the start date.', path: ['effectiveTo'] };

export const gstSlabCreateSchema = z
  .object({
    /** Percentage, e.g. 18 or "0.25". Must split evenly into CGST and SGST halves. */
    rate: rateField.refine((ppm) => ppm % 2 === 0, 'This rate can’t be split evenly into CGST and SGST.'),
    label: z.string().trim().min(2, 'Enter at least 2 characters.').max(60),
    description: optionalText(300),
    effectiveFrom: isoDaySchema,
    effectiveTo: isoDaySchema.nullable().optional().default(null),
  })
  .refine(datesInOrder, datesMessage);
export type GstSlabCreateInput = z.input<typeof gstSlabCreateSchema>;

/** The rate itself never changes (entries depend on it): retire the slab with an end date and add a new one. */
export const gstSlabUpdateSchema = z
  .strictObject({
    label: z.string().trim().min(2, 'Enter at least 2 characters.').max(60),
    description: z
      .string()
      .trim()
      .max(300)
      .transform((v) => v || null)
      .nullable(),
    effectiveFrom: isoDaySchema,
    effectiveTo: isoDaySchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.')
  .refine(datesInOrder, datesMessage);
export type GstSlabUpdateInput = z.input<typeof gstSlabUpdateSchema>;

// ---------- an organisation's tax rates and groups ----------

const name = z.string().trim().min(2, 'Enter at least 2 characters.').max(60, 'Keep it under 60 characters.');

export const taxRateCreateSchema = z.object({
  name,
  kind: z.enum(TAX_KINDS),
  rate: rateField,
  /** Tax charged on sales goes here (a liability) */
  outputAccountId: z.uuid(),
  /** Tax paid on purchases goes here (an asset, input credit); omitted = it reduces the output account */
  inputAccountId: z.uuid().nullable().optional().default(null),
});
export type TaxRateCreateInput = z.input<typeof taxRateCreateSchema>;

/** A rate's percentage is fixed once created; only its name and accounts can change. */
export const taxRateUpdateSchema = z
  .strictObject({ name, outputAccountId: z.uuid(), inputAccountId: z.uuid().nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export type TaxRateUpdateInput = z.input<typeof taxRateUpdateSchema>;

export const MAX_GROUP_RATES = 5;

export const taxGroupCreateSchema = z.object({
  name,
  rateIds: z
    .array(z.uuid())
    .min(1, 'Choose at least one rate.')
    .max(MAX_GROUP_RATES, `At most ${MAX_GROUP_RATES} rates.`)
    .refine((ids) => new Set(ids).size === ids.length, 'Each rate can appear once.'),
});
export type TaxGroupCreateInput = z.input<typeof taxGroupCreateSchema>;

export const taxGroupUpdateSchema = z.object({ name });

/** Set GST up from the platform's slabs. Omitted = every slab in force today. */
export const gstSetupSchema = z.object({
  slabIds: z.array(z.uuid()).max(50).optional(),
});
export type GstSetupInput = z.input<typeof gstSetupSchema>;

// ---------- tax on a line ----------

export interface TaxComponent {
  rateId: string;
  ratePpm: number;
}

/** a × b / c, rounded half away from zero, in exact integer arithmetic */
const mulDivRound = (a: bigint, b: bigint, c: bigint) => (a * b * 2n + c) / (c * 2n);

/**
 * Splits a line's amount into its net value and each tax component.
 * - exclusive: the amount is net; each component is rounded to the minor unit on its own,
 *   as GST invoices show CGST and SGST separately.
 * - inclusive: the amount already contains the tax; the net is backed out, each component is rounded,
 *   and the net absorbs any rounding paisa so net + taxes always equals what was entered.
 */
export function splitTax(amount: number, inclusive: boolean, components: readonly TaxComponent[]): { net: number; taxes: { rateId: string; amount: number }[] } {
  const a = BigInt(amount);
  const scale = BigInt(RATE_SCALE);
  if (!inclusive) {
    return { net: amount, taxes: components.map((c) => ({ rateId: c.rateId, amount: Number(mulDivRound(a, BigInt(c.ratePpm), scale)) })) };
  }
  const total = components.reduce((s, c) => s + BigInt(c.ratePpm), 0n);
  const net = mulDivRound(a, scale, scale + total);
  const taxes = components.map((c) => ({ rateId: c.rateId, amount: mulDivRound(net, BigInt(c.ratePpm), scale) }));
  const taxSum = taxes.reduce((s, t) => s + t.amount, 0n);
  return { net: Number(a - taxSum), taxes: taxes.map((t) => ({ rateId: t.rateId, amount: Number(t.amount) })) };
}

/**
 * Which side of a tax a line is on, from its account: sales and other income carry output tax (owed to
 * the government); purchases of expenses or assets carry input tax (claimable). A credit note simply
 * runs the other way on the same account, so it reduces the same tax.
 */
export const taxRole = (accountType: string): 'output' | 'input' => (accountType === 'asset' || accountType === 'expense' ? 'input' : 'output');

// ---------- the accounts GST posts to ----------

export interface GstAccountSpec {
  key: string;
  code: string;
  type: 'asset' | 'liability';
  subtype: 'current_asset' | 'tax_payable';
  parent?: string;
  /** Which tax kind posts here, and on which side */
  kind?: 'cgst' | 'sgst' | 'utgst' | 'igst';
  role?: 'input' | 'output';
}

/**
 * GST's accounts, matching the industry templates' codes (1300 input credit, 2100 GST payable).
 * States charge SGST; Union Territories without a legislature charge UTGST instead.
 */
export function gstAccountPlan(utgst: boolean): GstAccountSpec[] {
  const local = utgst ? 'utgst' : 'sgst';
  return [
    { key: 'gst_input_credit', code: '1300', type: 'asset', subtype: 'current_asset' },
    { key: 'cgst_input', code: '1310', type: 'asset', subtype: 'current_asset', parent: '1300', kind: 'cgst', role: 'input' },
    { key: `${local}_input`, code: utgst ? '1340' : '1320', type: 'asset', subtype: 'current_asset', parent: '1300', kind: local, role: 'input' },
    { key: 'igst_input', code: '1330', type: 'asset', subtype: 'current_asset', parent: '1300', kind: 'igst', role: 'input' },
    { key: 'gst_payable', code: '2100', type: 'liability', subtype: 'tax_payable' },
    { key: 'cgst_output', code: '2110', type: 'liability', subtype: 'tax_payable', parent: '2100', kind: 'cgst', role: 'output' },
    { key: `${local}_output`, code: utgst ? '2140' : '2120', type: 'liability', subtype: 'tax_payable', parent: '2100', kind: local, role: 'output' },
    { key: 'igst_output', code: '2130', type: 'liability', subtype: 'tax_payable', parent: '2100', kind: 'igst', role: 'output' },
  ];
}

/** UTGST accounts aren't in the industry templates, so their names live here (the rest come from the templates). */
export const UTGST_ACCOUNT_NAMES: Record<'utgst_input' | 'utgst_output', { en: string } & Record<string, string>> = {
  utgst_input: { en: 'UTGST input', hi: 'यूटीजीएसटी इनपुट', mr: 'यूटीजीएसटी इनपुट', es: 'UTGST soportado', fr: 'UTGST déductible', de: 'UTGST-Vorsteuer', ar: 'ضريبة UTGST على المدخلات' },
  utgst_output: { en: 'UTGST output', hi: 'यूटीजीएसटी आउटपुट', mr: 'यूटीजीएसटी आउटपुट', es: 'UTGST repercutido', fr: 'UTGST collectée', de: 'UTGST-Umsatzsteuer', ar: 'ضريبة UTGST على المخرجات' },
};

// ---------- lines as stored ----------

export interface TaxRateAccounts {
  id: string;
  ratePpm: number;
  outputAccountId: string;
  inputAccountId: string | null;
}

export interface EnteredLine {
  accountId: string;
  description: string | null;
  debit: number;
  credit: number;
  taxGroupId?: string | null;
  taxInclusive?: boolean;
  currency?: string | null;
  foreignDebit?: number;
  foreignCredit?: number;
  rate?: string | null;
  /** The cost centre or project the line belongs to */
  costCentreId?: string | null;
}

/** A line's foreign-currency part, carried through unchanged (foreign lines never carry tax) */
export interface ForeignPart {
  currency: string | null;
  foreignDebit: number;
  foreignCredit: number;
  rate: string | null;
  /** Set on an exchange-difference line generated on posting: the line it settles */
  fxSourceLine: number | null;
}
const noForeign: ForeignPart = { currency: null, foreignDebit: 0, foreignCredit: 0, rate: null, fxSourceLine: null };
const foreignOf = (l: EnteredLine): ForeignPart => (l.currency ? { currency: l.currency, foreignDebit: l.foreignDebit ?? 0, foreignCredit: l.foreignCredit ?? 0, rate: l.rate ?? null, fxSourceLine: null } : noForeign);

export interface ExpandedLine extends ForeignPart {
  lineNo: number;
  accountId: string;
  description: string | null;
  debit: number;
  credit: number;
  taxGroupId: string | null;
  taxInclusive: boolean;
  /** Set on a generated tax line: the rate it charges and the line it was charged on */
  taxRateId: string | null;
  taxSourceLine: number | null;
  /** The cost centre or project; generated tax lines have none (they sit on the balance sheet) */
  costCentreId: string | null;
}

/**
 * The lines an entry stores, from the lines as entered. A taxed line keeps its net amount and is followed by
 * one line per tax component on the same side, posted to the output account for sales and the input account
 * for purchases (see taxRole). The API, the demo and the editor's preview all use this, so they always agree.
 * Returns the 1-based number of an entered line whose amount is too small to carry its tax, if any.
 */
export function expandTax(
  lines: readonly EnteredLine[],
  ratesOf: (groupId: string) => readonly TaxRateAccounts[] | undefined,
  accountType: (accountId: string) => string | undefined,
): { rows: ExpandedLine[]; tooSmall: number | null } {
  const rows: ExpandedLine[] = [];
  let tooSmall: number | null = null;
  lines.forEach((l, index) => {
    const lineNo = rows.length + 1;
    const rates = l.taxGroupId ? ratesOf(l.taxGroupId) : undefined;
    if (!l.taxGroupId || !rates) {
      rows.push({ lineNo, accountId: l.accountId, description: l.description, debit: l.debit, credit: l.credit, taxGroupId: l.taxGroupId ?? null, taxInclusive: false, taxRateId: null, taxSourceLine: null, costCentreId: l.costCentreId ?? null, ...foreignOf(l) });
      return;
    }
    const onDebit = l.debit > 0;
    const split = splitTax(onDebit ? l.debit : l.credit, !!l.taxInclusive, rates.map((r) => ({ rateId: r.id, ratePpm: r.ratePpm })));
    if (split.net <= 0 && tooSmall === null) tooSmall = index + 1;
    const side = (amount: number) => (onDebit ? { debit: amount, credit: 0 } : { debit: 0, credit: amount });
    rows.push({ lineNo, accountId: l.accountId, description: l.description, ...side(split.net), taxGroupId: l.taxGroupId, taxInclusive: !!l.taxInclusive, taxRateId: null, taxSourceLine: null, costCentreId: l.costCentreId ?? null, ...noForeign });
    const role = taxRole(accountType(l.accountId) ?? 'asset');
    split.taxes.forEach((t, i) => {
      if (!t.amount) return; // a 0% slab records the taxable value on the line and adds no tax line
      const rate = rates[i]!;
      const accountId = role === 'input' ? (rate.inputAccountId ?? rate.outputAccountId) : rate.outputAccountId;
      rows.push({ lineNo: rows.length + 1, accountId, description: null, ...side(t.amount), taxGroupId: null, taxInclusive: false, taxRateId: rate.id, taxSourceLine: lineNo, costCentreId: null, ...noForeign });
    });
  });
  return { rows, tooSmall };
}

/** The lines as they were entered, back from the stored ones: generated tax lines dropped, inclusive amounts made gross again. */
export function enteredLines<
  L extends { lineNo: number; accountId: string; description: string | null; debit: number; credit: number; taxGroupId: string | null; taxInclusive: boolean; taxRateId: string | null; taxSourceLine: number | null; costCentreId?: string | null } & Partial<ForeignPart>,
>(lines: readonly L[]): EnteredLine[] {
  return lines
    .filter((l) => !l.taxRateId && !l.fxSourceLine)
    .map((l) => {
      const tax = l.taxInclusive ? lines.filter((t) => t.taxSourceLine === l.lineNo).reduce((s, t) => s + t.debit + t.credit, 0) : 0;
      const entered: EnteredLine = { accountId: l.accountId, description: l.description, debit: l.debit ? l.debit + tax : 0, credit: l.credit ? l.credit + tax : 0, taxGroupId: l.taxGroupId, taxInclusive: l.taxInclusive, ...(l.costCentreId ? { costCentreId: l.costCentreId } : {}) };
      return l.currency ? { ...entered, currency: l.currency, foreignDebit: l.foreignDebit ?? 0, foreignCredit: l.foreignCredit ?? 0, rate: l.rate ?? null } : entered;
    });
}

// ---------- GST returns ----------

export type GstHeads = { igst: number; cgst: number; sgst: number; cess: number };
export const zeroHeads = (): GstHeads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
/** Inter-state invoices to unregistered buyers above this (in paise) are listed one by one in GSTR-1 (B2CL) */
export const B2CL_THRESHOLD = 10_000_000;

/**
 * Sets input tax credit off against output tax the way GST does: IGST credit against IGST, then CGST, then
 * SGST; CGST credit against CGST, then IGST; SGST (or UTGST) credit against SGST, then IGST; never CGST against
 * SGST or the other way round; cess only against cess. What's left of the tax is paid in cash; what's left of
 * the credit is carried forward.
 */
export function gstSetOff(output: GstHeads, credit: GstHeads) {
  const due = { ...output };
  const left = { ...credit };
  const used = { igst: zeroHeads(), cgst: zeroHeads(), sgst: zeroHeads(), cess: zeroHeads() };
  const apply = (from: keyof GstHeads, to: keyof GstHeads) => {
    const n = Math.min(left[from], due[to]);
    if (n <= 0) return;
    left[from] -= n;
    due[to] -= n;
    used[from][to] += n;
  };
  apply('igst', 'igst');
  apply('igst', 'cgst');
  apply('igst', 'sgst');
  apply('cgst', 'cgst');
  apply('cgst', 'igst');
  apply('sgst', 'sgst');
  apply('sgst', 'igst');
  apply('cess', 'cess');
  return { cash: due, carriedForward: left, used };
}

export const gstReturnQuerySchema = z.object({ from: isoDaySchema, to: isoDaySchema }).refine((q) => q.from <= q.to, { path: ['to'], message: 'The end date is before the start date.' });
