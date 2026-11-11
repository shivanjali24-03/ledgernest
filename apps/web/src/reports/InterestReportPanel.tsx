import { Link } from 'react-router';
import { Download, Percent } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatMoney } from '../lib/format';
import { csvBlob } from '../lib/listCsv';
import { saveBlob } from '../lib/saveBlob';
import { useMoney } from '../lib/useMoney';
import Button from '../ui/Button';
import { Card, EmptyState, ErrorState, SkeletonRows } from '../ui/Kit';
import type { InterestReport } from './types';

/** Interest on late payment across the books: what's accrued on each invoice, invoiced, waived and left to charge */
export default function InterestReportPanel({ data, isPending, isError, onRetry }: { data: InterestReport | undefined; isPending: boolean; isError: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  if (!data) return <Card>{isPending ? <SkeletonRows rows={5} /> : isError ? <ErrorState onRetry={onRetry} /> : null}</Card>;
  if (!data.rows.length)
    return (
      <Card>
        <EmptyState icon={<Percent className="size-5" />} title={t('reports.interest.emptyTitle')} body={t('reports.interest.emptyBody')} action={<Link to="/settings" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">{t('reports.interest.setTerms')}</Link>} />
      </Card>
    );
  const amt = (minor: number, currency: string | null) => (currency ? formatMoney(minor, currency, locale) : money.format(minor));
  const csv = () =>
    saveBlob({
      blob: csvBlob([
        ['Customer', 'Invoice', 'Currency', 'Due', 'Days late', 'Rate % a year', 'Still owed', 'Accrued', 'Invoiced', 'Waived', 'Left to charge', 'Per day'],
        ...data.rows.map((r) => [r.contact.name, r.number ?? '', r.currency ?? 'INR', r.dueDate, r.daysLate, r.rateBp / 100, (r.balance / 100).toFixed(2), (r.accrued / 100).toFixed(2), (r.charged / 100).toFixed(2), (r.waived / 100).toFixed(2), (r.chargeable / 100).toFixed(2), (r.perDay / 100).toFixed(2)]),
      ]),
      filename: `interest-${data.asOf}.csv`,
    });
  const tiles = [
    { key: 'accrued', value: data.totals.accrued },
    { key: 'charged', value: data.totals.charged },
    { key: 'waived', value: data.totals.waived },
    { key: 'chargeable', value: data.totals.chargeable },
  ] as const;
  const num = 'px-3 py-2 text-end font-mono tabular-nums';
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((x) => (
          <Card key={x.key} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{t(`reports.interest.totals.${x.key}`)}</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums" data-testid={`interest-total-${x.key}`}>
              {money.format(x.value)}
            </p>
          </Card>
        ))}
      </div>
      {data.totals.perDay > 0 && <p className="text-sm text-ink-500">{t('reports.interest.perDay', { amount: money.format(data.totals.perDay) })}</p>}
      <Card className="relative overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <caption className="border-b border-ink-100 px-4 py-3 text-start dark:border-ink-800">
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">{t('reports.interest.title')}</span>
              <Button variant="ghost" size="sm" icon={<Download className="size-4" />} onClick={csv}>
                {t('reports.interest.csv')}
              </Button>
            </span>
          </caption>
          <thead className="text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-semibold">{t('reports.interest.cols.customer')}</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">{t('reports.interest.cols.invoice')}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('reports.interest.cols.daysLate')}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('reports.interest.cols.rate')}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('reports.interest.totals.accrued')}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('reports.interest.totals.charged')}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('reports.interest.totals.waived')}</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">{t('reports.interest.totals.chargeable')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {data.rows.map((r) => (
              <tr key={r.invoiceId}>
                <td className="px-3 py-2" dir="auto">
                  {r.contact.name}
                </td>
                <td className="px-3 py-2">
                  <Link to={`/invoices/${r.invoiceId}`} className="font-mono hover:underline" dir="ltr">
                    {r.number}
                  </Link>
                </td>
                <td className={num}>{r.daysLate}</td>
                <td className={num}>{r.rateBp / 100}%</td>
                <td className={num}>{amt(r.accrued, r.currency)}</td>
                <td className={num}>{amt(r.charged, r.currency)}</td>
                <td className={num}>{amt(r.waived, r.currency)}</td>
                <td className={`${num} font-semibold`}>{amt(r.chargeable, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
