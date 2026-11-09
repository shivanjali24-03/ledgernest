import { z } from 'zod';
import type { OrganizationPermission } from '../access/permissions.js';

/**
 * Letting other systems talk to LedgerNest: API keys that act for the person who made them, within the
 * scopes chosen (never more than that person may do), and webhooks that tell another system when
 * invoices, payments and bills change.
 */
export const API_KEY_PREFIX = 'lnk_';
/** What a key may be allowed to do: reading and the everyday writes, never people, roles or settings */
export const API_KEY_SCOPES = [
  'accounts.view',
  'journals.view',
  'journals.create',
  'contacts.view',
  'contacts.manage',
  'invoices.view',
  'invoices.manage',
  'bills.view',
  'bills.manage',
  'payments.manage',
  'banking.view',
  'reports.view',
] as const satisfies readonly OrganizationPermission[];
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(2, 'Name the key after what will use it.').max(80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, 'Choose at least one thing it may do.').refine((s) => new Set(s).size === s.length, 'Each scope once.'),
  /** Days until it stops working; omitted = until revoked */
  expiresInDays: z.number().int().min(1).max(730).nullable().optional().default(null),
});
export type ApiKeyCreateInput = z.input<typeof apiKeyCreateSchema>;

export const WEBHOOK_EVENTS = ['invoice.issued', 'invoice.voided', 'credit_note.issued', 'credit_note.voided', 'payment.received', 'payment.made', 'payment.voided', 'bill.recorded', 'bill.voided'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
/** After a failed delivery, the next try waits this many minutes; then it's given up */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 30, 120, 720] as const;

export const webhookSchema = z.object({
  url: z
    .string()
    .trim()
    .max(500)
    .url('Enter the full address, starting https://.')
    .refine((u) => /^https?:\/\//i.test(u), 'Use an https:// address.'),
  description: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Choose at least one event.'),
  active: z.boolean().optional().default(true),
});
export type WebhookInput = z.input<typeof webhookSchema>;
