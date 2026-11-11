import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronRight, Circle } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../lib/useMoney';
import { useSession } from '../layout/session';
import { fadeUp, stagger } from '../motion/tokens';
import { usePeriodsApi } from '../periods/usePeriodsApi';
import { useBankingApi } from '../banking/useBankingApi';
import { useIntlLocale } from '../i18n';
import { formatDate } from '../lib/format';
import { useReportsApi } from '../reports/useReportsApi';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import { SelectField } from '../ui/Field';
import { Card, EmptyState, PageHeader, SkeletonRows } from '../ui/Kit';

type Status = 'done' | 'attention' | 'todo' | 'loading';
interface Step {
  key: string;
  status: Status;
  detail: string;
  to: string;
}

/**
 * Closing a financial year (in India, the March close), in order: the bank reconciled, no entries left in draft,
 * balance confirmations asked and answered for the auditor, MSME bills paid in time for 43B(h), GST details clean,
 * the months closed, and a backup kept. Each step says where it stands and links to where it's done.
 */
export default function YearEnd() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const day = (d: string) => (d ? formatDate(`${d}T00:00:00Z`, locale) : '');
  const money = useMoney();
  const session = useSession();
  const reports = useReportsApi();
  const periods = usePeriodsApi();
  const india = useOrganizationSettings().data?.country === 'IN';
  const key = ['reports', session.organizationId, 'year-end'];
  const years = useQuery({ queryKey: ['periods', session.organizationId], queryFn: () => periods!.list(), enabled: !!periods });
  const all = years.data?.years ?? [];
  // The year to close: the latest that has ended, else this one
  const fallback = [...all].reverse().find((y) => y.endDate < (years.data?.today ?? '')) ?? all.find((y) => y.current) ?? all[all.length - 1];
  const [chosen, setChosen] = useState<string | null>(null);
  const year = all.find((y) => y.id === chosen) ?? fallback;
  const end = year?.endDate ?? '';
  const on = !!reports && !!year;
  const dashboard = useQuery({ queryKey: [...key, 'dashboard'], queryFn: () => reports!.dashboard(), enabled: !!reports });
  const receivable = useQuery({ queryKey: [...key, 'confirm', end, 'receivable'], queryFn: () => reports!.confirmations(end, 'receivable'), enabled: on });
  const payable = useQuery({ queryKey: [...key, 'confirm', end, 'payable'], queryFn: () => reports!.confirmations(end, 'payable'), enabled: on });
  const msme = useQuery({ queryKey: [...key, 'msme', end], queryFn: () => reports!.msme(end), enabled: on && india });
  const gst = useQuery({ queryKey: [...key, 'gst-health'], queryFn: () => reports!.gstHealth(), enabled: !!reports && india });
  // Each bank account reconciled to a statement dated at or after the year end; none counts as done without one
  const banking = useBankingApi();
  const banks = useQuery({
    queryKey: [...key, 'bank-reconciled', end],
    queryFn: async () => {
      const accounts = (await banking!.accounts()).filter((a) => a.subtype === 'bank' && !a.archived && !a.hasChildren);
      const work = await Promise.all(accounts.map((a) => banking!.reconcileWorkspace(a.id, end)));
      return { total: accounts.length, behind: work.filter((w) => !w.lastReconciliation || w.lastReconciliation.statementDate < end).length };
    },
    enabled: on && !!banking,
  });

  if (years.data && !all.length)
    return (
      <div className="space-y-6">
        <PageHeader eyebrow={<span dir="auto">{session.organization}</span>} title={t('yearEnd.title')} description={t('yearEnd.description')} />
        <Card>
          <EmptyState
            icon={<CheckCircle2 className="size-5" />}
            title={t('yearEnd.noYears')}
            action={
              <Link to="/periods" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
                {t('nav.items.periods')}
                <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Link>
            }
          />
        </Card>
      </div>
    );
  const alert = (kind: string) => dashboard.data?.alerts.find((a) => a.kind === kind)?.count ?? 0;
  const confirmations = [...(receivable.data ?? []), ...(payable.data ?? [])];
  const waiting = confirmations.filter((c) => c.status === 'pending').length;
  const disputed = confirmations.filter((c) => c.status === 'disputed').length;
  const openMonths = year?.periods.filter((p) => p.status === 'open').length ?? 0;
  const steps: Step[] = [
    {
      key: 'bank',
      status: !dashboard.data || (banking && !banks.data) ? 'loading' : alert('unreconciled') ? 'attention' : banks.data?.behind ? 'todo' : 'done',
      detail: alert('unreconciled')
        ? t('yearEnd.details.bank', { count: alert('unreconciled') })
        : banks.data?.behind
          ? t('yearEnd.details.bankNotReconciled', { count: banks.data.behind, date: day(end) })
          : t('yearEnd.details.bankDone'),
      to: '/banking',
    },
    {
      key: 'drafts',
      status: !dashboard.data ? 'loading' : alert('draft_entries') ? 'attention' : 'done',
      detail: alert('draft_entries') ? t('yearEnd.details.drafts', { count: alert('draft_entries') }) : t('yearEnd.details.draftsDone'),
      to: '/journals',
    },
    {
      key: 'confirmations',
      status: !receivable.data || !payable.data ? 'loading' : !confirmations.length ? 'todo' : waiting || disputed ? 'attention' : 'done',
      detail: !confirmations.length ? t('yearEnd.details.confirmationsNone') : t('yearEnd.details.confirmations', { asked: confirmations.length, waiting, disputed }),
      to: `/reports?tab=confirmations&asOf=${end}`,
    },
    ...(india
      ? [
          {
            key: 'msme',
            status: (!msme.data ? 'loading' : msme.data.totals.disallowed ? 'attention' : 'done') as Status,
            detail: msme.data?.totals.disallowed ? t('yearEnd.details.msme', { amount: money.format(msme.data.totals.disallowed) }) : t('yearEnd.details.msmeDone'),
            to: `/reports?tab=msme&asOf=${end}`,
          },
          {
            key: 'gst',
            status: (!gst.data ? 'loading' : gst.data.issues.length ? 'attention' : 'done') as Status,
            detail: gst.data?.issues.length ? t('yearEnd.details.gst', { count: gst.data.issues.reduce((s, i) => s + i.count, 0) }) : t('yearEnd.details.gstDone'),
            to: '/reports?tab=gst&return=health',
          },
        ]
      : []),
    {
      key: 'close',
      status: !year ? 'loading' : openMonths ? 'todo' : 'done',
      detail: openMonths ? t('yearEnd.details.close', { count: openMonths }) : year?.closingEntry ? t('yearEnd.details.closeDone', { number: year.closingEntry.number }) : t('yearEnd.details.closed'),
      to: '/periods',
    },
    { key: 'backup', status: 'todo', detail: t('yearEnd.details.backup'), to: '/settings' },
  ];
  const done = steps.filter((s) => s.status === 'done').length;
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader eyebrow={<span dir="auto">{session.organization}</span>} title={t('yearEnd.title')} description={t('yearEnd.description')} />
      </motion.div>
      <motion.div variants={fadeUp} className="flex flex-wrap items-end gap-4">
        {all.length > 1 && (
          <div className="w-56">
            <SelectField label={t('yearEnd.year')} value={year?.id ?? ''} onChange={(e) => setChosen(e.target.value)} options={all.map((y) => ({ value: y.id, label: y.name }))} />
          </div>
        )}
        {year && <p className="pb-2 text-sm text-ink-500">{t('yearEnd.progress', { done, total: steps.length, year: year.name })}</p>}
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card>
          {!year ? (
            <SkeletonRows rows={6} />
          ) : (
            <ol className="divide-y divide-ink-100 dark:divide-ink-800" aria-label={t('yearEnd.title')}>
              {steps.map((s, n) => (
                <li key={s.key}>
                  <Link to={s.to} className="flex items-center gap-3 px-5 py-4 hover:bg-ink-50 dark:hover:bg-ink-900" data-status={s.status}>
                    {s.status === 'done' ? <CheckCircle2 className="size-5 shrink-0 text-income" aria-hidden /> : s.status === 'attention' ? <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden /> : <Circle className={clsx('size-5 shrink-0 text-ink-300', s.status === 'loading' && 'animate-pulse')} aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {n + 1}. {t(`yearEnd.steps.${s.key}`)}
                        <span className="sr-only"> ({t(`yearEnd.status.${s.status}`)})</span>
                      </span>
                      <span className="block text-sm text-ink-500">{s.status === 'loading' ? '…' : s.detail}</span>
                    </span>
                    <ChevronRight className="size-4 text-ink-400 rtl:-scale-x-100" aria-hidden />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </motion.div>
    </motion.div>
  );
}
