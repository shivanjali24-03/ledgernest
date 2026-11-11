import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, ClipboardList, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PoStatus } from '@ledgernest/shared';
import { useIntlLocale } from '../../i18n';
import { formatDate, formatMoney } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Segmented, SkeletonRows } from '../../ui/Kit';
import { usePurchaseOrdersApi } from '../usePurchaseOrdersApi';

const PAGE_SIZE = 25;
const FILTERS = ['all', 'open', 'closed', 'cancelled'] as const;
type Filter = (typeof FILTERS)[number];

/** Purchase orders: what's been ordered from vendors, what's still to come, and what's been billed. */
export default function PurchaseOrders() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const navigate = useNavigate();
  const api = usePurchaseOrdersApi();
  const canManage = session.permissions.has('bills.manage');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['purchase-orders', session.organizationId, session.role ?? session.customRoleName, filter, deferred, page],
    queryFn: () => api!.list({ status: filter === 'all' ? undefined : (filter as PoStatus | 'open'), search: deferred || undefined, page, pageSize: PAGE_SIZE }),
    enabled: !!api,
    placeholderData: keepPreviousData,
  });
  if (!api)
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  const data = query.data;
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('purchaseOrders.title')}
          description={t('purchaseOrders.description')}
          actions={
            canManage ? (
              <Button icon={<Plus className="size-4" />} onClick={() => navigate('/purchase-orders/new')}>
                {t('purchaseOrders.new')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
        <Segmented<Filter> label={t('purchaseOrders.filter')} value={filter} onChange={(v) => (setFilter(v), setPage(1))} options={FILTERS.map((v) => ({ value: v, label: t(`purchaseOrders.filters.${v}`) }))} />
        <div className="min-w-56 flex-1">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} label={t('purchaseOrders.search')} />
        </div>
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows rows={6} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : !data!.items.length ? (
            <EmptyState icon={<ClipboardList className="size-5" />} title={search || filter !== 'all' ? t('purchaseOrders.noMatches') : t('purchaseOrders.empty')} body={search || filter !== 'all' ? undefined : t('purchaseOrders.emptyBody')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm" aria-label={t('purchaseOrders.title')}>
                <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t('purchaseOrders.columns.number')}</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t('bills.fields.vendor')}</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t('purchaseOrders.fields.expectedDate')}</th>
                    <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('invoices.total')}</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t('invoices.columns.state')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {data!.items.map((o) => (
                    <tr key={o.id} className="hover:bg-ink-50/60 dark:hover:bg-ink-800/40">
                      <td className="px-4 py-2.5">
                        <Link to={`/purchase-orders/${o.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                          {o.number}
                        </Link>
                        <span className="block text-xs text-ink-500">{day(o.orderDate)}</span>
                      </td>
                      <td className="px-4 py-2.5" dir="auto">
                        {o.contact.name}
                        {o.reference && <span className="block text-xs text-ink-500">{o.reference}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{o.expectedDate ? day(o.expectedDate) : '—'}</td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {o.currency ? formatMoney(o.total, o.currency, locale) : money.format(o.total)}
                      </td>
                      <td className="px-4 py-2.5 font-medium">{t(`purchaseOrders.statuses.${o.status}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </motion.div>
      {data && data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
    </motion.div>
  );
}
