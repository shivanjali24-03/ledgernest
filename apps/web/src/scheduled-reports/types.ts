import type { ReportFormat, ReportFrequency, ScheduledReportInput, ScheduledReportKind } from '@ledgernest/shared';

export interface ScheduledReport {
  id: string;
  name: string;
  report: ScheduledReportKind;
  frequency: ReportFrequency;
  day: number;
  format: ReportFormat;
  recipients: string[];
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
}
export interface ReportRun {
  id: string;
  periodFrom: string;
  periodTo: string;
  fileName: string;
  contentType: string;
  emailedTo: string[];
  error: string | null;
  createdAt: string;
}

/** Scheduled reports. Live and demo both implement it. */
export interface ScheduledReportsApi {
  list(): Promise<ScheduledReport[]>;
  create(input: ScheduledReportInput): Promise<ScheduledReport>;
  update(id: string, input: Partial<ScheduledReportInput>): Promise<ScheduledReport>;
  remove(id: string): Promise<void>;
  run(id: string): Promise<ReportRun>;
  runs(id: string): Promise<ReportRun[]>;
  file(runId: string): Promise<{ blob: Blob; filename: string }>;
}
