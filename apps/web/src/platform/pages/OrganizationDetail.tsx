import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Building2, Mail, Pencil, PlayCircle, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../auth/client';
import { useIntlLocale } from '../../i18n';
import { countryName, currencyName, formatDate, formatRelative, monthName } from '../../lib/format';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows, StatusBadge } from '../../ui/Kit';
import Modal from '../../ui/Modal';
import { useToast } from '../../ui/toastContext';
import { usePlatformApi } from '../context';
import { apiErrorMessage } from '../errors';
import { fromOrganization, type OrganizationFormValues } from '../formValues';
import OrganizationForm from '../OrganizationForm';
import type { OrganizationDetail as Detail } from '../types';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 px-5 py-3 text-sm">
      <dt className="text-ink-500">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{children}</dd>
    </div>
  );
}

export default function OrganizationDetail() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const api = usePlatformApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'suspend' | 'reactivate' | null>(null);

  const { data: org, isPending, isError, error, refetch } = useQuery({ queryKey: ['platform', 'organization', id], queryFn: () => api.getOrganization(id) });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform'] });
  const status = useMutation({
    mutationFn: ({ action, reason }: { action: 'suspend' | 'reactivate'; reason?: string }) => api.setOrganizationStatus(id, action, reason),
    onSuccess: (o) => {
      setConfirm(null);
      toast(o.status === 'SUSPENDED' ? t('platform.detail.suspended', { name: o.name }) : t('platform.detail.reactivated', { name: o.name }));
      void refresh();
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const edit = useMutation({
    mutationFn: (v: OrganizationFormValues) =>
      api.updateOrganization(id, { name: v.name, baseCurrency: v.baseCurrency, country: v.country || null, locale: v.locale, fiscalYearStartMonth: v.fiscalYearStartMonth }),
    onSuccess: () => {
      setEditing(false);
      toast(t('platform.detail.saved'));
      void refresh();
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });

  const back = (
    <Link to="/platform/organizations" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800 dark:hover:text-ink-200">
      <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t('platform.organizations.title')}
    </Link>
  );

  if (isPending) return <Card>{<SkeletonRows rows={6} />}</Card>;
  if (isError)
    return (
      <div className="space-y-4">
        {back}
        <Card>
          {error instanceof ApiError && error.kind === 'not_found' ? (
            <EmptyState icon={<Building2 className="size-5" />} title={t('platform.errors.notFound')} />
          ) : (
            <ErrorState onRetry={() => void refetch()} />
          )}
        </Card>
      </div>
    );

  const o: Detail = org;
  const suspended = o.status === 'SUSPENDED';
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp} className="space-y-3">
        {back}
        <PageHeader
          title={o.name}
          eyebrow={<StatusBadge status={o.status} />}
          actions={
            <>
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
              {suspended ? (
                <Button icon={<PlayCircle className="size-4" />} onClick={() => setConfirm('reactivate')}>
                  {t('platform.detail.reactivate')}
                </Button>
              ) : (
                <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setConfirm('suspend')}>
                  {t('platform.detail.suspend')}
                </Button>
              )}
            </>
          }
        />
        {suspended && <p className="rounded-xl bg-warning/10 p-3 text-sm text-warning">{t('platform.detail.suspendedNote')}</p>}
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <motion.div variants={fadeUp}>
          <Card>
            <h2 className="border-b border-ink-100 px-5 py-4 font-semibold dark:border-ink-800">{t('platform.detail.details')}</h2>
            <dl className="divide-y divide-ink-100 dark:divide-ink-800">
              <Row label={t('platform.form.slug')}>
                <span dir="ltr" className="font-mono text-xs">
                  {o.slug}
                </span>
              </Row>
              <Row label={t('platform.form.currency')}>
                {o.baseCurrency} · {currencyName(o.baseCurrency, locale)}
              </Row>
              <Row label={t('platform.form.country')}>{o.country ? countryName(o.country, locale) : '—'}</Row>
              <Row label={t('platform.form.fiscalYear')}>{monthName(o.fiscalYearStartMonth, locale)}</Row>
              <Row label={t('platform.form.locale')}>{o.locale}</Row>
              <Row label={t('platform.organizations.columns.created')}>{formatDate(o.createdAt, locale)}</Row>
            </dl>
          </Card>
        </motion.div>

        <motion.div variants={fadeUp} className="space-y-6">
          <Card>
            <h2 className="flex items-center justify-between border-b border-ink-100 px-5 py-4 font-semibold dark:border-ink-800">
              {t('platform.detail.people')}
              <span className="text-sm font-normal text-ink-500">{t('platform.detail.memberCount', { count: o.memberCount })}</span>
            </h2>
            <div className="px-5 py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">{t('roles.owner')}</h3>
              {o.owners.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">{t('platform.detail.noOwner')}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {o.owners.map((u) => (
                    <li key={u.id} className="flex items-center gap-2.5 text-sm">
                      <UserRound className="size-4 text-ink-400" aria-hidden />
                      <span className="font-medium" dir="auto">
                        {u.name}
                      </span>
                      <span className="truncate text-ink-500" dir="ltr">
                        {u.email}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {o.pendingInvitations.length > 0 && (
                <>
                  <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-400">{t('platform.detail.pending')}</h3>
                  <ul className="mt-2 space-y-2">
                    {o.pendingInvitations.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-2.5 text-sm">
                        <Mail className="size-4 text-ink-400" aria-hidden />
                        <span className="truncate" dir="ltr">
                          {i.email}
                        </span>
                        <span className="text-xs text-ink-500">{t('platform.detail.expires', { when: formatRelative(i.expiresAt, locale) })}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Card>
        </motion.div>
      </div>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        size="lg"
        title={t('platform.detail.editTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={edit.isPending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="edit-org" loading={edit.isPending}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <OrganizationForm id="edit-org" mode="edit" initial={fromOrganization(o)} onSubmit={(v) => edit.mutate(v)} />
      </Modal>

      <ConfirmDialog
        key={confirm ?? 'none'}
        open={confirm !== null}
        tone={confirm === 'suspend' ? 'danger' : 'primary'}
        askReason={confirm === 'suspend'}
        busy={status.isPending}
        title={confirm === 'suspend' ? t('platform.detail.suspendTitle', { name: o.name }) : t('platform.detail.reactivateTitle', { name: o.name })}
        body={confirm === 'suspend' ? t('platform.detail.suspendBody') : t('platform.detail.reactivateBody')}
        confirmLabel={confirm === 'suspend' ? t('platform.detail.suspend') : t('platform.detail.reactivate')}
        onConfirm={(reason) => confirm && status.mutate({ action: confirm, reason })}
        onClose={() => setConfirm(null)}
      />
    </motion.div>
  );
}
