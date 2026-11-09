import { csvToRows, nextReportRun, parseCsv, reportPeriod, scheduledReportSchema, scheduledReportUpdateSchema, XLSX_TYPE, xlsxBytes, type ScheduledReportKind } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { createDemoReportsApi } from '../reports/demoReportsApi';
import type { ReportRun, ScheduledReport, ScheduledReportsApi } from './types';

/** Scheduled reports in demo mode: runs are made from the demo's books and kept in this browser; nothing is emailed. */
const KEY = 'ledgernest.demo.scheduledReports';
type State = { schedules: ScheduledReport[]; runs: (ReportRun & { scheduleId: string; text: string })[] };
const TITLES: Record<ScheduledReportKind, string> = { profit_and_loss: 'Profit and loss', balance_sheet: 'Balance sheet', trial_balance: 'Trial balance', receivables_aging: 'Receivables aging', payables_aging: 'Payables aging' };

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* fall through */
  }
  return { schedules: [], runs: [] };
}
function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
export const resetDemoScheduledReports = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
};

const wait = <T>(fn: () => T | Promise<T>) => new Promise<T>((resolve, reject) => setTimeout(() => Promise.resolve().then(fn).then(resolve, reject), 120));
const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';
const forbid = () => new ApiError('forbidden', 403, undefined, undefined, { missing: ['reports.export'] });

export function createDemoScheduledReportsApi(canExport: () => boolean): ScheduledReportsApi {
  const find = (s: State, id: string) => {
    const x = s.schedules.find((y) => y.id === id);
    if (!x) throw new ApiError('not_found', 404);
    return x;
  };
  return {
    list: () => wait(() => load().schedules),
    create: (input) =>
      wait(() => {
        if (!canExport()) throw forbid();
        // The demo's people have short ids, not UUIDs: check everything else as the API does
        const p = scheduledReportSchema.safeParse({ ...input, recipients: input.recipients.map(() => PLACEHOLDER) });
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const s = load();
        const x: ScheduledReport = { id: crypto.randomUUID(), ...p.data, recipients: [...new Set(input.recipients)], nextRunAt: nextReportRun(new Date(), p.data.frequency, p.data.day).toISOString(), lastRunAt: null };
        s.schedules.push(x);
        save(s);
        return x;
      }),
    update: (id, input) =>
      wait(() => {
        if (!canExport()) throw forbid();
        const p = scheduledReportUpdateSchema.safeParse({ ...input, ...(input.recipients && { recipients: input.recipients.map(() => PLACEHOLDER) }) });
        if (!p.success) throw new ApiError('validation', 400, undefined, undefined, { fields: p.error.issues });
        const s = load();
        const x = find(s, id);
        Object.assign(x, Object.fromEntries(Object.entries(p.data).filter(([k]) => k in input)), input.recipients ? { recipients: input.recipients } : {});
        x.nextRunAt = nextReportRun(new Date(), x.frequency, x.day).toISOString();
        save(s);
        return x;
      }),
    remove: (id) =>
      wait(() => {
        if (!canExport()) throw forbid();
        const s = load();
        find(s, id);
        save({ schedules: s.schedules.filter((x) => x.id !== id), runs: s.runs.filter((r) => r.scheduleId !== id) });
      }),
    run: (id) =>
      wait(async () => {
        if (!canExport()) throw forbid();
        const x = find(load(), id);
        const { from, to } = reportPeriod(new Date().toISOString().slice(0, 10), x.frequency);
        const reports = createDemoReportsApi(() => true);
        const file = x.report === 'profit_and_loss' ? await reports.exportProfitAndLoss(from, to, 'none') : x.report === 'balance_sheet' ? await reports.exportBalanceSheet(to, null) : x.report === 'trial_balance' ? await reports.exportTrialBalance(to) : await reports.exportAging(x.report === 'receivables_aging' ? 'receivables' : 'payables', to);
        const base = `${TITLES[x.report].toLowerCase().replace(/ /g, '-')}-${x.report === 'profit_and_loss' ? `${from}-${to}` : to}`;
        const run = { id: crypto.randomUUID(), scheduleId: id, periodFrom: from, periodTo: to, fileName: `${base}.${x.format}`, contentType: x.format === 'xlsx' ? XLSX_TYPE : 'text/csv', emailedTo: [], error: null, createdAt: new Date().toISOString(), text: await file.blob.text() };
        const s = load();
        s.runs.push(run);
        find(s, id).lastRunAt = run.createdAt;
        save(s);
        const { scheduleId: _s, text: _t, ...out } = run;
        return out;
      }),
    runs: (id) =>
      wait(() =>
        load()
          .runs.filter((r) => r.scheduleId === id)
          .reverse()
          .map(({ scheduleId: _s, text: _t, ...r }) => r),
      ),
    file: (runId) =>
      wait(() => {
        const r = load().runs.find((x) => x.id === runId);
        if (!r) throw new ApiError('not_found', 404);
        const blob = r.contentType === XLSX_TYPE ? new Blob([xlsxBytes([{ name: 'Report', rows: csvToRows(r.text, parseCsv) }]).buffer as ArrayBuffer], { type: XLSX_TYPE }) : new Blob([r.text], { type: 'text/csv;charset=utf-8' });
        return { blob, filename: r.fileName };
      }),
  };
}
