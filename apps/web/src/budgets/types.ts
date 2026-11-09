import type { BudgetCreateInput, PnlSection } from '@ledgernest/shared';

export interface BudgetSummary {
  id: string;
  name: string;
  fiscalYear: { id: string; name: string };
  /** A plan for one cost centre or project */
  costCentre: { id: string; code: string; name: string } | null;
  updatedAt: string;
  income: number;
  expenses: number;
  profit: number;
}
export interface BudgetRow {
  accountId: string;
  code: string;
  name: string;
  type: 'income' | 'expense';
  section: PnlSection;
  /** Twelve months from the year's first; income and expenses both positive */
  amounts: number[];
  total: number;
}
export interface BudgetGrid {
  id: string;
  name: string;
  fiscalYear: { id: string; name: string; startDate: string; endDate: string };
  costCentre: { id: string; code: string; name: string } | null;
  /** "2026-04" … "2027-03" */
  months: string[];
  rows: BudgetRow[];
  updatedAt: string;
}
export interface ComparisonRow {
  accountId: string;
  code: string;
  name: string;
  type: 'income' | 'expense';
  section: PnlSection;
  budget: number;
  actual: number;
  /** Positive when better than planned */
  variance: number;
  percent: number | null;
}
export interface BudgetComparison {
  id: string;
  name: string;
  fiscalYear: BudgetGrid['fiscalYear'];
  upTo: string;
  months: number;
  sections: { section: PnlSection; rows: ComparisonRow[]; budget: number; actual: number; variance: number }[];
  netProfit: { budget: number; actual: number; variance: number };
}

/** Budgets. Live and demo both implement it. */
export interface BudgetsApi {
  list(): Promise<BudgetSummary[]>;
  get(id: string): Promise<BudgetGrid>;
  create(input: BudgetCreateInput): Promise<BudgetGrid>;
  setLines(id: string, lines: { accountId: string; amounts: number[] }[]): Promise<BudgetGrid>;
  rename(id: string, name: string): Promise<BudgetGrid>;
  remove(id: string): Promise<void>;
  comparison(id: string, upTo?: string): Promise<BudgetComparison>;
}
