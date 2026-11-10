import type { InvoiceLineInput, RecurringBillInput, RecurringFrequency, RecurringStatus } from '@ledgernest/shared';

export interface RecurringBillSchedule {
  id: string;
  name: string;
  contact: { id: string; name: string };
  currency: string | null;
  frequency: RecurringFrequency;
  interval: number;
  startDate: string;
  endDate: string | null;
  maxCount: number | null;
  /** Bills made so far */
  count: number;
  /** null once it has ended */
  nextDate: string | null;
  autoRecord: boolean;
  status: RecurringStatus;
  notes: string | null;
  placeOfSupply: string | null;
  /** The template's lines (discount as a percentage) */
  lines: (InvoiceLineInput & { discount: number })[];
  lastRunAt: string | null;
  /** Why the last attempt failed, until one succeeds */
  lastError: string | null;
  bills: { id: string; number: string | null; status: string; billDate: string; total: number }[];
}

/** Recurring bill schedules. Live and demo both implement it. */
export interface RecurringBillsApi {
  list(): Promise<RecurringBillSchedule[]>;
  create(input: RecurringBillInput): Promise<RecurringBillSchedule>;
  update(id: string, input: RecurringBillInput): Promise<RecurringBillSchedule>;
  setPaused(id: string, paused: boolean): Promise<RecurringBillSchedule>;
  remove(id: string): Promise<void>;
  run(): Promise<{ made: { scheduleId: string; billId: string; date: string; recorded: boolean }[]; failed: { scheduleId: string; date: string; reason: string }[] }>;
}

/** What a schedule copies from a bill: its vendor, lines, notes and place of supply */
export const billTemplateOf = (b: { contact: { id: string; name: string }; notes: string | null; placeOfSupply: string | null; lines: { item: { id: string } | null; description: string; quantity: string; unitPrice: number; discount: number; taxGroup: { id: string } | null; account: { id: string } | null; costCentre?: { id: string } | null }[] }) => ({
  contact: { id: b.contact.id, name: b.contact.name },
  notes: b.notes,
  placeOfSupply: b.placeOfSupply,
  lines: b.lines.map((l) => ({ itemId: l.item?.id ?? null, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxGroupId: l.taxGroup?.id ?? null, accountId: l.account?.id ?? null, costCentreId: l.costCentre?.id ?? null })),
});
export type RecurringBillTemplate = ReturnType<typeof billTemplateOf>;
