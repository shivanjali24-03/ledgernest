import { Link } from 'react-router';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight, Circle } from 'lucide-react';
import clsx from 'clsx';
import AnimatedNumber from '../motion/AnimatedNumber';
import { fadeUp, stagger } from '../motion/tokens';
import { formatCompactMoney, formatPercent } from '../lib/format';
import { roleLabel, useSession } from '../layout/session';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { useMoney } from '../lib/useMoney';
import { useReportsApi } from '../reports/useReportsApi';
import type { Dashboard as DashboardData } from '../reports/types';
import { SkeletonRows } from '../ui/Kit';

/** Tiny line chart; the line draws itself in (stroke animation, no layout). */
function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const d = points.map((p, i) => `${(i / Math.max(points.length - 1, 1)) * 100},${30 - ((p - min) / (max - min || 1)) * 26 - 2}`).join(' L');
  return (
    <svg viewBox="0 0 100 30" className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <motion.path d={`M${d}`} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className={up ? 'stroke-income' : 'stroke-expense'} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }} />
    </svg>
  );
}

/**
 * Profit by month for a year: bars up for profit and down for loss from a zero line, each with its figure on
 * hover, and the same figures as a table for screen readers.
 */
function ProfitChart({ monthly }: { monthly: DashboardData['monthly'] }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const max = Math.max(1, ...monthly.map((m) => Math.abs(m.profit)));
  const hasLoss = monthly.some((m) => m.profit < 0);
  const label = (month: string) => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  return (
    <figure>
      <div className={clsx('relative flex h-40 items-stretch gap-1.5', hasLoss && 'pb-0')} aria-hidden>
        {monthly.map((m) => {
          const h = (Math.abs(m.profit) / max) * (hasLoss ? 50 : 100);
          return (
            <div key={m.month} className="group relative flex flex-1 flex-col">
              <div className={clsx('flex flex-1 flex-col justify-end', !hasLoss && 'h-full')} style={hasLoss ? { flexBasis: '50%' } : undefined}>
                {m.profit > 0 && <div className="rounded-t bg-income/80 group-hover:bg-income" style={{ height: `${hasLoss ? h * 2 : h}%` }} />}
              </div>
              {hasLoss && <div className="flex flex-1 flex-col justify-start">{m.profit < 0 && <div className="rounded-b bg-expense/80 group-hover:bg-expense" style={{ height: `${h * 2}%` }} />}</div>}
              <span className="pointer-events-none absolute -top-7 start-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-xs text-white shadow group-hover:block rtl:translate-x-1/2 dark:bg-ink-100 dark:text-ink-900">
                {label(m.month)}: {money.format(m.profit)}
              </span>
            </div>
          );
        })}
        {hasLoss && <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-ink-300 dark:border-ink-600" />}
      </div>
      <div className="mt-1.5 flex gap-1.5 text-center text-[11px] text-ink-500" aria-hidden>
        {monthly.map((m) => (
          <span key={m.month} className="flex-1 truncate">
            {label(m.month)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{t('dashboard.profitByMonth')}</caption>
        <tbody>
          {monthly.map((m) => (
            <tr key={m.month}>
              <th scope="row">{label(m.month)}</th>
              <td>{money.format(m.profit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const ALERT_LINKS: Record<DashboardData['alerts'][number]['kind'], string> = {
  overdue_invoices: '/invoices',
  overdue_bills: '/bills',
  unreconciled: '/banking',
  recurring_due: '/recurring',
  open_periods: '/fiscal-years',
  draft_entries: '/journals',
  approvals_waiting: '/approvals',
  low_stock: '/inventory',
  quotes_expiring: '/quotes?state=open',
  recurring_bills_due: '/recurring-bills',
  bills_due_soon: '/bills?state=unpaid',
};

export default function Dashboard() {
  const session = useSession();
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const api = useReportsApi();
  const canRead = session.permissions.has('reports.view');
  const query = useQuery({ queryKey: ['reports', session.organizationId, session.role ?? session.customRoleName, 'dashboard'], queryFn: () => api!.dashboard(), enabled: !!api && canRead });
  const data = query.data;
  const firstName = session.name.split(' ')[0];
  const setup = data ? (['organisation', 'team', 'coa', 'fiscal', 'bank'] as const).map((k) => ({ key: k, done: data.setup[k] })) : [];
  const done = setup.filter((s) => s.done).length;
  const kpis = data
    ? ([
        ['cash', data.kpis.cash, false],
        ['receivables', data.kpis.receivables, false],
        ['payables', data.kpis.payables, true],
        ['profit', data.kpis.profit, false],
      ] as const)
    : [];

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.header variants={fadeUp} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand-700 dark:text-brand-300">{t('dashboard.roleView', { role: roleLabel(session, t) })}</p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('dashboard.greeting', { name: firstName })}</h1>
        </div>
      </motion.header>

      {canRead && api && !data && (query.isPending ? <SkeletonRows rows={4} /> : null)}

      {data && (
        <>
          <motion.section variants={stagger(0.07)} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('dashboard.keyFigures')}>
            {kpis.map(([key, k, higherIsWorse]) => {
              const change = k.previous ? (k.value - k.previous) / Math.abs(k.previous) : null;
              const rising = k.value >= k.previous;
              const good = higherIsWorse ? !rising : rising;
              return (
                <motion.article key={key} variants={fadeUp} className="lift rounded-card border border-ink-200 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900" aria-label={t(`dashboard.kpi.${key}`)}>
                  <p className="text-sm text-ink-500">{t(`dashboard.kpi.${key}`)}</p>
                  <p className={clsx('mt-1 text-2xl font-bold tracking-tight', k.value < 0 && 'text-expense')}>
                    <AnimatedNumber value={k.value} format={(n) => formatCompactMoney(Math.round(n), data.baseCurrency, locale)} />
                  </p>
                  <p className={clsx('mt-1 inline-flex items-center gap-1 text-xs font-semibold', k.value === k.previous ? 'text-ink-500' : good ? 'text-income' : 'text-expense')}>
                    {rising ? <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden /> : <ArrowDownRight className="size-3.5 rtl:-scale-x-100" aria-hidden />}
                    {change === null ? t('dashboard.vsLastMonthAmount', { value: money.format(k.value - k.previous) }) : t('dashboard.vsLastMonth', { value: formatPercent(change, locale) })}
                  </p>
                  <Sparkline points={k.trend} up={good} />
                </motion.article>
              );
            })}
          </motion.section>

          <motion.div variants={fadeUp} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section className="rounded-card border border-ink-200 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900" aria-labelledby="profit-title">
              <h2 id="profit-title" className="text-lg font-semibold">
                {t('dashboard.profitByMonth')}
              </h2>
              <p className="mb-6 text-sm text-ink-500">{t('dashboard.profitHint')}</p>
              <ProfitChart monthly={data.monthly} />
            </section>
            <section className="rounded-card border border-ink-200 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900" aria-labelledby="alerts-title">
              <h2 id="alerts-title" className="text-lg font-semibold">
                {t('dashboard.attention')}
              </h2>
              {!data.alerts.length ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-income">
                  <CheckCircle2 className="size-4" aria-hidden /> {t('dashboard.allClear')}
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-ink-100 dark:divide-ink-800">
                  {data.alerts.map((a) => (
                    <li key={a.kind}>
                      <Link to={ALERT_LINKS[a.kind]} className="flex items-center gap-3 py-2.5 text-sm hover:text-brand-700 dark:hover:text-brand-300">
                        <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                        <span className="flex-1">{t(`dashboard.alerts.${a.kind}`, { count: a.count, amount: a.amount === undefined ? '' : money.format(a.amount) })}</span>
                        <ChevronRight className="size-4 text-ink-400 rtl:-scale-x-100" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </motion.div>

          {done < setup.length && (
            <motion.section variants={fadeUp} className="rounded-card border border-ink-200 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900" aria-labelledby="setup-title">
              <div className="flex items-center justify-between">
                <h2 id="setup-title" className="text-lg font-semibold">
                  {t('dashboard.setupTitle')}
                </h2>
                <span className="text-sm text-ink-500">{t('dashboard.setupProgress', { done, total: setup.length })}</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                <motion.div className="h-full origin-left rounded-full bg-gradient-to-r from-brand-400 to-brand-600 rtl:origin-right" initial={{ scaleX: 0 }} animate={{ scaleX: done / setup.length }} transition={{ type: 'spring', stiffness: 120, damping: 22 }} />
              </div>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {setup.map((s) => (
                  <li key={s.key} className="flex items-center gap-2.5 text-sm">
                    {s.done ? <CheckCircle2 className="size-5 text-income" aria-hidden /> : <Circle className="size-5 text-ink-300" aria-hidden />}
                    <span className={clsx(s.done && 'text-ink-400 line-through')}>{t(`dashboard.setup.${s.key}`)}</span>
                  </li>
                ))}
              </ul>
            </motion.section>
          )}
        </>
      )}
    </motion.div>
  );
}
