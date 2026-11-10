import { z } from 'zod';
import { isoDaySchema } from '../periods/index.js';

/**
 * Balance confirmations: for the audit, customers and vendors are asked to confirm what they owe us (or we owe them)
 * on a date, usually the year end. Each gets a link to agree, or to dispute with their own figure and a note.
 */
export const CONFIRMATION_SIDES = ['receivable', 'payable'] as const;
export type ConfirmationSide = (typeof CONFIRMATION_SIDES)[number];
export const CONFIRMATION_STATUSES = ['pending', 'agreed', 'disputed'] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export const balanceConfirmationRequestSchema = z.object({
  asOf: isoDaySchema,
  side: z.enum(CONFIRMATION_SIDES),
  /** Just these contacts; left out: everyone on that side with a balance on the day */
  contactIds: z.array(z.string().uuid()).min(1).max(500).optional(),
  /** Email each one the link (those with an email address) */
  send: z.boolean().default(true),
});
export type BalanceConfirmationRequest = z.input<typeof balanceConfirmationRequestSchema>;

export const balanceConfirmationResponseSchema = z
  .object({
    response: z.enum(['agree', 'dispute']),
    /** Who is answering, for the record */
    name: z.string().trim().min(2, 'Enter your name.').max(120),
    /** Their figure, when it differs (smallest currency unit, positive as the request shows it) */
    theirBalance: z.number().int().min(-1e15).max(1e15).nullish(),
    note: z
      .string()
      .trim()
      .max(1000)
      .transform((v) => v || null)
      .nullish(),
  })
  .refine((v) => v.response === 'agree' || v.theirBalance != null || !!v.note, { path: ['note'], message: 'Say what your books show, or why it differs.' });
export type BalanceConfirmationResponse = z.input<typeof balanceConfirmationResponseSchema>;
