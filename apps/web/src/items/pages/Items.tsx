import { useDeferredValue, useState } from 'react';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Building2, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../layout/session';
import { useMoney } from '../../lib/useMoney';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SearchInput, Segmented, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import ItemDialog from '../ItemDialog';
import { itemErrorMessage } from '../errors';
import type { Item } from '../types';
import { useItemsApi } from '../useItemsApi';

type Filter = 'all' | 'goods' | 'service';

/** Products and services to put on invoices and bills. */
export default function Items() {
  const { t } = useTranslation();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useItemsApi();
  const canManage = session.permissions.has('invoices.manage');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const key = ['items', session.organizationId, session.role ?? session.customRoleName] as const;
  const query = useQuery({ queryKey: [...key, filter, deferred, archived], queryFn: () => api!.list({ search: deferred || undefined, kind: filter === 'all' ? undefined : filter, archived }), enabled: !!api, placeholderData: keepPreviousData });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['items', session.organizationId] });
  const archive = useMutation({
    mutationFn: ({ i, on }: { i: Item; on: boolean }) => api!.archive(i.id, on),
    onSuccess: (i, { on }) => {
      toast(t(on ? 'items.archived' : 'items.restored', { name: i.name }));
      refresh();
    },
    onError: (e) => toast(itemErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: (i: Item) => api!.remove(i.id),
    onSuccess: (_r, i) => {
      setDeleting(null);
      toast(t('items.deleted', { name: i.name }));
      refresh();
    },
    onError: (e) => {
      setDeleting(null);
      toast(itemErrorMessage(e, t), 'error');
    },
  });

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
          title={t('items.title')}
          description={t('items.description')}
          actions={
            canManage ? (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                {t('items.add')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
        <Segmented<Filter>
          label={t('items.filter')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('items.all') },
            { value: 'service', label: t('items.services') },
            { value: 'goods', label: t('items.goods') },
          ]}
        />
        <div className="min-w-56 flex-1">
          <SearchInput value={search} onChange={setSearch} label={t('items.search')} />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="size-4 rounded accent-brand-600" />
          {t('items.showArchived')}
        </label>
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows rows={5} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : !query.data.length ? (
            <EmptyState icon={<Package className="size-5" />} title={search || filter !== 'all' || archived ? t('items.noMatches') : t('items.empty')} body={search || archived ? undefined : t('items.emptyBody')} />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {query.data.map((i) => (
                <li key={i.id} className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3', i.archived && 'opacity-70')}>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" dir="auto">
                        {i.name}
                      </span>
                      <Pill>{t(`items.kinds.${i.kind}`)}</Pill>
                      {i.taxGroup && <Pill tone="brand">{i.taxGroup.name}</Pill>}
                      {i.stock && <Pill tone="brand">{t('inventory.onHandPill', { quantity: i.stock.onHand, unit: i.unit ?? '' })}</Pill>}
                      {i.stock?.low && <Pill>{t('inventory.lowPill')}</Pill>}
                      {i.archived && <Pill>{t('items.archivedPill')}</Pill>}
                    </span>
                    <span className="block truncate text-sm text-ink-500" dir="auto">
                      {[i.sku, i.hsnSac && `${t(i.kind === 'goods' ? 'items.fields.hsn' : 'items.fields.sac')} ${i.hsnSac}`, i.incomeAccount && `${i.incomeAccount.code} · ${i.incomeAccount.name}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="text-end font-mono text-sm tabular-nums" dir="ltr">
                    {i.salePrice !== null ? money.format(i.salePrice) : '—'}
                    {i.unit && <span className="ms-1 text-xs text-ink-500">/ {i.unit}</span>}
                    {i.purchasePrice !== null && <span className="block text-xs text-ink-500">{t('items.costs', { amount: money.format(i.purchasePrice) })}</span>}
                  </span>
                  {canManage && (
                    <RowMenu
                      label={t('items.actionsFor', { name: i.name })}
                      items={[
                        { key: 'edit', label: t('items.edit'), icon: Pencil, onSelect: () => setEditing(i) },
                        i.archived
                          ? { key: 'restore', label: t('items.restore'), icon: ArchiveRestore, onSelect: () => archive.mutate({ i, on: false }) }
                          : { key: 'archive', label: t('items.archive'), icon: Archive, onSelect: () => archive.mutate({ i, on: true }) },
                        { key: 'delete', label: t('items.delete'), icon: Trash2, danger: true, onSelect: () => setDeleting(i) },
                      ]}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.div>
      {editing && (
        <ItemDialog
          item={editing === 'new' ? undefined : editing}
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
        title={deleting ? t('items.deleteTitle', { name: deleting.name }) : ''}
        body={t('items.deleteBody')}
        confirmLabel={t('items.delete')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </motion.div>
  );
}
