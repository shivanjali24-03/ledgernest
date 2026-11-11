import { QUOTE_KINDS, type QuoteKind } from '@ledgernest/shared';
import { useDeferredValue, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, FileSignature, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate, formatMoney } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Segmented, SkeletonRows } from '../../ui/Kit';
import { quoteTone } from '../tone';
import type { QuoteFilter } from '../types';
import { useQuotesApi } from '../useQuotesApi';

type Filter = 'all' | QuoteFilter;
const PAGE_SIZE = 25;

/** Quotes: what's been offered to customers, what's still open, and what became an invoice. */
export default function Quotes() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const navigate = useNavigate();
  const api = useQuotesApi();
  const canManage = session.permissions.has('invoices.manage');
  const [params] = useSearchParams();
  const FILTERS = ['all', 'open', 'accepted', 'expired', 'invoiced', 'declined'] as const;
  const [filter, setFilter] = useState<Filter>(FILTERS.find((f) => f === params.get('state')) ?? 'all');
  // Quotations, proforma invoices or sales orders
  const [kind, setKind] = useState<QuoteKind | 'all'>(QUOTE_KINDS.find((k) => k === params.get('kind')) ?? 'all');
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['quotes', session.organizationId, session.role ?? session.customRoleName, kind, filter, deferred, page],
    queryFn: () => api!.list({ kind: kind === 'all' ? undefined : kind, state: filter === 'all' ? undefined : filter, search: deferred || undefined, page, pageSize: PAGE_SIZE }),
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
          title={t('quotes.title')}
          description={t('quotes.description')}
          actions={
            canManage ? (
              <Button icon={<Plus className="size-4" />} onClick={() => navigate(`/quotes/new${kind !== 'all' && kind !== 'quote' ? `?kind=${kind}` : ''}`)}>
                {t(`quotes.newKind.${kind === 'all' ? 'quote' : kind}`)}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
        <Segmented<QuoteKind | 'all'>
          label={t('quotes.kindFilter')}
          value={kind}
          onChange={(v) => (setKind(v), setPage(1))}
          options={(['all', ...QUOTE_KINDS] as const).map((v) => ({ value: v, label: t(`quotes.kinds.${v}`) }))}
        />
        <Segmented<Filter>
          label={t('quotes.filter')}
          value={filter}
          onChange={(v) => (setFilter(v), setPage(1))}
          options={FILTERS.map((v) => ({ value: v, label: t(`quotes.filters.${v}`) }))}
        />
        <div className="min-w-56 flex-1">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} label={t('quotes.search')} />
        </div>
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows rows={6} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : !data!.items.length ? (
            <EmptyState icon={<FileSignature className="size-5" />} title={search || filter !== 'all' ? t('quotes.noMatches') : t('quotes.empty')} body={search || filter !== 'all' ? undefined : t('quotes.emptyBody')} />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="stack-sm w-full min-w-[720px] text-sm">
                <thead className="whitespace-nowrap border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('quotes.columns.number')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('invoices.fields.customer')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('quotes.fields.expiryDate')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-end font-semibold">
                      {t('invoices.total')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('invoices.columns.state')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {data!.items.map((q) => (
                    <tr key={q.id} className="hover:bg-ink-50/60 dark:hover:bg-ink-800/40">
                      <td className="px-4 py-2.5">
                        <Link to={`/quotes/${q.id}`} className="font-mono font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                          {q.number}
                        </Link>
                        <span className="block text-xs text-ink-500">{day(q.quoteDate)}</span>
                      </td>
                      <td className="px-4 py-2.5" dir="auto">
                        {q.contact.name}
                        {q.reference && <span className="block text-xs text-ink-500">{q.reference}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink-600 dark:text-ink-300" data-label={t('quotes.fields.expiryDate')}>{day(q.expiryDate)}</td>
                      <td className="px-4 py-2.5 text-end font-mono tabular-nums" dir="ltr" data-end>
                        {q.currency ? formatMoney(q.total, q.currency, locale) : money.format(q.total)}
                      </td>
                      <td className="px-4 py-2.5" data-end>
                        <span className={`inline-flex whitespace-nowrap rounded-full bg-current/10 px-2 py-0.5 text-xs font-semibold ${quoteTone(q.state)}`}>{t(`quotes.states.${q.state}`)}</span>
                      </td>
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
