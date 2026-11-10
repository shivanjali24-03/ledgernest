import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Download, Building2, Plus, Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate, formatMoney } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { saveBlob } from '../../lib/saveBlob';
import { apiErrorMessage } from '../../platform/errors';
import { useToast } from '../../ui/toastContext';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Segmented, SkeletonRows } from '../../ui/Kit';
import { stateTone } from '../../invoices/state';
import type { BillFilter } from '../types';
import { useBillsApi } from '../useBillsApi';

type Filter = 'all' | BillFilter;
const PAGE_SIZE = 25;

/** Purchase bills: what the business owes its vendors, and what's overdue. */
export default function Bills() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const navigate = useNavigate();
  const api = useBillsApi();
  const canManage = session.permissions.has('bills.manage');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const toast = useToast();
  const canExport = session.permissions.has('reports.export');
  const exporting = useMutation({
    mutationFn: () => api!.exportList({ state: filter === 'all' ? undefined : filter, search: deferred || undefined }),
    onSuccess: (f) => {
      saveBlob(f);
      toast(t('audit.exported', { file: f.filename }));
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['bills', session.organizationId, session.role ?? session.customRoleName, filter, deferred, page],
    queryFn: () =>
      api!.list({
        state: filter === 'all' ? undefined : filter,
        search: deferred || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: !!api,
    placeholderData: keepPreviousData,
  });
  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }
  const data = query.data;
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('bills.title')}
          description={t('bills.description')}
          actions={
            <>
              {canExport && (
                <Button variant="secondary" icon={<Download className="size-4" />} loading={exporting.isPending} onClick={() => exporting.mutate()}>
                  {t('reports.export')}
                </Button>
              )}
              {canManage && (
                <Button icon={<Plus className="size-4" />} onClick={() => navigate('/bills/new')}>
                  {t('bills.new')}
                </Button>
              )}
            </>
          }
        />
      </motion.div>
      {data && (
        <motion.dl variants={fadeUp} className="grid gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <dt className="text-xs text-ink-500">{t('bills.outstanding')}</dt>
            <dd className="mt-1 font-mono text-xl font-semibold tabular-nums" dir="ltr">
              {money.format(data.summary.outstanding)}
            </dd>
          </Card>
          <Card className="p-4">
            <dt className="text-xs text-ink-500">{t('invoices.overdue')}</dt>
            <dd className={`mt-1 font-mono text-xl font-semibold tabular-nums ${data.summary.overdue ? 'text-expense' : ''}`} dir="ltr">
              {money.format(data.summary.overdue)}
            </dd>
          </Card>
        </motion.dl>
      )}
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
        <Segmented<Filter> label={t('bills.filter')} value={filter} onChange={(v) => (setFilter(v), setPage(1))} options={(['all', 'draft', 'unpaid', 'overdue', 'paid', 'void'] as const).map((v) => ({ value: v, label: t(`invoices.filters.${v}`) }))} />
        <div className="min-w-56 flex-1">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} label={t('bills.search')} />
        </div>
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows rows={6} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : !data!.items.length ? (
            <EmptyState icon={<Receipt className="size-5" />} title={search || filter !== 'all' ? t('invoices.noMatches') : t('bills.empty')} body={search || filter !== 'all' ? undefined : t('bills.emptyBody')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('invoices.columns.number')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('bills.fields.vendor')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('invoices.fields.dueDate')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-end font-semibold">
                      {t('invoices.total')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-end font-semibold">
                      {t('invoices.balanceDue')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('invoices.columns.state')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {data!.items.map((i) => (
                    <tr key={i.id} className="hover:bg-ink-50/60 dark:hover:bg-ink-800/40">
                      <td className="px-4 py-2.5">
                        <Link to={`/bills/${i.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                          {i.number ?? t('invoices.draft')}
                        </Link>
                        <span className="block text-xs text-ink-500">{day(i.billDate)}</span>
                      </td>
                      <td className="px-4 py-2.5" dir="auto">
                        {i.contact.name}
                        {i.vendorReference && <span className="block text-xs text-ink-500">{i.vendorReference}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{day(i.dueDate)}</td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {i.currency ? formatMoney(i.total, i.currency, locale) : money.format(i.total)}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {i.status === 'open' ? (i.currency ? formatMoney(i.balance, i.currency, locale) : money.format(i.balance)) : '—'}
                      </td>
                      <td className={`px-4 py-2.5 font-medium ${stateTone(i.state)}`}>{t(`bills.states.${i.state}`)}</td>
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
