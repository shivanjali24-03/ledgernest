import { z } from 'zod';
import { billLineSchema } from '../bills/index.js';
import { MAX_INVOICE_LINES, parseQuantity } from '../invoices/index.js';
import { isoDaySchema } from '../periods/index.js';

/**
 * Purchase orders and goods receipt notes. An order (PO-0001) is drafted, then issued to the vendor; goods are
 * received against it on receipt notes (GRN-0001), each line up to what was ordered; and the bill is made from what
 * was received and not yet billed. Stock comes in when the bill is recorded, as for any bill.
 */
export const PO_STATUSES = ['draft', 'issued', 'closed', 'cancelled'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const poNumber = (n: number) => `PO-${String(n).padStart(4, '0')}`;
export const grnNumber = (n: number) => `GRN-${String(n).padStart(4, '0')}`;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

export const purchaseOrderDraftSchema = z
  .object({
    contactId: z.uuid(),
    orderDate: isoDaySchema,
    /** When the goods are expected */
    expectedDate: isoDaySchema.nullable().optional().default(null),
    reference: text(64),
    notes: text(1000),
    placeOfSupply: z
      .string()
      .regex(/^\d{2}$/)
      .nullable()
      .optional()
      .default(null),
    lines: z.array(billLineSchema).min(1, 'Add at least one line.').max(MAX_INVOICE_LINES),
  })
  .refine((v) => !v.expectedDate || v.expectedDate >= v.orderDate, { path: ['expectedDate'], message: 'Goods can’t be expected before they’re ordered.' });
export type PurchaseOrderDraftInput = z.input<typeof purchaseOrderDraftSchema>;

const quantity = z
  .string()
  .trim()
  .refine((v) => (parseQuantity(v) ?? -1n) > 0n, 'Enter a quantity above 0, up to 4 decimal places.');

/** Goods received against an order: a quantity for each line that came */
export const goodsReceiptSchema = z.object({
  date: isoDaySchema,
  /** The vendor's delivery challan or the transporter's LR number */
  reference: text(64),
  notes: text(500),
  lines: z
    .array(z.object({ lineId: z.uuid(), quantity }))
    .min(1, 'Say what came.')
    .max(MAX_INVOICE_LINES)
    .refine((a) => new Set(a.map((x) => x.lineId)).size === a.length, 'Each line can appear once.'),
});
export type GoodsReceiptInput = z.input<typeof goodsReceiptSchema>;

export const purchaseOrderListQuerySchema = z.object({
  status: z.enum([...PO_STATUSES, 'open']).optional(),
  contactId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** What's left on a line: to receive (ordered less received) and to bill (received less billed), as quantities */
export function poLineOpen(l: { quantity: string; received: string; billed: string }) {
  const q = parseQuantity(l.quantity) ?? 0n;
  const r = parseQuantity(l.received) ?? 0n;
  const b = parseQuantity(l.billed) ?? 0n;
  return { toReceive: q > r ? q - r : 0n, toBill: r > b ? r - b : 0n };
}
