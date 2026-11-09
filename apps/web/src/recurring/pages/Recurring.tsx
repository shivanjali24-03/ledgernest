import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, Pause, Pencil, Play, Plus, Repeat, Trash2, Zap } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate, formatMoney } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import RecurringDialog from '../RecurringDialog';
import { recurringErrorMessage } from '../errors';
import type { RecurringSchedule } from '../types';
import { useRecurringApi } from '../useRecurringApi';

/** Invoices that repeat: the schedules, and what they'll raise over the next month. */
export default function Recurring() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useRecurringApi();
  const canManage = session.permissions.has('invoices.manage');
  const [editing, setEditing] = useState<RecurringSchedule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RecurringSchedule | null>(null);
  const key = ['recurring', session.organizationId, session.role ?? session.customRoleName] as const;
  const list = useQuery({ queryKey: [...key, 'list'], queryFn: () => api!.list(), enabled: !!api });
  const upcoming = useQuery({ queryKey: [...key, 'upcoming'], queryFn: () => api!.upcoming(30), enabled: !!api });
  const refresh = () => {
    for (const k of ['recurring', 'invoices', 'contacts', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
  };
  const run = useMutation({
    mutationFn: () => api!.run(),
    onSuccess: (r) => {
      refresh();
      toast(r.failed.length ? t('recurring.ranWithFailures', { raised: r.raised.length, failed: r.failed.length }) : t('recurring.ran', { raised: r.raised.length }), r.failed.length ? 'error' : undefined);
    },
    onError: (e) => toast(recurringErrorMessage(e, t), 'error'),
  });
  const pause = useMutation({
    mutationFn: ({ s, paused }: { s: RecurringSchedule; paused: boolean }) => api!.setPaused(s.id, paused),
    onSuccess: (s) => {
      refresh();
      toast(t(s.status === 'paused' ? 'recurring.paused' : 'recurring.resumed', { name: s.name }));
    },
    onError: (e) => toast(recurringErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: (s: RecurringSchedule) => api!.remove(s.id),
    onSuccess: (_r, s) => {
      setDeleting(null);
      refresh();
      toast(t('recurring.deleted', { name: s.name }));
    },
    onError: (e) => {
      setDeleting(null);
      toast(recurringErrorMessage(e, t), 'error');
    },
  });
  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const amount = (minor: number, currency: string | null) => (currency ? formatMoney(minor, currency, locale) : money.format(minor));
  const howOften = (s: RecurringSchedule) => (s.interval === 1 ? t(`recurring.frequencies.${s.frequency}`) : t(`recurring.every.${s.frequency}`, { n: s.interval }));
  const due = (upcoming.data ?? []).filter((u) => u.overdue).length;

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('recurring.title')}
          description={t('recurring.description')}
          actions={
            canManage ? (
              <>
                <Button variant="secondary" icon={<Zap className="size-4" />} loading={run.isPending} onClick={() => run.mutate()}>
                  {t('recurring.runNow')}
                </Button>
                <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                  {t('recurring.new')}
                </Button>
              </>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden">
          {list.isPending ? (
            <SkeletonRows rows={4} />
          ) : list.isError ? (
            <ErrorState onRetry={() => void list.refetch()} />
          ) : !list.data!.length ? (
            <EmptyState icon={<Repeat className="size-5" />} title={t('recurring.empty')} body={t('recurring.emptyBody')} />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {list.data!.map((s) => (
                <li key={s.id} className={clsx('flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3', s.status !== 'active' && 'opacity-70')}>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" dir="auto">
                        {s.name}
                      </span>
                      <Pill tone={s.status === 'active' ? 'brand' : 'neutral'}>{t(`recurring.statuses.${s.status}`)}</Pill>
                      {s.autoIssue && <Pill>{t('recurring.issuesItself')}</Pill>}
                    </span>
                    <span className="block text-sm text-ink-500">
                      <span dir="auto">{s.contact.name}</span> · {howOften(s)} · {s.nextDate ? t('recurring.nextOn', { date: day(s.nextDate) }) : t('recurring.noMore')} · {s.maxCount ? t('recurring.countOf', { count: s.count, max: s.maxCount }) : t('recurring.countSoFar', { count: s.count })}
                    </span>
                    {s.lastError && (
                      <span className="mt-1 flex items-start gap-1.5 text-xs text-expense">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('recurring.lastError', { reason: s.lastError })}
                      </span>
                    )}
                    {s.invoices.length > 0 && (
                      <span className="block text-xs text-ink-500">
                        {t('recurring.raised')}{' '}
                        {s.invoices.slice(0, 4).map((i, n) => (
                          <span key={i.id}>
                            {n > 0 && ', '}
                            <Link to={`/invoices/${i.id}`} className="font-mono hover:underline" dir="ltr">
                              {i.number ?? t('invoices.draft')}
                            </Link>
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  {canManage && (
                    <RowMenu
                      label={t('recurring.actionsFor', { name: s.name })}
                      items={[
                        { key: 'edit', label: t('recurring.edit'), icon: Pencil, onSelect: () => setEditing(s) },
                        ...(s.status === 'active' ? [{ key: 'pause', label: t('recurring.pause'), icon: Pause, onSelect: () => pause.mutate({ s, paused: true }) }] : s.status === 'paused' ? [{ key: 'resume', label: t('recurring.resume'), icon: Play, onSelect: () => pause.mutate({ s, paused: false }) }] : []),
                        ...(s.count === 0 ? [{ key: 'delete', label: t('recurring.delete'), icon: Trash2, danger: true, onSelect: () => setDeleting(s) }] : []),
                      ]}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="self-start p-5">
          <h2 className="font-semibold">{t('recurring.upcoming')}</h2>
          <p className="mt-0.5 text-sm text-ink-500">{due ? t('recurring.dueNow', { count: due }) : t('recurring.upcomingHint')}</p>
          {upcoming.data && !upcoming.data.length ? (
            <p className="mt-4 text-sm text-ink-500">{t('recurring.nothingComing')}</p>
          ) : (
            <ol className="mt-3 space-y-2 text-sm">
              {(upcoming.data ?? []).slice(0, 12).map((u) => (
                <li key={`${u.scheduleId}-${u.date}`} className="flex items-baseline gap-3">
                  <span className={clsx('w-24 shrink-0', u.overdue ? 'font-medium text-expense' : 'text-ink-500')}>{day(u.date)}</span>
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {u.contact.name}
                  </span>
                  <span className="font-mono tabular-nums" dir="ltr">
                    {amount(u.total, u.currency)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </motion.div>
      {editing && <RecurringDialog api={api} schedule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} title={deleting ? t('recurring.deleteTitle', { name: deleting.name }) : ''} body={t('recurring.deleteBody')} confirmLabel={t('recurring.delete')} tone="danger" busy={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting)} onClose={() => setDeleting(null)} />
    </motion.div>
  );
}
