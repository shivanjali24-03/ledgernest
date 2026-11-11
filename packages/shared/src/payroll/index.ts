import { z } from 'zod';
import { isoDaySchema } from '../periods/index.js';

/**
 * Payroll for India: a monthly salary structure per employee, and each month's payslips worked out from it. What's
 * deducted: provident fund (12% of PF wages, capped at ₹15,000 if chosen), ESI (0.75% while gross is ₹21,000 or
 * less), professional tax by the state worked in, and TDS on salary (s.192) projected over the year. What the
 * employer adds: PF (12%, with admin and EDLI charges) and ESI (3.25%). Amounts are paise.
 */

const money = z.number().int().min(0).max(1e12);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional()
    .default(null);

export const TAX_REGIMES = ['new', 'old'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];
export const GENDERS = ['male', 'female', 'other'] as const;

export const employeeSchema = z.object({
  /** The employee's number, e.g. E-001 */
  code: z.string().trim().min(1, 'Give the employee a code.').max(20),
  name: z.string().trim().min(1, 'Name the employee.').max(120),
  designation: text(80),
  department: text(80),
  email: z.email().nullable().optional().default(null),
  phone: text(20),
  gender: z.enum(GENDERS).nullable().optional().default(null),
  dateOfJoining: isoDaySchema,
  dateOfLeaving: isoDaySchema.nullable().optional().default(null),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Not a PAN.')
    .nullable()
    .optional()
    .default(null),
  /** Universal account number (PF) and ESI insurance number */
  uan: z.string().trim().regex(/^\d{12}$/, 'A UAN is 12 digits.').nullable().optional().default(null),
  esiNumber: z.string().trim().regex(/^\d{10}$/, 'An ESI number is 10 digits.').nullable().optional().default(null),
  /** Two-digit code of the state worked in: its professional tax applies */
  stateCode: z.string().regex(/^\d{2}$/).nullable().optional().default(null),
  /** Monthly salary */
  basic: money,
  hra: money.optional().default(0),
  specialAllowance: money.optional().default(0),
  otherAllowance: money.optional().default(0),
  /** PF on wages capped at ₹15,000 (the statutory ceiling), or on the whole basic */
  pf: z.boolean().optional().default(true),
  pfCapped: z.boolean().optional().default(true),
  esi: z.boolean().optional().default(true),
  pt: z.boolean().optional().default(true),
  taxRegime: z.enum(TAX_REGIMES).optional().default('new'),
  /** A fixed TDS each month instead of the projection (e.g. after declarations under the old regime) */
  monthlyTds: money.nullable().optional().default(null),
  bankAccountName: text(100),
  bankAccountNumber: z.string().trim().regex(/^\d{9,18}$/, 'An account number is 9 to 18 digits.').nullable().optional().default(null),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Not an IFSC.').nullable().optional().default(null),
});
export type EmployeeInput = z.input<typeof employeeSchema>;
export type Employee = z.output<typeof employeeSchema>;

/** A month's run: which month, and any days not paid (loss of pay) employee by employee */
export const payRunSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'A month is YYYY-MM.'),
  lossOfPay: z
    .array(z.object({ employeeId: z.uuid(), days: z.number().min(0).max(31) }))
    .max(1000)
    .optional()
    .default([]),
});
export type PayRunInput = z.input<typeof payRunSchema>;

export const payRunPaySchema = z.object({ date: isoDaySchema, bankAccountId: z.uuid() });

export const PF_WAGE_CEILING = 15_000_00;
export const ESI_GROSS_LIMIT = 21_000_00;

/** Days in a month (YYYY-MM) */
export const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * Professional tax for the month, by state (monthly gross in paise). Maharashtra: ₹175 to ₹200 (₹300 in February),
 * women earning ₹25,000 or less exempt; Karnataka ₹200 from ₹25,000 (₹300 in February); Gujarat ₹200 from ₹12,000;
 * West Bengal ₹110 to ₹200; Andhra Pradesh and Telangana ₹150 to ₹200. Other states (or none): nothing here.
 */
export function professionalTax(stateCode: string | null, gross: number, month: string, gender: string | null): number {
  const feb = month.endsWith('-02');
  const r = gross / 100;
  switch (stateCode) {
    case '27':
      if (gender === 'female') return r <= 25_000 ? 0 : feb ? 300_00 : 200_00;
      return r <= 7_500 ? 0 : r <= 10_000 ? 175_00 : feb ? 300_00 : 200_00;
    case '29':
      return r >= 25_000 ? (feb ? 300_00 : 200_00) : 0;
    case '24':
      return r >= 12_000 ? 200_00 : 0;
    case '19':
      return r <= 10_000 ? 0 : r <= 15_000 ? 110_00 : r <= 25_000 ? 130_00 : r <= 40_000 ? 150_00 : 200_00;
    case '36':
    case '37':
      return r <= 15_000 ? 0 : r <= 20_000 ? 150_00 : 200_00;
    default:
      return 0;
  }
}

/**
 * Income tax on a year's salary (rupees in, rupees out), FY 2025-26 rates. New regime: ₹75,000 standard deduction,
 * slabs of 5% to 30% in steps of ₹4 lakh, no tax up to ₹12 lakh taxable (s.87A, with marginal relief just above).
 * Old regime: ₹50,000 standard deduction, 5%/20%/30%, no tax up to ₹5 lakh. Health and education cess 4% on top.
 */
