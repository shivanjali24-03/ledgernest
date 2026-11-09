import { z } from 'zod';
import { MAX_LINE_AMOUNT } from '../journals/index.js';
import { isoDaySchema } from '../periods/index.js';
import { percentToPpm } from '../taxes/index.js';

export const DEPRECIATION_METHODS = ['straight_line', 'wdv'] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

const minor = z.number().int().min(0).max(MAX_LINE_AMOUNT);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

export const fixedAssetSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the asset.').max(200),
    /** Omitted = the next FA-0001 */
    tag: text(30),
    description: text(500),
    costAccountId: z.uuid(),
    accumulatedAccountId: z.uuid(),
    expenseAccountId: z.uuid(),
    cost: minor.refine((n) => n > 0, 'Enter what it cost.'),
    residual: minor.optional().default(0),
    inServiceDate: isoDaySchema,
    method: z.enum(DEPRECIATION_METHODS),
    usefulLifeMonths: z.number().int().min(1).max(1200).nullable().optional().default(null),
    /** Written-down value: the yearly rate, e.g. 15 or "40" */
    wdvRate: z
      .union([z.string(), z.number()])
      .nullable()
      .optional()
      .default(null)
      .transform((v, ctx) => {
        if (v === null || v === '') return null;
        const ppm = percentToPpm(v);
        if (ppm === null || ppm <= 0) {
          ctx.addIssue({ code: 'custom', message: 'Enter a yearly rate above 0%.' });
          return z.NEVER;
        }
        return ppm;
      }),
    /** Depreciation already charged elsewhere before it was added here, and the day it ran to */
    openingAccumulated: minor.optional().default(0),
    openingTo: isoDaySchema.nullable().optional().default(null),
  })
  .refine((a) => a.residual < a.cost, { path: ['residual'], message: 'The residual value must be less than the cost.' })
  .refine((a) => (a.method === 'straight_line' ? !!a.usefulLifeMonths : !!a.wdvRate), { path: ['usefulLifeMonths'], message: 'Give a useful life for straight-line, or a yearly rate for written-down value.' })
  .refine((a) => a.openingAccumulated <= a.cost - a.residual, { path: ['openingAccumulated'], message: 'That’s more than the asset can be depreciated.' })
  .refine((a) => !a.openingAccumulated || !!a.openingTo, { path: ['openingTo'], message: 'Say the day the earlier depreciation ran to.' });
export type FixedAssetInput = z.input<typeof fixedAssetSchema>;

export const depreciationRunSchema = z.object({ upTo: isoDaySchema });
export const disposeSchema = z.object({ date: isoDaySchema, proceeds: minor.optional().default(0), bankAccountId: z.uuid().nullable().optional().default(null), gainLossAccountId: z.uuid() }).refine((d) => !d.proceeds || !!d.bankAccountId, { path: ['bankAccountId'], message: 'Choose where the money went.' });

const DAY = 86_400_000;
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The calendar months a span of days touches, each with the share of the month it covers */
export function monthShares(from: string, to: string): { month: string; share: number }[] {
  const out: { month: string; share: number }[] = [];
  for (let start = parse(from); start <= parse(to); ) {
    const d = new Date(start);
    const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
    const end = Math.min(monthEnd, parse(to));
    const days = new Date(monthEnd).getUTCDate();
    out.push({ month: iso(start).slice(0, 7), share: (Math.round((end - start) / DAY) + 1) / days });
    start = end + DAY;
  }
  return out;
}

/**
 * Depreciation for an asset over some days, never taking it below its residual value. Straight-line spreads
 * the cost less residual evenly over the useful life in months; written-down value charges the yearly rate on
 * what the asset is still worth, month by month. Part months count by their days.
 */
export function depreciationFor(a: { method: DepreciationMethod; cost: number; residual: number; accumulated: number; usefulLifeMonths: number | null; wdvRatePpm: number | null }, from: string, to: string): number {
  const room = a.cost - a.residual - a.accumulated;
  if (room <= 0 || from > to) return 0;
  const shares = monthShares(from, to);
  if (a.method === 'straight_line') {
    const monthly = (a.cost - a.residual) / a.usefulLifeMonths!;
    return Math.min(room, Math.round(monthly * shares.reduce((s, m) => s + m.share, 0)));
  }
  let total = 0;
  let value = a.cost - a.accumulated;
  for (const m of shares) {
    const charge = Math.min(Math.round((value * a.wdvRatePpm!) / 1_000_000 / 12 * m.share), room - total);
    total += charge;
    value -= charge;
  }
  return total;
}

/** "FA-0007" */
export const assetTag = (n: number) => `FA-${String(n).padStart(4, '0')}`;
export const nextDay = (d: string) => iso(parse(d) + DAY);
