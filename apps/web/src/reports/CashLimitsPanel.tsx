import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../lib/useMoney';
import { useSession } from '../layout/session';
import { usePaymentsApi } from '../payments/usePaymentsApi';
import { Card, ErrorState, SkeletonRows } from '../ui/Kit';

/** Days cash crossed the Income-tax limits (s.269ST receipts, s.40A(3) payments), for the tax audit */
export default function CashLimitsPanel({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation();
  const money = useMoney();
  const api = usePaymentsApi();
  const session = useSession();
  const q = useQuery({ queryKey: ['payments', session.organizationId, 'cash-limits', from, to], queryFn: () => api!.cashLimits(from, to), enabled: !!api && from <= to });
  const th = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500';
  return (
    <Card className="overflow-x-auto">
      <div className="p-4 pb-2">
        <h2 className="font-semibold">{t('reports.cashLimits.title')}</h2>
        <p className="text-sm text-ink-500">{t('reports.cashLimits.hint')}</p>
      </div>
      {!q.data ? (
        q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : <SkeletonRows rows={2} />
      ) : !q.data.items.length ? (
        <p className="px-4 pb-4 text-sm text-ink-500">{t('reports.cashLimits.none')}</p>
      ) : (
        <table className="w-full text-sm" aria-label={t('reports.cashLimits.title')}>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-start`}>{t('reports.cashLimits.section')}</th>
              <th scope="col" className={`${th} text-start`}>{t('reports.cashLimits.date')}</th>
              <th scope="col" className={`${th} text-start`}>{t('reports.cashLimits.person')}</th>
              <th scope="col" className={`${th} text-start`}>{t('reports.cashLimits.documents')}</th>
              <th scope="col" className={`${th} text-end`}>{t('reports.cashLimits.total')}</th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((i) => (
              <tr key={`${i.kind}-${i.contact.id}-${i.date}`} className="border-t border-ink-100 dark:border-ink-800">
                <td className="px-3 py-1.5">{t(`reports.cashLimits.sections.${i.section === '269ST' ? 'r269st' : 'r40a3'}`)}</td>
                <td className="px-3 py-1.5" dir="ltr">{i.date}</td>
                <td className="px-3 py-1.5">
                  <Link to={`/contacts/${i.contact.id}`} className="text-brand-700 hover:underline dark:text-brand-300">{i.contact.name}</Link>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs" dir="ltr">{i.payments.map((p) => p.number).join(', ')}</td>
                <td className="px-3 py-1.5 text-end font-mono tabular-nums" dir="ltr">{money.plain(i.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
