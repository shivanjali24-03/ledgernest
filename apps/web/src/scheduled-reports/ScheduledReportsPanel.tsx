import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Download, History, Pause, Play, Plus, Send, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { REPORT_FORMATS, REPORT_FREQUENCIES, SCHEDULED_REPORTS, type ReportFormat, type ReportFrequency, type ScheduledReportKind } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatDate, formatRelative } from '../lib/format';
import { useSession } from '../layout/session';
import { useTeamApi } from '../team/useTeamApi';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import { SelectField, TextField } from '../ui/Field';
import { Card, EmptyState, ErrorState, Pill, SkeletonRows } from '../ui/Kit';
import Modal from '../ui/Modal';
import RowMenu from '../ui/RowMenu';
import { useToast } from '../ui/toastContext';
import type { ScheduledReport, ScheduledReportsApi } from './types';
import { useScheduledReportsApi } from './useScheduledReportsApi';

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** "Monday", "Tuesday" … in the reader's language (1 = Monday) */
const weekday = (n: number, locale: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 15 + n)));

/** Reports that arrive by themselves: set up, run now, pause, and every run kept to download. */
export default function ScheduledReportsPanel() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const api = useScheduledReportsApi();
  const canManage = session.permissions.has('reports.export');
  const key = ['scheduled-reports', session.organizationId, session.role ?? session.customRoleName];
  const list = useQuery({ queryKey: key, queryFn: () => api!.list(), enabled: !!api });
  const [editing, setEditing] = useState(false);
  const [runsOf, setRunsOf] = useState<ScheduledReport | null>(null);
  const [removing, setRemoving] = useState<ScheduledReport | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['scheduled-reports'] });
  const fail = () => toast(t('scheduledReports.failed'), 'error');
  const run = useMutation({ mutationFn: (s: ScheduledReport) => api!.run(s.id), onSuccess: (r) => (refresh(), toast(r.emailedTo.length ? t('scheduledReports.ranEmailed', { count: r.emailedTo.length }) : t('scheduledReports.ran'))), onError: fail });
  const toggle = useMutation({ mutationFn: (s: ScheduledReport) => api!.update(s.id, { active: !s.active }), onSuccess: (s) => (refresh(), toast(t(s.active ? 'scheduledReports.resumed' : 'scheduledReports.paused'))), onError: fail });
  const remove = useMutation({ mutationFn: (s: ScheduledReport) => api!.remove(s.id), onSuccess: () => (setRemoving(null), refresh(), toast(t('scheduledReports.removed'))), onError: () => (setRemoving(null), fail()) });
  if (!api) return null;
  const when = (s: ScheduledReport) => (s.frequency === 'weekly' ? t('scheduledReports.everyWeek', { day: weekday(s.day, locale) }) : t('scheduledReports.everyMonth', { day: s.day }));
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
        <span className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('scheduledReports.title')}</h2>
          <p className="text-sm text-ink-500">{t('scheduledReports.body')}</p>
        </span>
        {canManage && (
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing(true)}>
            {t('scheduledReports.new')}
          </Button>
        )}
      </div>
      {list.isPending ? (
        <SkeletonRows rows={3} />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : !list.data.length ? (
        <EmptyState icon={<CalendarClock className="size-5" />} title={t('scheduledReports.empty')} body={t('scheduledReports.emptyBody')} />
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {list.data.map((s) => (
            <li key={s.id} className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3', !s.active && 'opacity-60')}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" dir="auto">
                    {s.name}
                  </span>
                  <Pill>{t(`scheduledReports.reports.${s.report}`)}</Pill>
                  <Pill>{s.format.toUpperCase()}</Pill>
                  {!s.active && <Pill>{t('scheduledReports.pausedPill')}</Pill>}
                </span>
                <span className="block text-sm text-ink-500">
                  {[when(s), t('scheduledReports.recipients', { count: s.recipients.length }), s.active ? t('scheduledReports.next', { date: formatDate(s.nextRunAt, locale) }) : null, s.lastRunAt ? t('scheduledReports.last', { when: formatRelative(s.lastRunAt, locale) }) : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <RowMenu
                label={t('scheduledReports.actionsFor', { name: s.name })}
                items={[
                  { key: 'runs', label: t('scheduledReports.runs'), icon: History, onSelect: () => setRunsOf(s) },
                  ...(canManage
                    ? [
                        { key: 'run', label: t('scheduledReports.runNow'), icon: Send, onSelect: () => run.mutate(s) },
                        { key: 'toggle', label: t(s.active ? 'scheduledReports.pause' : 'scheduledReports.resume'), icon: s.active ? Pause : Play, onSelect: () => toggle.mutate(s) },
                        { key: 'remove', label: t('scheduledReports.remove'), icon: Trash2, danger: true, onSelect: () => setRemoving(s) },
                      ]
                    : []),
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      {editing && <ScheduleDialog api={api} onClose={() => setEditing(false)} onDone={() => (setEditing(false), refresh())} />}
      {runsOf && <RunsDialog api={api} schedule={runsOf} onClose={() => setRunsOf(null)} />}
      <ConfirmDialog open={!!removing} title={removing ? t('scheduledReports.removeTitle', { name: removing.name }) : ''} body={t('scheduledReports.removeBody')} confirmLabel={t('scheduledReports.remove')} tone="danger" busy={remove.isPending} onConfirm={() => removing && remove.mutate(removing)} onClose={() => setRemoving(null)} />
    </Card>
  );
}

function ScheduleDialog({ api, onClose, onDone }: { api: ScheduledReportsApi; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const session = useSession();
  const team = useTeamApi();
  const members = useQuery({ queryKey: ['team', session.organizationId, 'members'], queryFn: () => team!.listMembers(), enabled: !!team });
  const [report, setReport] = useState<ScheduledReportKind>('profit_and_loss');
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<ReportFrequency>('monthly');
  const [day, setDay] = useState(1);
  const [format, setFormat] = useState<ReportFormat>('xlsx');
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const me = members.data?.find((m) => m.user.email === session.email)?.user.id;
  const chosen = recipients.size ? recipients : me ? new Set([me]) : recipients;
  const make = useMutation({
    mutationFn: () => api.create({ name: name.trim() || t(`scheduledReports.defaultName.${frequency}`, { report: t(`scheduledReports.reports.${report}`) }), report, frequency, day, format, recipients: [...chosen] }),
    onSuccess: () => (toast(t('scheduledReports.created')), onDone()),
    onError: () => toast(t('scheduledReports.recipientsFailed'), 'error'),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t('scheduledReports.newTitle')}
      description={t('scheduledReports.newBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="schedule-form" loading={make.isPending} disabled={!chosen.size}>
            {t('scheduledReports.create')}
          </Button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={(e: FormEvent) => (e.preventDefault(), chosen.size && make.mutate())} noValidate className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label={t('scheduledReports.fields.report')} value={report} onChange={(e) => setReport(e.target.value as ScheduledReportKind)} options={SCHEDULED_REPORTS.map((r) => ({ value: r, label: t(`scheduledReports.reports.${r}`) }))} />
          <TextField label={t('scheduledReports.fields.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t(`scheduledReports.defaultName.${frequency}`, { report: t(`scheduledReports.reports.${report}`) })} maxLength={120} dir="auto" />
          <SelectField label={t('scheduledReports.fields.frequency')} value={frequency} onChange={(e) => (setFrequency(e.target.value as ReportFrequency), setDay(1))} options={REPORT_FREQUENCIES.map((f) => ({ value: f, label: t(`scheduledReports.frequencies.${f}`) }))} />
          <SelectField
            label={t(frequency === 'weekly' ? 'scheduledReports.fields.weekday' : 'scheduledReports.fields.dayOfMonth')}
            value={String(day)}
            onChange={(e) => setDay(Number(e.target.value))}
            options={(frequency === 'weekly' ? [1, 2, 3, 4, 5, 6, 7] : Array.from({ length: 28 }, (_x, i) => i + 1)).map((d) => ({ value: String(d), label: frequency === 'weekly' ? weekday(d, locale) : String(d) }))}
          />
          <SelectField label={t('scheduledReports.fields.format')} value={format} onChange={(e) => setFormat(e.target.value as ReportFormat)} options={REPORT_FORMATS.map((f) => ({ value: f, label: t(`scheduledReports.formats.${f}`) }))} />
        </div>
        <p className="text-xs text-ink-500">{t(`scheduledReports.periodHint.${frequency}`)}</p>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('scheduledReports.fields.recipients')}</legend>
          {members.isPending ? (
            <SkeletonRows rows={2} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {(members.data ?? [])
                .filter((m) => m.user.status === 'ACTIVE')
                .map((m) => (
                  <label key={m.user.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={chosen.has(m.user.id)} onChange={(e) => setRecipients(() => (e.target.checked ? new Set(chosen).add(m.user.id) : new Set([...chosen].filter((x) => x !== m.user.id))))} className="size-4 rounded accent-brand-600" />
                    <span dir="auto">{m.user.name}</span>
                    <span className="truncate text-xs text-ink-500">{m.user.email}</span>
                  </label>
                ))}
            </div>
          )}
          <p className="mt-2 text-xs text-ink-500">{t('scheduledReports.recipientsHint')}</p>
        </fieldset>
      </form>
    </Modal>
  );
}

function RunsDialog({ api, schedule, onClose }: { api: ScheduledReportsApi; schedule: ScheduledReport; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const runs = useQuery({ queryKey: ['scheduled-reports', 'runs', schedule.id], queryFn: () => api.runs(schedule.id) });
  return (
    <Modal open size="lg" onClose={onClose} title={t('scheduledReports.runsTitle', { name: schedule.name })}>
      {runs.isPending ? (
        <SkeletonRows rows={3} />
      ) : !runs.data?.length ? (
        <p className="text-sm text-ink-500">{t('scheduledReports.noRuns')}</p>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100 text-sm dark:divide-ink-800 dark:border-ink-800">
          {runs.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-xs" dir="ltr">
                  {r.fileName}
                </span>
                <span className="block text-xs text-ink-500">{[formatRelative(r.createdAt, locale), r.emailedTo.length ? t('scheduledReports.emailedTo', { count: r.emailedTo.length }) : t('scheduledReports.notEmailed'), r.error].filter(Boolean).join(' · ')}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={<Download className="size-4" />}
                aria-label={t('scheduledReports.download', { name: r.fileName })}
                onClick={async () => {
                  try {
                    const f = await api.file(r.id);
                    save(f.blob, f.filename);
                  } catch {
                    toast(t('scheduledReports.failed'), 'error');
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
