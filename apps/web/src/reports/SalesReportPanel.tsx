import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SalesReportBy, SalesReportSide } from '@ledgernest/shared';
import { ShoppingCart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../lib/useMoney';
import { useSession } from '../layout/session';
import { TextField } from '../ui/Field';
import { Card, EmptyState, ErrorState, Segmented, SkeletonRows } from '../ui/Kit';
import type { ReportsApi } from './types';

const th = 'px-4 py-2.5 font-semibold';

/** Sales (invoices less credit notes) or purchases (bills) by customer, vendor or item, in the base currency */
export default function SalesReportPanel({ api, side, by, from, to, set }: { api: ReportsApi; side: SalesReportSide; by: SalesReportBy; from: string; to: string; set: (patch: Record<string, string | null>) => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const session = useSession();
  const query = useQuery({
    queryKey: ['reports', session.organizationId, session.role ?? session.customRoleName, 'sales', side, by, from, to],
    queryFn: () => api.sales(side, by, from, to),
    enabled: from <= to,
    placeholderData: keepPreviousData,
  });
  const who = by === 'item' ? t('reports.sales.item') : side === 'sales' ? t('reports.sales.customer') : t('reports.sales.vendor');
  const data = query.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 print:hidden sm:grid-cols-[auto_auto_11rem_11rem] sm:items-end">
        <Segmented<SalesReportSide>
          label={t('reports.sales.side')}
          value={side}
          onChange={(v) => set({ sside: v === 'sales' ? null : v })}
          options={[
            { value: 'sales', label: t('reports.sales.sales') },
            { value: 'purchases', label: t('reports.sales.purchases') },
          ]}
        />
        <Segmented<SalesReportBy>
          label={t('reports.sales.by')}
          value={by}
          onChange={(v) => set({ by: v === 'contact' ? null : v })}
          options={[
            { value: 'contact', label: side === 'sales' ? t('reports.sales.byCustomer') : t('reports.sales.byVendor') },
            { value: 'item', label: t('reports.sales.byItem') },
          ]}
        />
        <TextField label={t('reports.from')} type="date" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        <TextField label={t('reports.to')} type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} error={from > to ? t('audit.filters.badRange') : undefined} />
      </div>
      <p className="text-sm text-ink-500 print:hidden">{t(side === 'sales' ? 'reports.sales.hintSales' : 'reports.sales.hintPurchases', { currency: money.currency })}</p>
      <Card className="overflow-hidden">
        {query.isPending ? (
          <SkeletonRows rows={6} />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : !data!.rows.length ? (
          <EmptyState icon={<ShoppingCart className="size-5" />} title={t(side === 'sales' ? 'reports.sales.emptySales' : 'reports.sales.emptyPurchases')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">{t(side === 'sales' ? 'reports.sales.captionSales' : 'reports.sales.captionPurchases')}</caption>
              <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                <tr>
                  <th scope="col" className={`${th} text-start`}>
                    {who}
                  </th>
                  <th scope="col" className={`${th} text-end`}>
                    {t(side === 'sales' ? 'reports.sales.invoices' : 'reports.sales.bills')}
                  </th>
                  {by === 'item' && (
                    <th scope="col" className={`${th} text-end`}>
                      {t('reports.sales.quantity')}
                    </th>
                  )}
                  <th scope="col" className={`${th} text-end`}>
                    {t('reports.sales.net')}
                  </th>
                  <th scope="col" className={`${th} text-end`}>
                    {t('reports.sales.tax')}
                  </th>
                  <th scope="col" className={`${th} text-end`}>
                    {t('reports.sales.total')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {data!.rows.map((r) => (
                  <tr key={r.id ?? 'none'}>
                    <td className="px-4 py-2.5" dir="auto">
                      {r.name ?? <span className="text-ink-500">{t('reports.sales.noItem')}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{r.documents}</td>
                    {by === 'item' && (
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {r.quantity ?? ''}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                      {money.plain(r.net)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                      {money.plain(r.tax)}
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                      {money.plain(r.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
                <tr>
                  <td className="px-4 py-2.5" colSpan={by === 'item' ? 3 : 2}>
                    {t('reports.sales.total')}
                  </td>
                  <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                    {money.plain(data!.totals.net)}
                  </td>
                  <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                    {money.plain(data!.totals.tax)}
                  </td>
                  <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                    {money.plain(data!.totals.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
