import { z } from 'zod';

/**
 * Bank accounts in India: an IFSC (4 letters for the bank, a 0, 6 letters or digits for the branch) names the branch;
 * Razorpay's free IFSC directory (ifsc.razorpay.com, the RBI list) gives its bank, branch and address. Accounts are
 * 9 to 18 digits.
 */
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NUMBER = /^\d{9,18}$/;

/** What the directory says about a branch */
export type IfscLookup = { ifsc: string; bank: string; branch: string; address: string | null; city: string | null; state: string | null; upi: boolean; neft: boolean; rtgs: boolean; imps: boolean };

/** The fields wanted from Razorpay's answer; null when it isn't a branch */
export function ifscFromRazorpay(ifsc: string, json: unknown): IfscLookup | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null);
  if (str(r.IFSC)?.toUpperCase() !== ifsc || !str(r.BANK)) return null;
  return { ifsc, bank: str(r.BANK)!, branch: str(r.BRANCH) ?? '', address: str(r.ADDRESS), city: str(r.CITY), state: str(r.STATE), upi: r.UPI === true, neft: r.NEFT === true, rtgs: r.RTGS === true, imps: r.IMPS === true };
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

/** A bank account to be paid into: printed on invoices (ours), used for payments to vendors (theirs) */
export const bankDetailsSchema = z.object({
  /** The name the account is in */
  accountName: z.string().trim().min(2, 'Give the name the account is in.').max(120),
  accountNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .refine((v) => ACCOUNT_NUMBER.test(v), 'An account number is 9 to 18 digits.'),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => IFSC.test(v), 'An IFSC is 11 characters, like HDFC0001234 (the 5th is a zero).'),
  bankName: text(120),
  branch: text(160),
  accountType: z.enum(['current', 'savings', 'od', 'cc']).nullable().optional().default(null),
});
export type BankDetails = z.output<typeof bankDetailsSchema>;
export type BankDetailsInput = z.input<typeof bankDetailsSchema>;

/** Printed: "Bank: HDFC Bank, Baner · A/c 50100123456789 · IFSC HDFC0001234 · Nest Demo Pvt Ltd" */
export const bankDetailsLine = (b: BankDetails) =>
  [`Bank: ${[b.bankName, b.branch].filter(Boolean).join(', ') || b.ifsc.slice(0, 4)}`, `A/c ${b.accountNumber}`, `IFSC ${b.ifsc}`, b.accountName].join(' · ');
