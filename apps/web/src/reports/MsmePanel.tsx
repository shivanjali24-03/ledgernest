import { Link } from 'react-router';
import { Download, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { csvBlob } from '../lib/listCsv';
import { saveBlob } from '../lib/saveBlob';
import { useMoney } from '../lib/useMoney';
import Button from '../ui/Button';
import { Card, EmptyState, ErrorState, SkeletonRows } from '../ui/Kit';
import type { MsmeReportView } from './types';

const th = 'px-4 py-2 font-semibold';
const num = 'px-4 py-1.5 text-end font-mono tabular-nums';
const TONE = { overdue: 'text-expense', due_soon: 'text-warning', open: 'text-ink-600 dark:text-ink-300', paid_late: 'text-warning', paid_on_time: 'text-income' } as const;

/**
 * Micro and small suppliers' bills against the 45-day rule: what's overdue or due soon, what was paid late, and what
 * income-tax section 43B(h) would take out of the year's profit if it's still unpaid at the year end.
 */
export default function MsmePanel({ data, isPending, isError, onRetry }: { data: MsmeReportView | undefined; isPending: boolean; isError: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  if (!data) return <Card>{isPending ? <SkeletonRows rows={5} /> : isError ? <ErrorState onRetry={onRetry} /> : null}</Card>;
  const day = (d: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  if (!data.bills.length)
    return (
      <Card>
        <EmptyState icon={<ShieldCheck className="size-5" />} title={t('reports.msme.emptyTitle')} body={t('reports.msme.emptyBody')} action={<Link to="/contacts?type=vendor" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">{t('reports.msme.markVendors')}</Link>} />
      </Card>
    );
  const csv = () =>
    saveBlob({
      blob: csvBlob([
        ['Bill', 'Vendor bill no.', 'Vendor', 'Udyam number', 'Category', 'Bill date', 'Pay by', 'Total', 'Still owed', 'State', '43B(h) at risk'],
        ...data.bills.map((b) => [b.number, b.vendorReference ?? '', b.vendor.name, b.vendor.udyamNumber ?? '', b.vendor.category, b.billDate, b.deadline, (b.total / 100).toFixed(2), (b.balance / 100).toFixed(2), b.state, (b.disallowed / 100).toFixed(2)]),
      ]),
      filename: `msme-payments-${data.asOf}.csv`,
    });
  const tiles = [
    { key: 'overdue', value: data.totals.overdue, tone: data.totals.overdue ? 'text-expense' : '' },
    { key: 'dueSoon', value: data.totals.dueSoon, tone: data.totals.dueSoon ? 'text-warning' : '' },
    { key: 'disallowed', value: data.totals.disallowed, tone: data.totals.disallowed ? 'text-expense' : '' },
    { key: 'paidLate', value: data.totals.paidLate, tone: '' },
  ] as const;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((x) => (
          <Card key={x.key} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{t(`reports.msme.totals.${x.key}`)}</p>
            <p className={`mt-1 font-mono text-xl font-semibold tabular-nums ${x.tone}`}>{money.format(x.value)}</p>
          </Card>
        ))}
      </div>
      <p className="text-sm text-ink-500">{t('reports.msme.disallowedHint', { from: day(data.fiscalYear.from), to: day(data.fiscalYear.to) })}</p>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="border-b border-ink-100 px-4 py-3 text-start dark:border-ink-800">
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">{t('reports.msme.bills')}</span>
              <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={csv}>
                {t('reports.msme.csv')}
              </Button>
            </span>
          </caption>
          <thead className="text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th scope="col" className={`${th} text-start`}>{t('reports.msme.cols.bill')}</th>
              <th scope="col" className={`${th} text-start`}>{t('reports.msme.cols.vendor')}</th>
              <th scope="col" className={`${th} text-start`}>{t('reports.msme.cols.deadline')}</th>
              <th scope="col" className={`${th} text-end`}>{t('reports.msme.cols.owed')}</th>
              <th scope="col" className={`${th} text-start`}>{t('reports.msme.cols.state')}</th>
              <th scope="col" className={`${th} text-end`}>{t('reports.msme.cols.disallowed')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {data.bills.map((b) => (
              <tr key={b.id}>
                <th scope="row" className="px-4 py-1.5 text-start font-normal">
                  <Link to={`/bills/${b.id}`} className="font-mono hover:underline" dir="ltr">
                    {b.number}
                  </Link>
                  {b.vendorReference && <span className="block text-xs text-ink-500">{b.vendorReference}</span>}
                </th>
                <td className="px-4 py-1.5">
                  <Link to={`/contacts/${b.vendor.id}`} className="hover:underline">
                    {b.vendor.name}
                  </Link>
                  <span className="block text-xs text-ink-500">{t(`contacts.msme.${b.vendor.category}`)}</span>
                </td>
                <td className="px-4 py-1.5 whitespace-nowrap">
                  {day(b.deadline)}
                  {b.balance > 0 && <span className="block text-xs text-ink-500">{b.daysLeft < 0 ? t('reports.msme.daysLate', { count: -b.daysLeft }) : t('reports.msme.daysLeft', { count: b.daysLeft })}</span>}
                </td>
                <td className={num} dir="ltr">{money.plain(b.balance)}</td>
                <td className={`px-4 py-1.5 font-medium ${TONE[b.state]}`}>{t(`reports.msme.states.${b.state}`)}</td>
                <td dir="ltr" className={`${num} ${b.disallowed ? 'text-expense' : 'text-ink-400'}`}>{b.disallowed ? money.plain(b.disallowed) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
