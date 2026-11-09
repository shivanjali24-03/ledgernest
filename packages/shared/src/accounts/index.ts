import { z } from 'zod';

/** The five account types of double-entry bookkeeping. */
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Which side increases an account: assets and expenses grow with debits, the rest with credits. */
export const NORMAL_SIDE: Record<AccountType, 'debit' | 'credit'> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
};

/** Finer groupings within each type, used by reports (e.g. current vs fixed assets). */
export const ACCOUNT_SUBTYPES = {
  asset: ['bank', 'cash', 'accounts_receivable', 'inventory', 'current_asset', 'fixed_asset', 'other_asset'],
  liability: ['accounts_payable', 'credit_card', 'tax_payable', 'current_liability', 'long_term_liability', 'other_liability'],
  equity: ['owner_equity', 'retained_earnings', 'other_equity'],
  income: ['operating_income', 'other_income'],
  expense: ['cost_of_sales', 'operating_expense', 'payroll', 'depreciation', 'other_expense'],
} as const satisfies Record<AccountType, readonly string[]>;
export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[AccountType][number];

export const subtypeBelongsTo = (type: AccountType, subtype: string): boolean => (ACCOUNT_SUBTYPES[type] as readonly string[]).includes(subtype);

/** How deep sub-accounts may nest (a top-level account is level 1). */
export const MAX_ACCOUNT_DEPTH = 4;

/** Codes like 1000, 1100.01 or 4000-A: letters, digits, dots and dashes, starting with a letter or digit. */
export const ACCOUNT_CODE_PATTERN = /^[0-9A-Z][0-9A-Z.-]{0,11}$/;

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ACCOUNT_CODE_PATTERN, 'Use up to 12 letters, digits, dots or dashes, like 1100.');
const name = z.string().trim().min(1, 'Enter a name.').max(120, 'Keep it under 120 characters.');
const description = z
  .string()
  .trim()
  .max(500, 'Keep it under 500 characters.')
  .transform((v) => v || null)
  .nullable();

export const accountCreateSchema = z
  .object({
    code,
    name,
    type: z.enum(ACCOUNT_TYPES),
    subtype: z.string(),
    /** A sub-account has the same type as its parent */
    parentId: z.uuid().nullable().default(null),
    description: description.optional().default(null),
  })
  .refine((a) => subtypeBelongsTo(a.type, a.subtype), { path: ['subtype'], message: 'Choose a sub-type that belongs to this type.' });
export type AccountCreateInput = z.input<typeof accountCreateSchema>;

export const accountUpdateSchema = z
  .object({
    code,
    name,
    /** Only for accounts without sub-accounts or entries; the sub-type must then fit the new type */
    type: z.enum(ACCOUNT_TYPES),
    subtype: z.string(),
    parentId: z.uuid().nullable(),
    description,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export type AccountUpdateInput = z.input<typeof accountUpdateSchema>;

/**
 * Accounts every organisation has, created automatically. They can be renamed but not removed,
 * because other features rely on them (e.g. the year-end close moves profit to retained earnings).
 */
export const SYSTEM_ACCOUNTS = {
  retained_earnings: { code: '3900', type: 'equity', subtype: 'retained_earnings' },
  opening_balance_equity: { code: '3990', type: 'equity', subtype: 'other_equity' },
} as const satisfies Record<string, { code: string; type: AccountType; subtype: AccountSubtype }>;
export type SystemAccountKey = keyof typeof SYSTEM_ACCOUNTS;

/** System account names in each language; the organisation's language is used when they're created. */
export const SYSTEM_ACCOUNT_NAMES: Record<SystemAccountKey, { en: string } & Record<string, string>> = {
  retained_earnings: {
    en: 'Retained earnings',
    hi: 'प्रतिधारित आय',
    mr: 'राखीव नफा',
    es: 'Resultados acumulados',
    fr: 'Report à nouveau',
    de: 'Gewinnvortrag',
    ar: 'الأرباح المحتجزة',
  },
  opening_balance_equity: {
    en: 'Opening balance equity',
    hi: 'प्रारंभिक शेष पूंजी',
    mr: 'प्रारंभिक शिल्लक भांडवल',
    es: 'Patrimonio de saldos iniciales',
    fr: "Capitaux d'ouverture",
    de: 'Eröffnungsbilanzkapital',
    ar: 'حقوق ملكية الأرصدة الافتتاحية',
  },
};

/** "hi-IN" → the Hindi name, falling back to English. */
export const systemAccountName = (key: SystemAccountKey, locale: string) => SYSTEM_ACCOUNT_NAMES[key][locale.split('-')[0]!] ?? SYSTEM_ACCOUNT_NAMES[key].en;

/** Sorts account codes the way accountants read them: 2 < 10, and 1100 < 1100.01 < 1101. */
export const compareCodes = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

export * from './templates.js';
