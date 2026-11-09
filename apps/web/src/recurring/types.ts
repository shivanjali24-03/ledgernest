import type { InvoiceLineInput, RecurringFrequency, RecurringInput, RecurringStatus } from '@ledgernest/shared';

export interface RecurringSchedule {
  id: string;
  name: string;
  contact: { id: string; name: string };
  currency: string | null;
  frequency: RecurringFrequency;
  interval: number;
  startDate: string;
  endDate: string | null;
  maxCount: number | null;
  /** Invoices raised so far */
  count: number;
  /** null once it has ended */
  nextDate: string | null;
  autoIssue: boolean;
  status: RecurringStatus;
  reference: string | null;
  notes: string | null;
  placeOfSupply: string | null;
  /** The template's lines, as a schedule takes them (discount as a percentage) */
  lines: (InvoiceLineInput & { discount: number })[];
  lastRunAt: string | null;
  /** Why the last attempt failed, until one succeeds */
  lastError: string | null;
  invoices: { id: string; number: string | null; status: string; issueDate: string; total: number }[];
}

export interface UpcomingInvoice {
  scheduleId: string;
  name: string;
  contact: { id: string; name: string };
  currency: string | null;
  date: string;
  total: number;
  autoIssue: boolean;
  /** Should have been raised already: the next run will */
  overdue: boolean;
}

/** Recurring invoice schedules. Live and demo both implement it. */
export interface RecurringApi {
  list(): Promise<RecurringSchedule[]>;
  upcoming(days: number): Promise<UpcomingInvoice[]>;
  create(input: RecurringInput): Promise<RecurringSchedule>;
  update(id: string, input: RecurringInput): Promise<RecurringSchedule>;
  setPaused(id: string, paused: boolean): Promise<RecurringSchedule>;
  remove(id: string): Promise<void>;
  run(): Promise<{ raised: { scheduleId: string; invoiceId: string; date: string; issued: boolean }[]; failed: { scheduleId: string; date: string; reason: string }[] }>;
}
