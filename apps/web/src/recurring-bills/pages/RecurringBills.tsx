import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, Pause, Pencil, Play, Repeat, Trash2, Zap } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { recurringErrorMessage } from '../../recurring/errors';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import RecurringBillDialog from '../RecurringBillDialog';
import type { RecurringBillSchedule } from '../types';
import { useRecurringBillsApi } from '../useRecurringBillsApi';

/** Bills that repeat (rent, subscriptions): the schedules, made into bills as they fall due. Started from a bill's "Make recurring". */
export default function RecurringBills() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useRecurringBillsApi();
  const canManage = session.permissions.has('bills.manage');
  const [editing, setEditing] = useState<RecurringBillSchedule | null>(null);
  const [deleting, setDeleting] = useState<RecurringBillSchedule | null>(null);
  const list = useQuery({ queryKey: ['recurring-bills', session.organizationId, session.role ?? session.customRoleName], queryFn: () => api!.list(), enabled: !!api });
  const refresh = () => {
    for (const k of ['recurring-bills', 'bills', 'contacts', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
  };
  const run = useMutation({
    mutationFn: () => api!.run(),
    onSuccess: (r) => {
      refresh();
      toast(r.failed.length ? t('recurringBills.ranWithFailures', { made: r.made.length, failed: r.failed.length }) : t('recurringBills.ran', { made: r.made.length }), r.failed.length ? 'error' : undefined);
    },
    onError: (e) => toast(recurringErrorMessage(e, t), 'error'),
  });
  const pause = useMutation({
    mutationFn: ({ s, paused }: { s: RecurringBillSchedule; paused: boolean }) => api!.setPaused(s.id, paused),
    onSuccess: (s) => {
      refresh();
      toast(t(s.status === 'paused' ? 'recurring.paused' : 'recurring.resumed', { name: s.name }));
    },
    onError: (e) => toast(recurringErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: (s: RecurringBillSchedule) => api!.remove(s.id),
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
  const howOften = (s: RecurringBillSchedule) => (s.interval === 1 ? t(`recurring.frequencies.${s.frequency}`) : t(`recurring.every.${s.frequency}`, { n: s.interval }));

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('recurringBills.title')}
          description={t('recurringBills.description')}
          actions={
            canManage ? (
              <Button variant="secondary" icon={<Zap className="size-4" />} loading={run.isPending} disabled={!list.data?.some((x) => x.status === 'active')} onClick={() => run.mutate()}>
                {t('recurring.runNow')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {list.isPending ? (
            <SkeletonRows rows={4} />
          ) : list.isError ? (
            <ErrorState onRetry={() => void list.refetch()} />
          ) : !list.data!.length ? (
            <EmptyState icon={<Repeat className="size-5" />} title={t('recurringBills.empty')} body={t('recurringBills.emptyBody')} />
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
                      {s.autoRecord && <Pill>{t('recurringBills.recordsItself')}</Pill>}
                    </span>
                    <span className="block text-sm text-ink-500">
                      <span dir="auto">{s.contact.name}</span> · {howOften(s)} · {s.nextDate ? t('recurring.nextOn', { date: day(s.nextDate) }) : t('recurring.noMore')} · {s.maxCount ? t('recurring.countOf', { count: s.count, max: s.maxCount }) : t('recurring.countSoFar', { count: s.count })}
                    </span>
                    {s.lastError && (
                      <span className="mt-1 flex items-start gap-1.5 text-xs text-expense">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('recurring.lastError', { reason: s.lastError })}
                      </span>
                    )}
                    {s.bills.length > 0 && (
                      <span className="block text-xs text-ink-500">
                        {t('recurringBills.made')}{' '}
                        {s.bills.slice(0, 4).map((b, n) => (
                          <span key={b.id}>
                            {n > 0 && ', '}
                            <Link to={`/bills/${b.id}`} className="font-mono hover:underline" dir="ltr">
                              {b.number ?? `${t('invoices.draft')} ${day(b.billDate)}`}
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
      </motion.div>
      {editing && <RecurringBillDialog api={api} schedule={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} title={deleting ? t('recurring.deleteTitle', { name: deleting.name }) : ''} body={t('recurringBills.deleteBody')} confirmLabel={t('recurring.delete')} tone="danger" busy={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting)} onClose={() => setDeleting(null)} />
    </motion.div>
  );
}
