import { z } from 'zod';
import { emailSchema, passwordSchema } from '../auth/index.js';
import { INDUSTRIES } from '../accounts/templates.js';

/** Turns a name into a URL-safe slug: "Asha's Café & Co." → "ashas-cafe-co". */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

/** Currencies offered first in pickers; any ISO 4217 code is accepted. */
export const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'SGD', 'AUD', 'CAD', 'JPY'] as const;

const organizationFields = {
  name: z.string().trim().min(2, 'Enter at least 2 characters.').max(120, 'Keep it under 120 characters.'),
  baseCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, like INR.'),
  locale: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Use a locale like en-IN.'),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a 2-letter country code, like IN.')
    .nullable(),
  /** 1 = January … 4 = April (India) */
  fiscalYearStartMonth: z.number().int().min(1).max(12),
};

export const organizationCreateSchema = z.object({
  ...organizationFields,
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN, 'Use lowercase letters, numbers and dashes.').optional(),
  country: organizationFields.country.optional().default(null),
  baseCurrency: organizationFields.baseCurrency.default('INR'),
  locale: organizationFields.locale.default('en-IN'),
  fiscalYearStartMonth: organizationFields.fiscalYearStartMonth.default(4),
  /** The first Owner. An existing user is added at once; anyone else gets an invitation link. */
  owner: z.object({ email: emailSchema }),
  /** Start with this industry's chart of accounts (see INDUSTRIES); omitted = start empty */
  industry: z.enum(INDUSTRIES).optional(),
});
export type OrganizationCreateInput = z.input<typeof organizationCreateSchema>;

export const organizationUpdateSchema = z
  .object(organizationFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export type OrganizationUpdateInput = z.input<typeof organizationUpdateSchema>;

export const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const invitationToken = z.string().min(20).max(200);

/**
 * New people accept an invitation by choosing a name and password.
 * People who already have an account accept while signed in (so the invitation page
 * can never be used to guess an existing account's password around the sign-in lockout).
 */
export const acceptInvitationSchema = z.object({ token: invitationToken, name: z.string().trim().min(2).max(120), password: passwordSchema });
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;

export const acceptInvitationSignedInSchema = z.object({ token: invitationToken });

export const INVITATION_DAYS = 7;
