import { useCallback, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, MailPlus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Industry } from '@ledgernest/shared';
import { ApiError } from '../../auth/client';
import { useIntlLocale } from '../../i18n';
import { formatDate, formatRelative } from '../../lib/format';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { Card, CopyField, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Segmented, SkeletonRows, StatusBadge } from '../../ui/Kit';
import Modal from '../../ui/Modal';
import { useToast } from '../../ui/toastContext';
import { usePlatformApi } from '../context';
import { apiErrorMessage } from '../errors';
import { emptyOrganization, type FieldErrors, type OrganizationFormValues } from '../formValues';
import OrganizationForm from '../OrganizationForm';
import type { CreateOrganizationResult, Status } from '../types';

type Filter = 'all' | Status;
const PAGE_SIZE = 20;

export default function Organizations() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const api = usePlatformApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const filter = (params.get('status') as Filter | null) ?? 'all';
  const page = Number(params.get('page') ?? 1);

  // Filters live in the URL, so they survive reloads and can be shared
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

  const query = { search: search || undefined, status: filter === 'all' ? undefined : filter, page, pageSize: PAGE_SIZE };
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ['platform', 'organizations', query],
    queryFn: () => api.listOrganizations(query),
    placeholderData: keepPreviousData,
  });

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={t('platform.eyebrow')}
          title={t('platform.organizations.title')}
          description={t('platform.organizations.description')}
          actions={
            <Button icon={<Plus className="size-4" />} onClick={() => update({ new: '1' })}>
              {t('platform.organizations.new')}
            </Button>
          }
        />
      </motion.div>

      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={onSearch} label={t('platform.organizations.search')} />
        <Segmented<Filter>
          label={t('platform.organizations.filter')}
          value={filter}
          onChange={(v) => update({ status: v === 'all' ? null : v, page: null })}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'ACTIVE', label: t('common.status.ACTIVE') },
            { value: 'SUSPENDED', label: t('common.status.SUSPENDED') },
          ]}
        />
        {data && (
          <span className="ms-auto text-sm text-ink-500" aria-live="polite">
            {t('platform.organizations.count', { count: data.total })}
          </span>
        )}
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className={isFetching && !isPending ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          {isPending ? (
            <SkeletonRows />
          ) : isError ? (
            <ErrorState onRetry={() => void refetch()} />
          ) : data.items.length === 0 ? (
            <EmptyState
              icon={<Building2 className="size-5" />}
              title={search || filter !== 'all' ? t('platform.organizations.noMatches') : t('platform.organizations.empty')}
              action={
                !search && filter === 'all' ? (
                  <Button icon={<Plus className="size-4" />} onClick={() => update({ new: '1' })}>
                    {t('platform.organizations.new')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-ink-100 text-start text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('platform.organizations.columns.name')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('platform.organizations.columns.status')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-end font-semibold">
                        {t('platform.organizations.columns.members')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('platform.organizations.columns.currency')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('platform.organizations.columns.created')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {data.items.map((o) => (
                      <tr key={o.id} className="cursor-pointer transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50" onClick={() => navigate(`/platform/organizations/${o.id}`)}>
                        <td className="px-4 py-3">
                          <Link to={`/platform/organizations/${o.id}`} className="font-semibold hover:text-brand-700 dark:hover:text-brand-300" dir="auto" onClick={(e) => e.stopPropagation()}>
                            {o.name}
                          </Link>
                          <p className="text-xs text-ink-400" dir="ltr">
                            {o.slug}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={o.status} />
                        </td>
                        <td className="tabular px-4 py-3 text-end">{new Intl.NumberFormat(locale).format(o.memberCount)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{o.baseCurrency}</td>
                        <td className="px-4 py-3 text-ink-500">
                          <time dateTime={o.createdAt} title={formatDate(o.createdAt, locale)}>
                            {formatRelative(o.createdAt, locale)}
                          </time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => update({ page: p > 1 ? String(p) : null })} />
            </>
          )}
        </Card>
      </motion.div>

      <CreateOrganizationModal open={params.get('new') === '1'} onClose={() => update({ new: null })} />
    </motion.div>
  );
}

function CreateOrganizationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const api = usePlatformApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [result, setResult] = useState<CreateOrganizationResult | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formKey, setFormKey] = useState(0);

  const create = useMutation({
    mutationFn: (v: OrganizationFormValues) =>
      api.createOrganization({
        name: v.name,
        slug: v.slug || undefined,
        baseCurrency: v.baseCurrency,
        country: v.country || null,
        locale: v.locale,
        fiscalYearStartMonth: v.fiscalYearStartMonth,
        owner: { email: v.ownerEmail },
        industry: (v.industry || undefined) as Industry | undefined,
      }),
    onSuccess: (r) => {
      setResult(r);
      void queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.kind === 'conflict' && e.details?.field === 'slug') setServerErrors({ slug: t('platform.form.errors.slugTaken') });
      else toast(apiErrorMessage(e, t), 'error');
    },
  });

  const close = () => {
    onClose();
    // Reset after the exit animation
    setTimeout(() => {
      setResult(null);
      setServerErrors({});
      create.reset();
      setFormKey((k) => k + 1);
    }, 200);
  };

  if (result) {
    const owner = result.owner;
    return (
      <Modal
        open={open}
        onClose={close}
        title={t('platform.create.doneTitle', { name: result.organization.name })}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              {t('common.done')}
            </Button>
            <Button
              onClick={() => {
                close();
                navigate(`/platform/organizations/${result.organization.id}`);
              }}
            >
              {t('platform.create.open')}
            </Button>
          </>
        }
      >
        {owner.status === 'added' ? (
          <p className="flex gap-2.5 rounded-xl bg-income/10 p-3 text-sm text-income">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> {t('platform.create.ownerAdded')}
          </p>
        ) : (
          <div className="space-y-4">
            <p className="flex gap-2.5 rounded-xl bg-brand-50 p-3 text-sm text-brand-800 dark:bg-brand-950/40 dark:text-brand-200">
              <MailPlus className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {t('platform.create.ownerInvited', { email: owner.email, date: formatDate(owner.expiresAt, locale) })}
              </span>
            </p>
            <CopyField label={t('platform.create.inviteLink')} value={owner.inviteUrl} />
            <p className="text-xs text-ink-500">{t('platform.create.inviteOnce')}</p>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={t('platform.create.title')}
      description={t('platform.create.description')}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="create-org" loading={create.isPending}>
            {t('platform.create.submit')}
          </Button>
        </>
      }
    >
      <OrganizationForm
        key={formKey}
        id="create-org"
        mode="create"
        initial={emptyOrganization}
        serverErrors={serverErrors}
        onSubmit={(v) => {
          setServerErrors({});
          create.mutate(v);
        }}
      />
    </Modal>
  );
}