export function salaryIncomeTax(annualGross: number, regime: TaxRegime): number {
  const taxable = Math.max(0, annualGross - (regime === 'new' ? 75_000 : 50_000));
  const slabs: [number, number][] =
    regime === 'new'
      ? [
          [4_00_000, 0],
          [8_00_000, 0.05],
          [12_00_000, 0.1],
          [16_00_000, 0.15],
          [20_00_000, 0.2],
          [24_00_000, 0.25],
          [Infinity, 0.3],
        ]
      : [
          [2_50_000, 0],
          [5_00_000, 0.05],
          [10_00_000, 0.2],
          [Infinity, 0.3],
        ];
  let tax = 0;
  let from = 0;
  for (const [upto, rate] of slabs) {
    if (taxable > from) tax += (Math.min(taxable, upto) - from) * rate;
    from = upto;
  }
  const limit = regime === 'new' ? 12_00_000 : 5_00_000;
  if (taxable <= limit) tax = 0;
  // Marginal relief (new regime): the tax can't be more than the income above ₹12 lakh
  else if (regime === 'new') tax = Math.min(tax, taxable - limit);
  return Math.round(tax * 1.04);
}

export interface PayslipLine {
  code: string;
  label: string;
  amount: number;
}
export interface Payslip {
  daysInMonth: number;
  daysPaid: number;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  /** What the employer pays on top */
  employer: PayslipLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
}

/** One employee's payslip for a month, with days not paid taken off pro rata */
export function computePayslip(
  e: Pick<Employee, 'basic' | 'hra' | 'specialAllowance' | 'otherAllowance' | 'pf' | 'pfCapped' | 'esi' | 'pt' | 'stateCode' | 'gender' | 'taxRegime' | 'monthlyTds'>,
  month: string,
  lossOfPayDays = 0,
): Payslip {
  const days = daysInMonth(month);
  const paid = Math.max(0, days - lossOfPayDays);
  const pro = (minor: number) => Math.round((minor * paid) / days);
  const earnings: PayslipLine[] = [
    { code: 'basic', label: 'Basic', amount: pro(e.basic) },
    { code: 'hra', label: 'House rent allowance', amount: pro(e.hra ?? 0) },
    { code: 'special', label: 'Special allowance', amount: pro(e.specialAllowance ?? 0) },
    { code: 'other', label: 'Other allowances', amount: pro(e.otherAllowance ?? 0) },
  ].filter((l) => l.amount > 0);
  const gross = earnings.reduce((t, l) => t + l.amount, 0);
  const basic = earnings.find((l) => l.code === 'basic')?.amount ?? 0;
  const deductions: PayslipLine[] = [];
  const employer: PayslipLine[] = [];
  if (e.pf) {
    const wage = e.pfCapped ? Math.min(basic, PF_WAGE_CEILING) : basic;
    // Rounded to the rupee, as the EPFO's challan is
    const pct = (rate: number, base = wage) => Math.round((base * rate) / 100 / 100) * 100;
    deductions.push({ code: 'pf', label: 'Provident fund', amount: pct(12) });
    employer.push(
      { code: 'pf_employer', label: 'Provident fund (employer)', amount: pct(12) },
      { code: 'pf_admin', label: 'PF admin charges', amount: pct(0.5) },
      { code: 'edli', label: 'EDLI', amount: pct(0.5, Math.min(wage, PF_WAGE_CEILING)) },
    );
  }
  if (e.esi && gross > 0 && gross <= ESI_GROSS_LIMIT) {
    // ESI contributions are rounded up to the next rupee
    const up = (rate: number) => Math.ceil((gross * rate) / 100 / 100) * 100;
    deductions.push({ code: 'esi', label: 'ESI', amount: up(0.75) });
    employer.push({ code: 'esi_employer', label: 'ESI (employer)', amount: up(3.25) });
  }
  if (e.pt) {
    const pt = professionalTax(e.stateCode ?? null, gross, month, e.gender ?? null);
    if (pt) deductions.push({ code: 'pt', label: 'Professional tax', amount: pt });
  }
  const tds =
    e.monthlyTds ??
    // The year's tax on this month's full salary, a twelfth of it
    Math.round((salaryIncomeTax(((e.basic + (e.hra ?? 0) + (e.specialAllowance ?? 0) + (e.otherAllowance ?? 0)) * 12) / 100, e.taxRegime ?? 'new') * 100) / 12 / 100) * 100;
  if (tds > 0) deductions.push({ code: 'tds', label: 'Income tax (TDS)', amount: Math.min(tds, gross) });
  const totalDeductions = deductions.reduce((t, l) => t + l.amount, 0);
  return {
    daysInMonth: days,
    daysPaid: paid,
    earnings,
    deductions: deductions.filter((l) => l.amount > 0),
    employer: employer.filter((l) => l.amount > 0),
    gross,
    totalDeductions,
    net: gross - totalDeductions,
    employerCost: employer.reduce((t, l) => t + l.amount, 0),
  };
}

/** "Salary for June 2026" */
export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
};

/** The last day of a month: when its salary is booked */
export const monthEnd = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
