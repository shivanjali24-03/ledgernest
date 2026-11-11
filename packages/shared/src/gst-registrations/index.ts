import { z } from 'zod';
import { INDIAN_STATES, isGstin } from '../taxes/index.js';

/**
 * More than one GST registration under one PAN: a GSTIN in each state the business has a place of business in
 * (CGST Act s.25). The organisation's own GSTIN is the first; documents say which one they're under, which decides
 * intra- or inter-state tax, prints as the supplier on them, and files with that GSTIN's returns.
 */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

export const gstRegistrationSchema = z.object({
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => isGstin(v), 'Not a GSTIN.'),
  /** The name the branch trades under, if not the organisation's */
  tradeName: text(100),
  address: z
    .object({ line1: text(120), line2: text(120), city: text(60), region: text(60), postalCode: text(12), country: text(2) })
    .nullable()
    .optional()
    .default(null),
});
export type GstRegistrationInput = z.input<typeof gstRegistrationSchema>;

/** The GST returns of one registration: omitted = the organisation's own GSTIN */
export const gstRegistrationQuerySchema = z.object({ registrationId: z.uuid().optional() });

/** The state a GSTIN is registered in, from its first two digits */
export function gstinStateCode(gstin: string): string | null {
  const code = gstin.slice(0, 2);
  return INDIAN_STATES.some((s) => s.code === code) ? code : null;
}

/** The PAN inside a GSTIN (characters 3 to 12): every registration of a business shares it */
export const panOfGstin = (gstin: string) => gstin.slice(2, 12).toUpperCase();
