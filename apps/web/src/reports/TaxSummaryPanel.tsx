import { Percent } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../lib/useMoney';
import { Card, EmptyState, ErrorState, SkeletonRows } from '../ui/Kit';
import type { TaxSummary } from './types';

const th = 'px-4 py-2.5 font-semibold';
const num = 'px-4 py-2 text-end font-mono tabular-nums';

/** Tax for a period, as a return needs it: per group (taxable value and tax on sales and purchases), then per rate with the net payable. */
export default function TaxSummaryPanel({ data, isPending, isError, onRetry }: { data: TaxSummary | undefined; isPending: boolean; isError: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const amount = (n: number) => (n ? money.plain(n) : '–');
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
  if (!data.groups.length)
    return (
      <Card>
        <EmptyState icon={<Percent className="size-5" />} title={t('reports.tax.empty')} body={t('reports.tax.emptyBody')} />
      </Card>
    );
  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ['output', data.totals.output, 'text-ink-900 dark:text-ink-50'],
            ['input', data.totals.input, 'text-ink-900 dark:text-ink-50'],
            [data.totals.net >= 0 ? 'payable' : 'credit', Math.abs(data.totals.net), data.totals.net >= 0 ? 'text-expense' : 'text-income'],
          ] as const
        ).map(([k, v, tone]) => (
          <Card key={k} className="p-4">
            <dt className="text-xs text-ink-500">{t(`reports.tax.${k}`)}</dt>
            <dd className={`mt-1 font-mono text-xl font-semibold tabular-nums ${tone}`} dir="ltr">
              {money.format(v)}
            </dd>
          </Card>
        ))}
      </dl>
      <Card className="overflow-hidden">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="px-4 pt-3 text-start font-semibold">{t('reports.tax.byGroup')}</caption>
            <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
              <tr>
                <th scope="col" className={`${th} text-start`}>
                  {t('reports.tax.group')}
                </th>
                <th scope="col" className={`${th} text-end`}>
                  {t('reports.tax.salesValue')}
                </th>
                <th scope="col" className={`${th} text-end`}>
                  {t('reports.tax.salesTax')}
                </th>
                <th scope="col" className={`${th} text-end`}>
                  {t('reports.tax.purchaseValue')}
                </th>
                <th scope="col" className={`${th} text-end`}>
                  {t('reports.tax.purchaseTax')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {data.groups.map((g) => (
                <tr key={g.id}>
                  <th scope="row" className="px-4 py-2 text-start font-normal" dir="auto">
                    {g.name}
                  </th>
                  <td className={num} dir="ltr">
                    {amount(g.outward.taxable)}
                  </td>
                  <td className={num} dir="ltr">
                    {amount(g.outward.tax)}
                  </td>
                  <td className={num} dir="ltr">
                    {amount(g.inward.taxable)}
                  </td>
                  <td className={num} dir="ltr">
                    {amount(g.inward.tax)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
              <tr>
                <th scope="row" className="px-4 py-2.5 text-start">
                  {t('journals.total')}
                </th>
                <td className={num} dir="ltr">
                  {money.plain(data.totals.outwardTaxable)}
                </td>
                <td className={num} dir="ltr">
                  {money.plain(data.totals.output)}
                </td>
                <td className={num} dir="ltr">
                  {money.plain(data.totals.inwardTaxable)}
                </td>
                <td className={num} dir="ltr">
                  {money.plain(data.totals.input)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="px-4 pt-3 text-start font-semibold">{t('reports.tax.byRate')}</caption>
            <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
              <tr>
                <th scope="col" className={`${th} text-start`}>
                  {t('reports.tax.rate')}
                </th>
                <th scope="col" className={`${th} text-end`}>
                  {t('reports.tax.output')}
                </th>
                <th scope="col" className={`${th} text-end`}>
                  {t('reports.tax.input')}
                </th>
                <th scope="col" className={`${th} text-end`}>
                  {t('reports.tax.net')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {data.rates.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="px-4 py-2 text-start font-normal" dir="auto">
                    {r.name}
                  </th>
                  <td className={num} dir="ltr">
                    {amount(r.output)}
                  </td>
                  <td className={num} dir="ltr">
                    {amount(r.input)}
                  </td>
                  <td className={num} dir="ltr">
                    {money.plain(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
