import { useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CalendarRange, Building2, History, Lock, LockOpen } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import { useToast } from '../../ui/toastContext';
import { periodErrorMessage } from '../errors';
import type { FiscalPeriod } from '../types';
import { usePeriodsApi } from '../usePeriodsApi';

const monthLabel = (startDate: string, locale: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${startDate}T00:00:00Z`));
const dayLabel = (d: string, locale: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

type Acting = { action: 'close' | 'reopen'; period: FiscalPeriod };

/** Financial years and their months: add years, close months in order, reopen the latest when a correction is needed. */
export default function FiscalYears() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = usePeriodsApi();
  const canClose = session.permissions.has('periods.close');
  const canReopen = session.permissions.has('periods.reopen');
  const key = ['periods', session.organizationId, session.role ?? session.customRoleName] as const;
  const query = useQuery({ queryKey: key, queryFn: () => api!.list(), enabled: !!api });
  const [acting, setActing] = useState<Acting | null>(null);

  const done = (message: string) => {
    toast(message);
    void queryClient.invalidateQueries({ queryKey: key });
    // The settings page shows the fiscal-year-start lock
    void queryClient.invalidateQueries({ queryKey: ['settings'] });
  };
  const addYear = useMutation({
    mutationFn: (startYear: number) => api!.createYear(startYear),
    onSuccess: (y) => done(t('periods.yearCreated', { name: y.name })),
    onError: (e) => toast(periodErrorMessage(e, t), 'error'),
  });
  const act = useMutation({
    mutationFn: ({ action, period, reason }: Acting & { reason?: string }) => (action === 'close' ? api!.close(period.id, reason) : api!.reopen(period.id, reason)),
    onSuccess: (_r, { action, period }) => {
      setActing(null);
      done(t(`periods.done.${action}`, { month: monthLabel(period.startDate, locale) }));
    },
    onError: (e) => {
      setActing(null);
      toast(periodErrorMessage(e, t), 'error');
    },
  });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }

  const data = query.data;
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('periods.title')}
          description={t('periods.description')}
          actions={
            canClose && data ? (
              <>
                {data.previous !== null && (
                  <Button variant="ghost" icon={<History className="size-4" />} loading={addYear.isPending && addYear.variables === data.previous} onClick={() => addYear.mutate(data.previous!)}>
                    {t('periods.addPrevious')}
                  </Button>
                )}
                <Button icon={<CalendarPlus className="size-4" />} loading={addYear.isPending && addYear.variables === data.next} onClick={() => addYear.mutate(data.next)}>
                  {data.years.length ? t('periods.addNext') : t('periods.addFirst')}
                </Button>
              </>
            ) : undefined
          }
        />
      </motion.div>

      {query.isPending ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : query.isError ? (
        <Card>
          <ErrorState onRetry={() => void query.refetch()} />
        </Card>
      ) : !data!.years.length ? (
        <motion.div variants={fadeUp}>
          <Card>
            <EmptyState icon={<CalendarRange className="size-5" />} title={t('periods.empty')} body={t('periods.emptyBody')} />
          </Card>
        </motion.div>
      ) : (
        data!.years.map((y) => (
          <motion.div key={y.id} variants={fadeUp}>
            <Card className="overflow-hidden">
              <header className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
                <h2 className="font-semibold">{y.name}</h2>
                <span className="text-sm text-ink-500">
                  {dayLabel(y.startDate, locale)} – {dayLabel(y.endDate, locale)}
                </span>
                {y.current && <Pill tone="brand">{t('periods.current')}</Pill>}
                {y.closed && <Pill>{t('periods.yearClosed')}</Pill>}
              </header>
              <ul className="grid gap-px bg-ink-100 sm:grid-cols-2 lg:grid-cols-3 dark:bg-ink-800">
                {y.periods.map((p) => (
                  <li key={p.id} className={clsx('flex items-center gap-3 bg-white px-4 py-3 dark:bg-ink-900', p.current && 'bg-brand-50/50 dark:bg-brand-900/10')}>
                    <span className={clsx('grid size-8 shrink-0 place-items-center rounded-full', p.status === 'closed' ? 'bg-ink-100 text-ink-500 dark:bg-ink-800' : 'bg-income/10 text-income')} aria-hidden>
                      {p.status === 'closed' ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{monthLabel(p.startDate, locale)}</span>
                      <span className="block truncate text-xs text-ink-500" title={p.closeReason ?? undefined}>
                        {p.status === 'closed' ? t('periods.closedBy', { name: p.closedBy?.name ?? '—' }) : p.current ? t('periods.currentMonth') : t('periods.open')}
                      </span>
                    </span>
                    {p.canClose && canClose && (
                      <Button size="sm" variant="secondary" onClick={() => setActing({ action: 'close', period: p })}>
                        {t('periods.close')}
                      </Button>
                    )}
                    {p.canReopen && canReopen && (
                      <Button size="sm" variant="ghost" onClick={() => setActing({ action: 'reopen', period: p })}>
                        {t('periods.reopen')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </motion.div>
        ))
      )}

      <ConfirmDialog
        open={!!acting}
        title={acting ? t(`periods.confirm.${acting.action}Title`, { month: monthLabel(acting.period.startDate, locale) }) : ''}
        body={acting ? t(`periods.confirm.${acting.action}Body`) : ''}
        confirmLabel={acting ? t(`periods.${acting.action}`) : ''}
        tone={acting?.action === 'reopen' ? 'danger' : 'primary'}
        askReason
        busy={act.isPending}
        onConfirm={(reason) => acting && act.mutate({ ...acting, reason })}
        onClose={() => setActing(null)}
      />
    </motion.div>
  );
}
