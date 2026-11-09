import { useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, BarChart3, Building2, Network, Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import CostCentreDialog from '../CostCentreDialog';
import { costCentreErrorMessage } from '../errors';
import type { CostCentre } from '../types';
import { useCostCentres, useCostCentresApi } from '../useCostCentresApi';

/** Cost centres and projects: the parts of the business lines are tagged with, to see profit by each. */
export default function CostCentres() {
  const { t } = useTranslation();
  const session = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const api = useCostCentresApi();
  const canManage = session.permissions.has('accounts.manage');
  const canReport = session.permissions.has('reports.view');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<CostCentre | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CostCentre | null>(null);
  const list = useCostCentres(archived);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['cost-centres'] });
  const archive = useMutation({
    mutationFn: ({ c, on }: { c: CostCentre; on: boolean }) => api!.archive(c.id, on),
    onSuccess: (c, { on }) => (toast(t(on ? 'costCentres.archived' : 'costCentres.restored', { name: c.name })), refresh()),
    onError: (e) => toast(costCentreErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: (c: CostCentre) => api!.remove(c.id),
    onSuccess: (_r, c) => (setDeleting(null), toast(t('costCentres.deleted', { name: c.name })), refresh()),
    onError: (e) => (setDeleting(null), toast(costCentreErrorMessage(e, t), 'error')),
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
          title={t('costCentres.title')}
          description={t('costCentres.description')}
          actions={
            canManage ? (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                {t('costCentres.add')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="size-4 rounded accent-brand-600" />
          {t('costCentres.showArchived')}
        </label>
        {canReport && (
          <Link to="/reports?tab=pnl&compare=costCentres" className="ms-auto inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
            <BarChart3 className="size-4" aria-hidden />
            {t('costCentres.profitBy')}
          </Link>
        )}
      </motion.div>
      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {list.isPending ? (
            <SkeletonRows rows={4} />
          ) : list.isError ? (
            <ErrorState onRetry={() => void list.refetch()} />
          ) : !list.data!.length ? (
            <EmptyState icon={<Network className="size-5" />} title={t('costCentres.empty')} body={t('costCentres.emptyBody')} />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {list.data!.map((c) => (
                <li key={c.id} className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3', c.archived && 'opacity-70')}>
                  <code className="w-32 shrink-0 font-mono text-sm text-ink-600 dark:text-ink-300" dir="ltr">
                    {c.code}
                  </code>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" dir="auto">
                        {c.name}
                      </span>
                      <Pill tone={c.kind === 'project' ? 'brand' : 'neutral'}>{t(`costCentres.kinds.${c.kind}`)}</Pill>
                      {c.archived && <Pill>{t('costCentres.archivedPill')}</Pill>}
                    </span>
                    {c.description && (
                      <span className="block truncate text-sm text-ink-500" dir="auto">
                        {c.description}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-ink-500">{t('costCentres.lines', { count: c.lines ?? 0 })}</span>
                  {canManage && (
                    <RowMenu
                      label={t('costCentres.actionsFor', { name: c.name })}
                      items={[
                        { key: 'edit', label: t('costCentres.edit'), icon: Pencil, onSelect: () => setEditing(c) },
                        c.archived ? { key: 'restore', label: t('costCentres.restore'), icon: ArchiveRestore, onSelect: () => archive.mutate({ c, on: false }) } : { key: 'archive', label: t('costCentres.archive'), icon: Archive, onSelect: () => archive.mutate({ c, on: true }) },
                        { key: 'delete', label: t('costCentres.delete'), icon: Trash2, danger: true, onSelect: () => setDeleting(c) },
                      ]}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.div>
      {editing && <CostCentreDialog api={api} centre={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} title={deleting ? t('costCentres.deleteTitle', { name: deleting.name }) : ''} body={t('costCentres.deleteBody')} confirmLabel={t('costCentres.delete')} tone="danger" busy={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting)} onClose={() => setDeleting(null)} />
    </motion.div>
  );
}
