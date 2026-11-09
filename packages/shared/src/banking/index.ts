import { z } from 'zod';
import { rateSchema } from '../currencies/index.js';
import { MAX_LINE_AMOUNT } from '../journals/index.js';
import { isoDaySchema } from '../periods/index.js';

const amount = z.number().int().positive('Enter an amount above 0.').max(MAX_LINE_AMOUNT);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

export const BANK_TRANSACTION_KINDS = ['spend', 'receive', 'transfer'] as const;
export type BankTransactionKind = (typeof BANK_TRANSACTION_KINDS)[number];

/**
 * Money in or out of a bank or cash account that isn't an invoice or bill: bank charges, interest, owner's
 * drawings, a cash sale. Each line goes to an account, with tax if it has any; amounts are in the bank's currency.
 */
export const bankMoneySchema = z.object({
  kind: z.enum(['spend', 'receive']),
  bankAccountId: z.uuid(),
  date: isoDaySchema,
  contactId: z.uuid().nullable().optional().default(null),
  reference: text(100),
  description: text(500),
  /** The amounts include their tax */
  taxInclusive: z.boolean().optional().default(false),
  /** For a foreign-currency account; omitted = that day's rate */
  rate: rateSchema.nullable().optional().default(null),
  lines: z
    .array(z.object({ accountId: z.uuid(), amount, taxGroupId: z.uuid().nullable().optional().default(null), description: text(500) }))
    .min(1, 'Add at least one line.')
    .max(50),
});
export type BankMoneyInput = z.input<typeof bankMoneySchema>;

export const bankVoidSchema = z.object({ date: isoDaySchema.optional(), reason: z.string().trim().max(500).optional() });

export const bankTransactionListQuerySchema = z.object({
  bankAccountId: z.uuid().optional(),
  kind: z.enum(BANK_TRANSACTION_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const bankActivityQuerySchema = z.object({ from: isoDaySchema, to: isoDaySchema }).refine((q) => q.from <= q.to, { path: ['to'], message: 'The end date is before the start date.' });
