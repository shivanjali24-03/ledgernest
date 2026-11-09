export interface FiscalPeriod {
  id: string;
  number: number;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed';
  closedAt: string | null;
  closedBy: { name: string; email: string } | null;
  closeReason: string | null;
  current: boolean;
  /** The earliest open period: the only one that can close next */
  canClose: boolean;
  /** The latest closed period: the only one that can reopen */
  canReopen: boolean;
}

export interface FiscalYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  current: boolean;
  closed: boolean;
  periods: FiscalPeriod[];
}

export interface FiscalYearsResponse {
  today: string;
  fiscalYearStartMonth: number;
  /** Start year "Add financial year" would create */
  next: number;
  /** Start year of the year before the first, for entering history */
  previous: number | null;
  years: FiscalYear[];
}

/** Financial years and periods. Live and demo both implement it. */
export interface PeriodsApi {
  list(): Promise<FiscalYearsResponse>;
  createYear(startYear: number): Promise<{ id: string; name: string; startDate: string; endDate: string }>;
  close(periodId: string, reason?: string): Promise<void>;
  reopen(periodId: string, reason?: string): Promise<void>;
}
