import type { EmployeeInput, PayRunInput, PayslipLine, TaxRegime } from '@ledgernest/shared';

export interface Employee {
  id: string;
  code: string;
  name: string;
  designation: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  gender: 'male' | 'female' | 'other' | null;
  dateOfJoining: string;
  dateOfLeaving: string | null;
  pan: string | null;
  uan: string | null;
  esiNumber: string | null;
  stateCode: string | null;
  basic: number;
  hra: number;
  specialAllowance: number;
  otherAllowance: number;
  gross: number;
  pf: boolean;
  pfCapped: boolean;
  esi: boolean;
  pt: boolean;
  taxRegime: TaxRegime;
  monthlyTds: number | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  ifsc: string | null;
  archived: boolean;
}

export interface PayRun {
  id: string;
  month: string;
  label: string;
  status: 'draft' | 'posted' | 'paid';
  gross: number;
  deductions: number;
  net: number;
  employerCost: number;
  journalEntryId: string | null;
  paidOn: string | null;
  dues: { pf: number; esi: number; pt: number; tds: number };
  payslips: { id: string; employee: { id: string; code: string; name: string; designation: string | null }; daysInMonth: number; daysPaid: number; earnings: PayslipLine[]; deductions: PayslipLine[]; employer: PayslipLine[]; gross: number; totalDeductions: number; net: number; employerCost: number }[];
}

export interface PayrollApi {
  employees(): Promise<{ employees: Employee[] }>;
  createEmployee(input: EmployeeInput): Promise<Employee>;
  updateEmployee(id: string, input: EmployeeInput): Promise<Employee>;
  archiveEmployee(id: string): Promise<void>;
  runs(): Promise<{ runs: PayRun[] }>;
  createRun(input: PayRunInput): Promise<PayRun>;
  removeRun(id: string): Promise<void>;
  post(id: string): Promise<PayRun>;
  unpost(id: string): Promise<PayRun>;
  pay(id: string, input: { date: string; bankAccountId: string }): Promise<PayRun>;
  payslipPdf(id: string): Promise<{ blob: Blob; filename: string }>;
}
