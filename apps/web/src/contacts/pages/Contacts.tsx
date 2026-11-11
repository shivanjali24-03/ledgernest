import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Archive, ArchiveRestore, Building2, Contact as ContactIcon, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { INDIAN_STATES } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { countryName, formatMoney } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { saveBlob } from '../../lib/saveBlob';
import { apiErrorMessage } from '../../platform/errors';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Pill, SearchInput, Segmented, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import ContactDialog from '../ContactDialog';
import { contactErrorMessage } from '../errors';
import type { Contact } from '../types';
import { useContactsApi } from '../useContactsApi';

type Filter = 'all' | 'customer' | 'vendor';
const PAGE_SIZE = 25;

/** Customers and vendors: who the business sells to and buys from. */
export default function Contacts() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useContactsApi();
  const canManage = session.permissions.has('contacts.manage');
  const canReport = session.permissions.has('reports.view');
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [archived, setArchived] = useState(false);
  const canExport = session.permissions.has('reports.export');
  const exporting = useMutation({
    mutationFn: () => api!.exportList({ search: deferred || undefined, type: filter === 'all' ? undefined : filter, archived }),
    onSuccess: (f) => {
      saveBlob(f);
      toast(t('audit.exported', { file: f.filename }));
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const key = ['contacts', session.organizationId, session.role ?? session.customRoleName] as const;
  const query = useQuery({
    queryKey: [...key, filter, deferred, archived, page],
    queryFn: () => api!.list({ search: deferred || undefined, type: filter === 'all' ? undefined : filter, archived, page, pageSize: PAGE_SIZE }),
    enabled: !!api,
    placeholderData: keepPreviousData,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['contacts', session.organizationId] });
  const archive = useMutation({
    mutationFn: ({ c, on }: { c: Contact; on: boolean }) => api!.archive(c.id, on),
    onSuccess: (c, { on }) => {
      toast(t(on ? 'contacts.archived' : 'contacts.restored', { name: c.name }));
      refresh();
    },
    onError: (e) => toast(contactErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: (c: Contact) => api!.remove(c.id),
    onSuccess: (_r, c) => {
      setDeleting(null);
      toast(t('contacts.deleted', { name: c.name }));
      refresh();
    },
    onError: (e) => {
      setDeleting(null);
      toast(contactErrorMessage(e, t), 'error');
    },
  });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }
  const place = (c: Contact) => {
    const a = c.billingAddress;
    const region = a.country === 'IN' ? (INDIAN_STATES.find((s) => s.code === c.stateCode)?.name ?? a.region) : a.region;
    return [a.city, region, a.country && a.country !== 'IN' ? countryName(a.country, locale) : null].filter(Boolean).join(', ');
  };
  const data = query.data;
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('contacts.title')}
          description={t('contacts.description')}
          actions={
            <>
              {canExport && (
                <Button variant="secondary" icon={<Download className="size-4" />} loading={exporting.isPending} onClick={() => exporting.mutate()}>
                  {t('reports.export')}
                </Button>
              )}
              {canManage && (
                <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                  {t('contacts.add')}
                </Button>
              )}
            </>
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
        <Segmented<Filter>
          label={t('contacts.filter')}
          value={filter}
          onChange={(v) => (setFilter(v), setPage(1))}
          options={[
            { value: 'all', label: t('contacts.all') },
            { value: 'customer', label: t('contacts.customers') },
            { value: 'vendor', label: t('contacts.vendors') },
          ]}
        />
        <div className="min-w-56 flex-1">
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} label={t('contacts.search')} />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
          <input type="checkbox" checked={archived} onChange={(e) => (setArchived(e.target.checked), setPage(1))} className="size-4 rounded accent-brand-600" />
          {t('contacts.showArchived')}
        </label>
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows rows={6} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : !data!.items.length ? (
            <EmptyState icon={<ContactIcon className="size-5" />} title={search || filter !== 'all' || archived ? t('contacts.noMatches') : t('contacts.empty')} body={search || archived ? undefined : t('contacts.emptyBody')} />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {data!.items.map((c) => (
                <li
                  key={c.id}
                  // Columns that line up down the list: name | GSTIN | what's owed | terms | menu (on a phone: name | owed | menu)
                  className={clsx('grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_10.5rem_11rem_5.5rem_auto] sm:gap-x-4 sm:px-5', c.archived && 'opacity-70')}
                >
                  <span className="min-w-0 max-sm:col-start-1 max-sm:row-start-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link to={`/contacts/${c.id}`} className="text-start font-medium hover:underline" dir="auto">
                        {c.name}
                      </Link>
                      {c.isCustomer && <Pill tone="brand">{t('contacts.customer')}</Pill>}
                      {c.isVendor && <Pill>{t('contacts.vendor')}</Pill>}
                      {c.currency && <Pill>{c.currency}</Pill>}
                      {c.archived && <Pill>{t('contacts.archivedPill')}</Pill>}
                    </span>
                    <span className="block truncate text-sm text-ink-500" dir="auto">
                      {[c.legalName, place(c), c.email].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <code className="truncate text-xs text-ink-500 max-sm:col-start-1 max-sm:row-start-2" dir="ltr">
                    {c.taxId ?? ''}
                  </code>
                  <span className="flex flex-col items-end gap-0.5 max-sm:col-start-2 max-sm:row-start-1">
                  {!!c.receivable && (
                    <span className={clsx('whitespace-nowrap text-end text-sm tabular-nums', c.receivable > 0 ? 'text-ink-800 dark:text-ink-100' : 'text-income')} dir="ltr">
                      {t(c.receivable > 0 ? 'contacts.owes' : 'contacts.inCredit', { amount: c.currency ? formatMoney(Math.abs(c.receivable), c.currency, locale) : money.format(Math.abs(c.receivable)) })}
                    </span>
                  )}
                  {!!c.payable && (
                    <span className={clsx('whitespace-nowrap text-end text-sm tabular-nums', c.payable > 0 ? 'text-expense' : 'text-ink-500')} dir="ltr">
                      {t(c.payable > 0 ? 'contacts.weOwe' : 'contacts.paidAhead', { amount: c.currency ? formatMoney(Math.abs(c.payable), c.currency, locale) : money.format(Math.abs(c.payable)) })}
                    </span>
                  )}
                  </span>
                  <span className="text-end text-xs text-ink-500 max-sm:col-start-2 max-sm:row-start-2">{c.paymentTermsDays ? t('contacts.terms', { days: c.paymentTermsDays }) : t('contacts.onReceipt')}</span>
                  {(canManage || canReport) && (
                    <span className="max-sm:col-start-3 max-sm:row-span-2 max-sm:row-start-1">
                    <RowMenu
                      label={t('contacts.actionsFor', { name: c.name })}
                      items={[
                        // Their statement of account, in Reports
                        ...(canReport && c.isCustomer ? [{ key: 'statement-customer', label: t('contacts.customerStatement'), icon: FileText, onSelect: () => navigate(`/reports?tab=statement&contact=${c.id}`) }] : []),
                        ...(canReport && c.isVendor ? [{ key: 'statement-vendor', label: t('contacts.vendorStatement'), icon: FileText, onSelect: () => navigate(`/reports?tab=statement&side=payables&contact=${c.id}`) }] : []),
                        ...(canManage
                          ? [
                              { key: 'edit', label: t('contacts.edit'), icon: Pencil, onSelect: () => setEditing(c) },
                              c.archived
                                ? { key: 'restore', label: t('contacts.restore'), icon: ArchiveRestore, onSelect: () => archive.mutate({ c, on: false }) }
                                : { key: 'archive', label: t('contacts.archive'), icon: Archive, onSelect: () => archive.mutate({ c, on: true }) },
                              { key: 'delete', label: t('contacts.delete'), icon: Trash2, danger: true, onSelect: () => setDeleting(c) },
                            ]
                          : []),
                      ]}
                    />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.div>
      {data && data.total > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
      {editing && (
        <ContactDialog
          contact={editing === 'new' ? undefined : editing}
          defaultType={filter === 'vendor' ? 'vendor' : 'customer'}
          api={api}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={deleting ? t('contacts.deleteTitle', { name: deleting.name }) : ''}
        body={t('contacts.deleteBody')}
        confirmLabel={t('contacts.delete')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </motion.div>
  );
}
