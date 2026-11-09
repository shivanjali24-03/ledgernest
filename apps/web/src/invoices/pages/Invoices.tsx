import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, FileText, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate, formatMoney } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Segmented, SkeletonRows } from '../../ui/Kit';
import { stateTone } from '../state';
import type { InvoiceFilter } from '../types';
import { useInvoicesApi } from '../useInvoicesApi';

type Filter = 'all' | InvoiceFilter;
const PAGE_SIZE = 25;

/** Sales invoices: what's been billed, what's outstanding and what's overdue. */
export default function Invoices() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const navigate = useNavigate();
  const api = useInvoicesApi();
  const canManage = session.permissions.has('invoices.manage');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['invoices', session.organizationId, session.role ?? session.customRoleName, filter, deferred, page],
    queryFn: () => api!.list({ state: filter === 'all' ? undefined : filter, search: deferred || undefined, page, pageSize: PAGE_SIZE }),
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
          title={t('invoices.title')}
          description={t('invoices.description')}
          actions={
            canManage ? (
              <Button icon={<Plus className="size-4" />} onClick={() => navigate('/invoices/new')}>
                {t('invoices.new')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      {data && (
        <motion.dl variants={fadeUp} className="grid gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <dt className="text-xs text-ink-500">{t('invoices.outstanding')}</dt>
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
        <Segmented<Filter>
          label={t('invoices.filter')}
          value={filter}
          onChange={(v) => (setFilter(v), setPage(1))}
          options={(['all', 'draft', 'unpaid', 'overdue', 'paid', 'void'] as const).map((v) => ({ value: v, label: t(`invoices.filters.${v}`) }))}
        />
        <div className="min-w-56 flex-1">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} label={t('invoices.search')} />
        </div>
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows rows={6} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : !data!.items.length ? (
            <EmptyState icon={<FileText className="size-5" />} title={search || filter !== 'all' ? t('invoices.noMatches') : t('invoices.empty')} body={search || filter !== 'all' ? undefined : t('invoices.emptyBody')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('invoices.columns.number')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('invoices.fields.customer')}
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
                        <Link to={`/invoices/${i.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                          {i.number ?? t('invoices.draft')}
                        </Link>
                        <span className="block text-xs text-ink-500">{day(i.issueDate)}</span>
                      </td>
                      <td className="px-4 py-2.5" dir="auto">
                        {i.contact.name}
                        {i.reference && <span className="block text-xs text-ink-500">{i.reference}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-ink-600 dark:text-ink-300">{day(i.dueDate)}</td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {i.currency ? formatMoney(i.total, i.currency, locale) : money.format(i.total)}
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr">
                        {i.status === 'issued' ? (i.currency ? formatMoney(i.balance, i.currency, locale) : money.format(i.balance)) : '—'}
                      </td>
                      <td className={`px-4 py-2.5 font-medium ${stateTone(i.state)}`}>{t(`invoices.states.${i.state}`)}</td>
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
