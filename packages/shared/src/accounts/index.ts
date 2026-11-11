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

const accountCurrency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Choose a currency.')
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
    /** A foreign-currency account (e.g. a USD bank account): its lines are in this currency. Assets and liabilities only. */
    currency: accountCurrency.optional().default(null),
  })
  .refine((a) => subtypeBelongsTo(a.type, a.subtype), { path: ['subtype'], message: 'Choose a sub-type that belongs to this type.' })
  .refine((a) => !a.currency || a.type === 'asset' || a.type === 'liability', { path: ['currency'], message: 'Only asset and liability accounts can be in a foreign currency.' });
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
    /** Only while the account has no entries */
    currency: accountCurrency,
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

/**
 * Where exchange differences go. Created the first time an organisation needs them (most never trade in a
 * foreign currency): realised when a foreign balance is settled at a different rate, unrealised when
 * balances are revalued at a period's closing rate.
 */
export const FX_ACCOUNTS = {
  fx_realised: { code: '4950', type: 'income', subtype: 'other_income' },
  fx_unrealised: { code: '4960', type: 'income', subtype: 'other_income' },
  /** Interest charged to customers for paying late */
  interest_income: { code: '4970', type: 'income', subtype: 'other_income' },
  /** Invoice totals rounded to the rupee: the differences */
  round_off: { code: '4980', type: 'income', subtype: 'other_income' },
  /** GST we owe on purchases under reverse charge, paid in cash with the return */
  rcm_payable: { code: '2170', type: 'liability', subtype: 'tax_payable' },
  /** Goods out on delivery challans: still ours, but not on hand (job work, approval, exhibitions) */
  goods_on_challan: { code: '1560', type: 'asset', subtype: 'current_asset' },
  /** Goods in stock received on purchase orders, their bills not yet recorded */
  grni: { code: '2180', type: 'liability', subtype: 'current_liability' },
} as const satisfies Record<string, { code: string; type: AccountType; subtype: AccountSubtype }>;
export type FxAccountKey = keyof typeof FX_ACCOUNTS;
export const FX_ACCOUNT_NAMES: Record<FxAccountKey, { en: string } & Record<string, string>> = {
  fx_realised: { en: 'Realised exchange gain or loss', hi: 'प्राप्त विनिमय लाभ या हानि', mr: 'प्राप्त विनिमय नफा किंवा तोटा', es: 'Diferencias de cambio realizadas', fr: 'Écarts de change réalisés', de: 'Realisierte Kursgewinne und -verluste', ar: 'أرباح أو خسائر الصرف المحققة' },
  interest_income: { en: 'Interest on late payment', hi: 'देर से भुगतान पर ब्याज', mr: 'उशिरा भरण्यावरील व्याज' },
  round_off: { en: 'Round off', hi: 'राउंड ऑफ', mr: 'राउंड ऑफ' },
  rcm_payable: { en: 'GST payable under reverse charge', hi: 'रिवर्स चार्ज के तहत देय GST', mr: 'रिव्हर्स चार्ज अंतर्गत देय GST' },
  goods_on_challan: { en: 'Goods sent on delivery challan', hi: 'डिलीवरी चालान पर भेजा गया माल', mr: 'डिलिव्हरी चलनावर पाठवलेला माल' },
  grni: { en: 'Goods received, not yet billed', hi: 'प्राप्त माल, बिल बाकी', mr: 'मिळालेला माल, बिल बाकी' },
  fx_unrealised: { en: 'Unrealised exchange gain or loss', hi: 'अप्राप्त विनिमय लाभ या हानि', mr: 'अप्राप्त विनिमय नफा किंवा तोटा', es: 'Diferencias de cambio no realizadas', fr: 'Écarts de change latents', de: 'Unrealisierte Kursgewinne und -verluste', ar: 'أرباح أو خسائر الصرف غير المحققة' },
};

/** Sorts account codes the way accountants read them: 2 < 10, and 1100 < 1100.01 < 1101. */
export const compareCodes = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

export * from './templates.js';
