import { useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BookOpen, Building2, Paperclip, Plus, SearchX, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Pill, SearchInput, Segmented, SkeletonRows } from '../../ui/Kit';
import { useJournalsApi } from '../useJournalsApi';

type Filter = 'all' | 'draft' | 'posted';
const PAGE_SIZE = 25;

/** Every journal entry, newest first: drafts to finish and posted entries with their numbers. */
export default function Journals() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const navigate = useNavigate();
  const api = useJournalsApi();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const filter = (['draft', 'posted'].includes(params.get('status') ?? '') ? params.get('status') : 'all') as Filter;
  const page = Number(params.get('page') ?? 1);
  const canCreate = session.permissions.has('journals.create');

  const update = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          for (const [k, v] of Object.entries(patch)) if (v) n.set(k, v);
          else n.delete(k);
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  const onSearch = useCallback((v: string) => update({ q: v || null, page: null }), [update]);
  const q = { status: filter === 'all' ? undefined : filter, search: search || undefined, page, pageSize: PAGE_SIZE };
  const query = useQuery({ queryKey: ['journals', session.organizationId, session.role ?? session.customRoleName, q], queryFn: () => api!.list(q), enabled: !!api, placeholderData: keepPreviousData });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('journals.title')}
          description={t('journals.description')}
          actions={
            canCreate ? (
              <Button icon={<Plus className="size-4" />} onClick={() => navigate('/journals/new')}>
                {t('journals.new')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={onSearch} label={t('journals.search')} />
        <Segmented<Filter>
          label={t('journals.filter')}
          value={filter}
          onChange={(v) => update({ status: v === 'all' ? null : v, page: null })}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'draft', label: t('journals.status.draft') },
            { value: 'posted', label: t('journals.status.posted') },
          ]}
        />
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : query.data.items.length === 0 ? (
            search || filter !== 'all' ? (
              <EmptyState icon={<SearchX className="size-5" />} title={t('journals.noMatches')} />
            ) : (
              <EmptyState icon={<BookOpen className="size-5" />} title={t('journals.empty')} body={t('journals.emptyBody')} />
            )
          ) : (
            <>
              <div className="relative overflow-x-auto">
                <table className="stack-sm w-full min-w-[640px] text-sm">
                  <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('journals.columns.number')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('journals.columns.date')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('journals.columns.memo')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-end font-semibold">
                        {t('journals.columns.amount', { currency: money.currency })}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {query.data.items.map((e) => (
                      <tr key={e.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
                        <td className="px-4 py-3">
                          <Link to={`/journals/${e.id}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300" dir="ltr">
                            {e.number ?? t('journals.status.draft')}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-600 dark:text-ink-300">{formatDate(`${e.date}T00:00:00Z`, locale)}</td>
                        <td className="px-4 py-3">
                          <span className="flex flex-wrap items-center gap-2">
                            <span dir="auto">{e.memo ?? '—'}</span>
                            {e.status === 'draft' && <Pill>{t('journals.status.draft')}</Pill>}
                            {e.reversalOf && (
                              <Pill>
                                <Undo2 className="me-1 size-3" aria-hidden />
                                {t('journals.reverses', { number: e.reversalOf.number })}
                              </Pill>
                            )}
                            {e.reversed && <Pill>{t('journals.reversedPill')}</Pill>}
                            {e.attachmentCount > 0 && <Paperclip className="size-3.5 text-ink-400" aria-label={t('journals.attachmentCount', { count: e.attachmentCount })} />}
                          </span>
                          {e.reference && (
                            <span className="text-xs text-ink-400" dir="auto">
                              {e.reference}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-end font-mono tabular-nums" dir="ltr" data-end>
                          {money.plain(e.totals.debit)}
                          {e.totals.difference !== 0 && <span className="block text-xs text-expense">{t('journals.unbalancedBy', { amount: money.plain(Math.abs(e.totals.difference)) })}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={query.data.total} onPage={(p) => update({ page: p > 1 ? String(p) : null })} />
            </>
          )}
        </Card>
      </motion.div>
    </motion.div>
  );
}
