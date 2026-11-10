import { Link } from 'react-router';
import { AlertTriangle, Download, Landmark } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { csvBlob } from '../lib/listCsv';
import { saveBlob } from '../lib/saveBlob';
import { useMoney } from '../lib/useMoney';
import Button from '../ui/Button';
import { Card, EmptyState, ErrorState, SkeletonRows } from '../ui/Kit';
import type { TdsReport } from './types';

const th = 'px-4 py-2 font-semibold';
const num = 'px-4 py-1.5 text-end font-mono tabular-nums';

/** TDS kept back from vendor payments: by section for Form 26Q, by month with the day it's due, each payment with the PAN */
export default function TdsPanel({ side = 'payable', data, isPending, isError, onRetry }: { side?: 'payable' | 'receivable'; data: TdsReport | undefined; isPending: boolean; isError: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  if (!data) return <Card>{isPending ? <SkeletonRows rows={5} /> : isError ? <ErrorState onRetry={onRetry} /> : null}</Card>;
  const day = (d: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const month = (m: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
  if (!data.payments.length)
    return (
      <Card>
        <EmptyState icon={<Landmark className="size-5" />} title={t('reports.tds.emptyTitle')} body={t(side === 'payable' ? 'reports.tds.emptyBody' : 'reports.tds.emptyBodyReceivable')} />
      </Card>
    );
  const csv = () =>
    saveBlob({
      blob: csvBlob([
        ['Payment', 'Date', side === 'payable' ? 'Deductee' : 'Deductor', 'PAN', 'Section', 'Rate %', 'Paid', 'TDS on', 'TDS'],
        ...data.payments.map((p) => [p.number, p.date, p.vendor.name, p.vendor.pan ?? '', p.section, String(p.ratePpm / 10_000), (p.amount / 100).toFixed(2), (p.base / 100).toFixed(2), (p.tds / 100).toFixed(2)]),
      ]),
      filename: `tds-${side}-${data.from}-${data.to}.csv`,
    });
  return (
    <div className="space-y-4">
      {data.missingPan.length > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('reports.tds.missingPan', { names: data.missingPan.join(', ') })}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <caption className="border-b border-ink-100 px-4 py-3 text-start font-semibold dark:border-ink-800">{t('reports.tds.bySection')}</caption>
            <thead className="text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th scope="col" className={`${th} text-start`}>{t('reports.tds.cols.section')}</th>
                <th scope="col" className={`${th} text-end`}>{t('reports.tds.cols.on')}</th>
                <th scope="col" className={`${th} text-end`}>{t('reports.tds.cols.tds')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {data.sections.map((s) => (
                <tr key={s.section}>
                  <th scope="row" className="px-4 py-1.5 text-start font-normal">
                    <span className="font-mono">{s.section}</span> · {t(`payments.tds.sections.${s.section}`, { defaultValue: s.section })} <span className="text-xs text-ink-500">({s.count})</span>
                  </th>
                  <td className={num} dir="ltr">{money.plain(s.base)}</td>
                  <td className={num} dir="ltr">{money.plain(s.tds)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <th scope="row" className="px-4 py-1.5 text-start">{t('reports.tds.total')}</th>
                <td />
                <td className={num} dir="ltr">{money.plain(data.total)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <caption className="border-b border-ink-100 px-4 py-3 text-start font-semibold dark:border-ink-800">{t(side === 'payable' ? 'reports.tds.byMonth' : 'reports.tds.byMonthReceivable')}</caption>
            <thead className="text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th scope="col" className={`${th} text-start`}>{t('reports.tds.cols.month')}</th>
                {side === 'payable' && <th scope="col" className={`${th} text-start`}>{t('reports.tds.cols.due')}</th>}
                <th scope="col" className={`${th} text-end`}>{t('reports.tds.cols.tds')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {data.months.map((m) => (
                <tr key={m.month}>
                  <th scope="row" className="px-4 py-1.5 text-start font-normal">{month(m.month)}</th>
                  {side === 'payable' && <td className="px-4 py-1.5">{day(m.due)}</td>}
                  <td className={num} dir="ltr">{money.plain(m.tds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
          <h3 className="font-semibold">{t('reports.tds.payments')}</h3>
          <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={csv}>
            {t('reports.tds.csv')}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">{t('reports.tds.payments')}</caption>
            <thead className="text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th scope="col" className={`${th} text-start`}>{t('reports.tds.cols.payment')}</th>
                <th scope="col" className={`${th} text-start`}>{t(side === 'payable' ? 'reports.tds.cols.deductee' : 'reports.tds.cols.deductor')}</th>
                <th scope="col" className={`${th} text-start`}>{t('reports.tds.cols.section')}</th>
                <th scope="col" className={`${th} text-end`}>{t('reports.tds.cols.on')}</th>
                <th scope="col" className={`${th} text-end`}>{t('reports.tds.cols.tds')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-1.5">
                    <span className="font-mono" dir="ltr">{p.number}</span>
                    <span className="block text-xs text-ink-500">{day(p.date)}</span>
                  </td>
                  <td className="px-4 py-1.5">
                    <Link to={`/contacts/${p.vendor.id}`} className="hover:underline" dir="auto">{p.vendor.name}</Link>
                    <span className="block font-mono text-xs text-ink-500">{p.vendor.pan ?? t('reports.tds.noPan')}</span>
                  </td>
                  <td className="px-4 py-1.5"><span className="font-mono">{p.section}</span> · {p.ratePpm / 10_000}%</td>
                  <td className={num} dir="ltr">{money.plain(p.base)}</td>
                  <td className={num} dir="ltr">{money.plain(p.tds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
