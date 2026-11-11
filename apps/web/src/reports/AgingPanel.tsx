import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Hourglass } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatDate, formatMoney } from '../lib/format';
import { useMoney } from '../lib/useMoney';
import { Card, EmptyState, ErrorState, SkeletonRows } from '../ui/Kit';
import type { Aging } from './types';

const th = 'px-4 py-2.5 font-semibold';
const num = 'px-4 py-2 text-end font-mono tabular-nums';

/** Receivables or payables by days past due: totals per bucket, a row per contact, and each contact's documents on demand. */
export default function AgingPanel({ data, isPending, isError, onRetry }: { data: Aging | undefined; isPending: boolean; isError: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (isPending)
    return (
      <Card>
        <SkeletonRows rows={6} />
      </Card>
    );
  if (isError || !data)
    return (
      <Card>
        <ErrorState onRetry={onRetry} />
      </Card>
    );
  if (!data.contacts.length)
    return (
      <Card>
        <EmptyState icon={<Hourglass className="size-5" />} title={t(`reports.aging.empty.${data.side}`)} body={t('reports.aging.emptyBody')} />
      </Card>
    );
  const receivables = data.side === 'receivables';
  const hasAdvances = data.contacts.some((c) => c.advance);
  const docLink = (id: string) => `/${receivables ? 'invoices' : 'bills'}/${id}`;
  const toggle = (key: string) => setOpen((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key])));
  const cell = (minor: number, currency: string | null) => (minor ? (currency ? formatMoney(minor, currency, locale) : money.plain(minor)) : '–');
  const late = (bucket: string) => bucket === 'd61_90' || bucket === 'over_90';

  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {data.buckets.map((b) => (
          <Card key={b} className="p-4">
            <dt className="text-xs text-ink-500">{t(`reports.aging.buckets.${b}`)}</dt>
            <dd className={clsx('mt-1 font-mono text-lg font-semibold tabular-nums', data.totals.buckets[b] && late(b) && 'text-expense')} dir="ltr">
              {money.format(data.totals.buckets[b])}
            </dd>
          </Card>
        ))}
        <Card className="p-4">
          <dt className="text-xs text-ink-500">{t(receivables ? 'reports.aging.totalOwedToUs' : 'reports.aging.totalWeOwe')}</dt>
          <dd className="mt-1 font-mono text-lg font-semibold tabular-nums" dir="ltr">
            {money.format(data.totals.net)}
          </dd>
        </Card>
      </dl>
      <Card className="overflow-hidden">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
              <tr>
                <th scope="col" className={`${th} text-start`}>
                  {t(receivables ? 'reports.aging.customer' : 'reports.aging.vendor')}
                </th>
                {data.buckets.map((b) => (
                  <th key={b} scope="col" className={`${th} text-end`}>
                    {t(`reports.aging.buckets.${b}`)}
                  </th>
                ))}
                {hasAdvances && (
                  <th scope="col" className={`${th} text-end`}>
                    {t('reports.aging.advance')}
                  </th>
                )}
                <th scope="col" className={`${th} text-end`}>
                  {t('reports.aging.total')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {data.contacts.map((c) => {
                const key = `${c.contact.id}:${c.currency ?? ''}`;
                const expanded = open.has(key);
                return (
                  <Fragment key={key}>
                    <tr className="hover:bg-ink-50/60 dark:hover:bg-ink-800/40">
                      <td className="px-4 py-2">
                        <button type="button" className="flex items-center gap-1.5 text-start font-medium hover:underline" aria-expanded={expanded} onClick={() => toggle(key)} disabled={!c.documents.length}>
                          <ChevronRight className={clsx('size-4 shrink-0 text-ink-400 transition-transform rtl:-scale-x-100', expanded && 'rotate-90 rtl:-rotate-90', !c.documents.length && 'invisible')} aria-hidden />
                          <span dir="auto">{c.contact.name}</span>
                          {c.currency && <span className="text-xs font-normal text-ink-500">{c.currency}</span>}
                        </button>
                      </td>
                      {data.buckets.map((b) => (
                        <td key={b} className={clsx(num, c.buckets[b] && late(b) && 'text-expense')} dir="ltr">
                          {cell(c.buckets[b], c.currency)}
                        </td>
                      ))}
                      {hasAdvances && (
                        <td className={num} dir="ltr">
                          {c.advance ? `−${cell(c.advance, c.currency)}` : '–'}
                        </td>
                      )}
                      <td className={`${num} font-semibold`} dir="ltr">
                        {cell(c.total - c.advance, c.currency)}
                      </td>
                    </tr>
                    {expanded &&
                      c.documents.map((d) => (
                        <tr key={d.id} className="bg-ink-50/50 text-ink-600 dark:bg-ink-800/30 dark:text-ink-300">
                          <td className="py-1.5 pe-4 ps-10">
                            <Link to={docLink(d.id)} className="font-mono text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                              {d.number}
                            </Link>
                            {d.vendorReference && <span className="ms-2 text-xs">{d.vendorReference}</span>}
                            <span className="block text-xs">{d.daysOverdue ? t('reports.aging.daysLate', { count: d.daysOverdue, due: formatDate(`${d.dueDate}T00:00:00Z`, locale) }) : t('reports.aging.due', { due: formatDate(`${d.dueDate}T00:00:00Z`, locale) })}</span>
                          </td>
                          {data.buckets.map((b) => (
                            <td key={b} className={num} dir="ltr">
                              {b === d.bucket ? cell(d.outstanding, c.currency) : ''}
                            </td>
                          ))}
                          {hasAdvances && <td />}
                          <td />
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
              <tr>
                <td className="px-4 py-2.5">{t('reports.aging.totalIn', { currency: data.baseCurrency })}</td>
                {data.buckets.map((b) => (
                  <td key={b} className={num} dir="ltr">
                    {money.plain(data.totals.buckets[b])}
                  </td>
                ))}
                {hasAdvances && (
                  <td className={num} dir="ltr">
                    −{money.plain(data.totals.advance)}
                  </td>
                )}
                <td className={num} dir="ltr">
                  {money.plain(data.totals.net)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}
