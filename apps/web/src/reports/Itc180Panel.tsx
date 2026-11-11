import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../lib/useMoney';
import { Card, ErrorState, Pill, SkeletonRows } from '../ui/Kit';
import type { Itc180Report } from './types';

const sum = (h: { igst: number; cgst: number; sgst: number; cess: number }) => h.igst + h.cgst + h.sgst + h.cess;

/** Rule 37: suppliers to pay within 180 days of their invoice, credit to reverse on those still unpaid, and to take back */
export default function Itc180Panel({ data, isPending, isError, onRetry }: { data: Itc180Report | undefined; isPending: boolean; isError: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  if (!data) return <Card>{isPending ? <SkeletonRows rows={4} /> : isError ? <ErrorState onRetry={onRetry} /> : null}</Card>;
  const th = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500';
  const num = 'px-3 py-1.5 text-end font-mono tabular-nums';
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {(['dueSoon', 'reverse', 'reclaim'] as const).map((k) => (
          <Card key={k} className="p-4">
            <p className="text-sm text-ink-500">{t(`reports.itc180.totals.${k}`)}</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums" dir="ltr">
              {money.format(data.totals[k])}
            </p>
          </Card>
        ))}
      </div>
      <Card className="overflow-x-auto">
        {!data.bills.length ? (
          <p className="p-5 text-sm text-ink-500">{t('reports.itc180.none')}</p>
        ) : (
          <table className="w-full text-sm" aria-label={t('reports.itc180.title')}>
            <thead>
              <tr>
                <th scope="col" className={`${th} text-start`}>{t('reports.itc180.vendor')}</th>
                <th scope="col" className={`${th} text-start`}>{t('reports.itc180.bill')}</th>
                <th scope="col" className={`${th} text-start`}>{t('reports.itc180.invoiceDate')}</th>
                <th scope="col" className={`${th} text-start`}>{t('reports.itc180.deadline')}</th>
                <th scope="col" className={`${th} text-end`}>{t('reports.itc180.balance')}</th>
                <th scope="col" className={`${th} text-end`}>{t('reports.itc180.credit')}</th>
                <th scope="col" className={`${th} text-start`}>{t('reports.itc180.state')}</th>
              </tr>
            </thead>
            <tbody>
              {data.bills.map((b) => (
                <tr key={b.id} className="border-t border-ink-100 dark:border-ink-800">
                  <td className="px-3 py-1.5">{b.vendor.name}</td>
                  <td className="px-3 py-1.5">
                    <Link to={`/bills/${b.id}`} className="font-mono text-brand-700 hover:underline dark:text-brand-300">
                      {b.number ?? b.vendorReference}
                    </Link>
                    {b.vendorReference && b.number && <span className="block text-xs text-ink-500">{b.vendorReference}</span>}
                  </td>
                  <td className="px-3 py-1.5" dir="ltr">{b.invoiceDate}</td>
                  <td className="px-3 py-1.5" dir="ltr">
                    {b.deadline}
                    {b.state === 'due_soon' && <span className="block text-xs text-ink-500">{t('reports.itc180.daysLeft', { count: b.daysLeft })}</span>}
                  </td>
                  <td className={num} dir="ltr">{money.plain(b.balance)}</td>
                  <td className={num} dir="ltr">{money.plain(sum(b.state === 'reclaim' ? b.reclaimable : b.state === 'reverse' ? b.reversed : b.atRisk))}</td>
                  <td className="px-3 py-1.5">
                    <Pill tone={b.state === 'reclaim' ? 'brand' : 'neutral'}>
                      <span className={b.state === 'reverse' ? 'text-expense' : b.state === 'due_soon' ? 'text-warning' : undefined}>{t(`reports.itc180.states.${b.state}`)}</span>
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
