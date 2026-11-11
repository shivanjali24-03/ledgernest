import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ChevronDown, Clock, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { useMoney } from '../lib/useMoney';
import { Card, ErrorState, SkeletonRows } from '../ui/Kit';
import type { CashForecast } from './types';

const LINK: Record<string, (id: string) => string> = {
  invoice: (id) => `/invoices/${id}`,
  bill: (id) => `/bills/${id}`,
  recurring_invoice: () => '/recurring',
  recurring_bill: () => '/recurring-bills',
};

/**
 * Cash for the coming weeks: today's cash, the balance at the end of each week as bars from zero (below it when
 * cash would run short), a warning for the first short week, what each week holds, and the customers whose usual
 * lateness the forecast allows for.
 */
export default function CashForecastPanel({ data, isPending, isError, onRetry }: { data: CashForecast | undefined; isPending: boolean; isError: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (start: string) => setOpen((o) => { const n = new Set(o); if (n.has(start)) n.delete(start); else n.add(start); return n; });
  if (!data)
    return <Card>{isPending ? <SkeletonRows rows={6} /> : isError ? <ErrorState onRetry={onRetry} /> : null}</Card>;
  const day = (d: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const inflow = data.weeks.reduce((s, w) => s + w.inflow, 0);
  const outflow = data.weeks.reduce((s, w) => s + w.outflow, 0);
  const end = data.weeks.at(-1)?.closing ?? data.opening;
  const max = Math.max(1, ...data.weeks.map((w) => Math.abs(w.closing)));
  const hasNegative = data.weeks.some((w) => w.closing < 0);
  const tiles = [
    { key: 'today', icon: Wallet, value: data.opening, label: t('reports.forecast.cashToday') },
    { key: 'in', icon: TrendingUp, value: inflow, label: t('reports.forecast.comingIn', { weeks: data.weeks.length }) },
    { key: 'out', icon: TrendingDown, value: -outflow, label: t('reports.forecast.goingOut', { weeks: data.weeks.length }) },
    { key: 'lowest', icon: AlertTriangle, value: data.lowest.balance, label: t('reports.forecast.lowest', { date: day(data.lowest.start) }) },
  ];

  return (
    <div className="space-y-4">
      {data.shortfall ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-expense/10 px-4 py-3 text-sm text-expense">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">{t('reports.forecast.shortfall', { date: day(data.shortfall.start), amount: money.format(data.shortfall.balance) })}</span> {t('reports.forecast.shortfallHint')}
          </span>
        </p>
      ) : (
        <p className="rounded-xl bg-income/10 px-4 py-3 text-sm text-income">{t('reports.forecast.noShortfall', { weeks: data.weeks.length, amount: money.format(end) })}</p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(({ key, icon: Icon, value, label }) => (
          <Card key={key} className="p-4">
            <p className="flex items-center gap-1.5 text-sm text-ink-500">
              <Icon className="size-4" aria-hidden /> {label}
            </p>
            <p className={clsx('mt-1 text-xl font-semibold tabular-nums', value < 0 && 'text-expense')} dir="ltr">
              {money.format(value)}
            </p>
          </Card>
        ))}
      </div>

      <Card className="p-4 sm:p-5">
        <h3 className="font-semibold">{t('reports.forecast.chartTitle')}</h3>
        <p className="mb-4 text-xs text-ink-500">{t('reports.forecast.chartHint')}</p>
        <figure>
          <div className="relative flex h-44 items-stretch gap-1" aria-hidden>
            {data.weeks.map((w) => {
              const h = (Math.abs(w.closing) / max) * (hasNegative ? 50 : 100);
              return (
                <div key={w.start} className="group relative flex flex-1 flex-col">
                  <div className="flex flex-1 flex-col justify-end" style={hasNegative ? { flexBasis: '50%' } : undefined}>
                    {w.closing > 0 && <div className="rounded-t bg-income/70 group-hover:bg-income" style={{ height: `${hasNegative ? h * 2 : h}%` }} />}
                  </div>
                  {hasNegative && <div className="flex flex-1 flex-col justify-start">{w.closing < 0 && <div className="rounded-b bg-expense/70 group-hover:bg-expense" style={{ height: `${h * 2}%` }} />}</div>}
                  <span className="pointer-events-none absolute -top-14 start-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-xs text-white shadow group-hover:block rtl:translate-x-1/2 dark:bg-ink-100 dark:text-ink-900">
                    {t('reports.forecast.weekOf', { date: day(w.start) })}
                    <br />+{money.format(w.inflow)} · −{money.format(w.outflow)}
                    <br />
                    {t('reports.forecast.endsAt', { amount: money.format(w.closing) })}
                  </span>
                </div>
              );
            })}
            {hasNegative && <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-ink-300 dark:border-ink-600" />}
          </div>
          <div className="mt-1.5 flex gap-1 text-center text-[10px] text-ink-500" aria-hidden>
            {data.weeks.map((w, n) => (
              <span key={w.start} className="flex-1 truncate">
                {n % 2 === 0 ? day(w.start) : ''}
              </span>
            ))}
          </div>
        </figure>
      </Card>

      <Card className="overflow-hidden">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">{t('reports.forecast.tableTitle')}</caption>
            <thead className="text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th scope="col" className="px-4 py-2 text-start font-semibold">
                  {t('reports.forecast.cols.week')}
                </th>
                <th scope="col" className="px-4 py-2 text-end font-semibold">
                  {t('reports.forecast.cols.in')}
                </th>
                <th scope="col" className="px-4 py-2 text-end font-semibold">
                  {t('reports.forecast.cols.out')}
                </th>
                <th scope="col" className="px-4 py-2 text-end font-semibold">
                  {t('reports.forecast.cols.balance')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {data.weeks.map((w) => (
                <Fragment key={w.start}>
                  <tr>
                    <th scope="row" className="px-4 py-2 text-start font-normal">
                      {w.items.length ? (
                        <button type="button" aria-expanded={open.has(w.start)} onClick={() => toggle(w.start)} className="inline-flex items-center gap-1 hover:underline">
                          <ChevronDown className={clsx('size-3.5 transition-transform', !open.has(w.start) && '-rotate-90 rtl:rotate-90')} aria-hidden />
                          {day(w.start)} – {day(w.end)}
                          <span className="text-xs text-ink-500">({w.items.length})</span>
                        </button>
                      ) : (
                        <span className="ps-[18px]">
                          {day(w.start)} – {day(w.end)}
                        </span>
                      )}
                    </th>
                    <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                      {w.inflow ? money.plain(w.inflow) : '–'}
                    </td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">
                      {w.outflow ? money.plain(w.outflow) : '–'}
                    </td>
                    <td className={clsx('px-4 py-2 text-end font-mono font-medium tabular-nums', w.closing < 0 && 'text-expense')} dir="ltr">
                      {money.plain(w.closing)}
                    </td>
                  </tr>
                  {open.has(w.start) &&
                    w.items.map((x, n) => (
                      <tr key={`${x.id}-${n}`} className="bg-ink-50/60 text-xs dark:bg-ink-800/40">
                        <td className="px-4 py-1.5 ps-10">
                          <Link to={LINK[x.kind]!(x.id)} className="font-medium hover:underline" dir="auto">
                            {x.label}
                          </Link>{' '}
                          · <span dir="auto">{x.contact.name}</span> · {t(`reports.forecast.kinds.${x.kind}`)} · {day(x.expected)}
                          {x.lateDays ? <span className="text-ink-500"> · {t('reports.forecast.late', { count: x.lateDays })}</span> : null}
                        </td>
                        <td className="px-4 py-1.5 text-end font-mono tabular-nums" dir="ltr">
                          {x.amount > 0 ? money.plain(x.amount) : ''}
                        </td>
                        <td className="px-4 py-1.5 text-end font-mono tabular-nums" dir="ltr">
                          {x.amount < 0 ? money.plain(-x.amount) : ''}
                        </td>
                        <td />
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {data.lateCustomers.length > 0 && (
        <Card className="p-4">
          <h3 className="flex items-center gap-1.5 font-semibold">
            <Clock className="size-4" aria-hidden /> {t('reports.forecast.lateTitle')}
          </h3>
          <p className="mb-2 text-xs text-ink-500">{t('reports.forecast.lateHint')}</p>
          <ul className="divide-y divide-ink-100 text-sm dark:divide-ink-800">
            {data.lateCustomers.map((c) => (
              <li key={c.contact.id} className="flex justify-between gap-4 py-1.5">
                <Link to={`/contacts/${c.contact.id}`} className="hover:underline" dir="auto">
                  {c.contact.name}
                </Link>
                <span className="text-ink-600 dark:text-ink-300">{t('reports.forecast.late', { count: c.days })}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
