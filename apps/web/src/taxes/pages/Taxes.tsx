import { useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Building2, Layers, MapPin, Pencil, Percent, Plus, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAccountsApi } from '../../accounts/useAccountsApi';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import { GroupDialog, GstSetupDialog, RateDialog } from '../TaxDialogs';
import { taxErrorMessage } from '../errors';
import type { TaxGroup, TaxRate } from '../types';
import { useTaxesApi } from '../useTaxesApi';

type Dialog = { kind: 'rate'; rate?: TaxRate } | { kind: 'group'; group?: TaxGroup } | { kind: 'gst' } | null;

/** Tax rates and groups. Indian organisations set GST up from the platform's slabs in one step. */
export default function Taxes() {
  const { t } = useTranslation();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useTaxesApi();
  const accountsApi = useAccountsApi();
  const canManage = session.permissions.has('taxes.manage');
  const key = ['taxes', session.organizationId, session.role ?? session.customRoleName] as const;
  const query = useQuery({ queryKey: key, queryFn: () => api!.list(), enabled: !!api });
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, session.role ?? session.customRoleName, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi && canManage });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showArchived, setShowArchived] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    // GST setup may add accounts
    void queryClient.invalidateQueries({ queryKey: ['accounts', session.organizationId] });
  };
  const archive = useMutation({
    mutationFn: async ({ what, id, on }: { what: 'rate' | 'group'; id: string; on: boolean; name: string }): Promise<unknown> => (what === 'rate' ? api!.archiveRate(id, on) : api!.archiveGroup(id, on)),
    onSuccess: (_r, v) => {
      toast(t(v.on ? 'taxes.archived' : 'taxes.restored', { name: v.name }));
      refresh();
    },
    onError: (e) => toast(taxErrorMessage(e, t), 'error'),
  });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }

  const data = query.data;
  const gst = data?.gst ?? null;
  const pending = gst?.slabs.filter((s) => s.inForce && !s.setUp) ?? [];
  const groups = data?.groups.filter((g) => showArchived || !g.archived) ?? [];
  const rates = data?.rates.filter((r) => showArchived || !r.archived) ?? [];
  const archivedCount = (data?.groups.filter((g) => g.archived).length ?? 0) + (data?.rates.filter((r) => r.archived).length ?? 0);

  const groupMenu = (g: TaxGroup) => [
    { key: 'rename', label: t('taxes.rename'), icon: Pencil, onSelect: () => setDialog({ kind: 'group', group: g }) },
    g.archived
      ? { key: 'restore', label: t('taxes.restore'), icon: ArchiveRestore, onSelect: () => archive.mutate({ what: 'group', id: g.id, on: false, name: g.name }) }
      : { key: 'archive', label: t('taxes.archive'), icon: Archive, onSelect: () => archive.mutate({ what: 'group', id: g.id, on: true, name: g.name }) },
  ];
  const rateMenu = (r: TaxRate) => [
    { key: 'edit', label: t('taxes.edit'), icon: Pencil, onSelect: () => setDialog({ kind: 'rate', rate: r }) },
    r.archived
      ? { key: 'restore', label: t('taxes.restore'), icon: ArchiveRestore, onSelect: () => archive.mutate({ what: 'rate', id: r.id, on: false, name: r.name }) }
      : { key: 'archive', label: t('taxes.archive'), icon: Archive, onSelect: () => archive.mutate({ what: 'rate', id: r.id, on: true, name: r.name }) },
  ];

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('taxes.title')}
          description={t('taxes.description')}
          actions={
            canManage && data ? (
              <>
                <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => setDialog({ kind: 'rate' })}>
                  {t('taxes.addRate')}
                </Button>
                <Button variant={gst ? 'ghost' : 'primary'} icon={<Layers className="size-4" />} onClick={() => setDialog({ kind: 'group' })}>
                  {t('taxes.addGroup')}
                </Button>
                {gst && (
                  <Button icon={<Sparkles className="size-4" />} onClick={() => setDialog({ kind: 'gst' })}>
                    {t('taxes.gst.setup')}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      </motion.div>

      {query.isPending ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : query.isError ? (
        <Card>
          <ErrorState onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <>
          {gst && (
            <motion.div variants={fadeUp}>
              <Card className="flex flex-wrap items-start gap-4 p-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300" aria-hidden>
                  <MapPin className="size-5" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <h2 className="font-semibold">{gst.state ? t('taxes.gst.stateTitle', { state: gst.state.name, code: gst.state.code }) : t('taxes.gst.noStateTitle')}</h2>
                  <p className="text-sm text-ink-600 dark:text-ink-300">{t(gst.utgst ? 'taxes.gst.ruleUtgst' : 'taxes.gst.ruleSgst')}</p>
                  {!gst.state && (
                    <p className="text-sm text-ink-500">
                      <Trans i18nKey="taxes.gst.noStateBody" components={{ settings: <Link to="/settings" className="font-medium text-brand-700 underline dark:text-brand-300" /> }} />
                    </p>
                  )}
                  {pending.length > 0 && <p className="text-sm text-warning">{t('taxes.gst.pending', { count: pending.length, rates: pending.map((s) => s.rate).join(', ') })}</p>}
                </div>
              </Card>
            </motion.div>
          )}

          {!data!.groups.length && !data!.rates.length ? (
            <motion.div variants={fadeUp}>
              <Card>
                <EmptyState
                  icon={<Percent className="size-5" />}
                  title={t('taxes.empty')}
                  body={t(gst ? 'taxes.emptyBodyGst' : 'taxes.emptyBody')}
                  action={
                    canManage && gst ? (
                      <Button icon={<Sparkles className="size-4" />} onClick={() => setDialog({ kind: 'gst' })}>
                        {t('taxes.gst.setup')}
                      </Button>
                    ) : undefined
                  }
                />
              </Card>
            </motion.div>
          ) : (
            <>
              {archivedCount > 0 && (
                <label className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
                  <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4 rounded accent-brand-600" />
                  {t('taxes.showArchived', { count: archivedCount })}
                </label>
              )}
              <motion.div variants={fadeUp}>
                <Card className="overflow-hidden">
                  <header className="border-b border-ink-100 px-5 py-3 dark:border-ink-800">
                    <h2 className="font-semibold">{t('taxes.groups')}</h2>
                    <p className="text-sm text-ink-500">{t('taxes.groupsHint')}</p>
                  </header>
                  <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                    {groups.map((g) => (
                      <li key={g.id} className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3', g.archived && 'opacity-60')}>
                        <span className="w-16 shrink-0 text-lg font-semibold tabular-nums">{g.total}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium" dir="auto">
                              {g.name}
                            </span>
                            {g.supply && <Pill tone={g.supply === 'intra' ? 'brand' : 'neutral'}>{t(`taxes.supply.${g.supply}`)}</Pill>}
                            {g.archived && <Pill>{t('taxes.archivedPill')}</Pill>}
                          </span>
                          <span className="block text-xs text-ink-500">{g.rates.map((r) => r.name).join(' + ')}</span>
                        </span>
                        {canManage && <RowMenu label={t('taxes.actionsFor', { name: g.name })} items={groupMenu(g)} />}
                      </li>
                    ))}
                  </ul>
                </Card>
              </motion.div>
              <motion.div variants={fadeUp}>
                <Card className="overflow-hidden">
                  <header className="border-b border-ink-100 px-5 py-3 dark:border-ink-800">
                    <h2 className="font-semibold">{t('taxes.rates')}</h2>
                    <p className="text-sm text-ink-500">{t('taxes.ratesHint')}</p>
                  </header>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[40rem] text-sm">
                      <thead className="text-start text-xs uppercase tracking-wide text-ink-500">
                        <tr>
                          <th className="px-5 py-2 text-start font-medium">{t('taxes.fields.name')}</th>
                          <th className="px-3 py-2 text-end font-medium">{t('taxes.fields.rate')}</th>
                          <th className="px-3 py-2 text-start font-medium">{t('taxes.columns.output')}</th>
                          <th className="px-3 py-2 text-start font-medium">{t('taxes.columns.input')}</th>
                          {canManage && (
                            <th className="w-12 px-3 py-2">
                              <span className="sr-only">{t('taxes.columns.actions')}</span>
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                        {rates.map((r) => (
                          <tr key={r.id} className={clsx(r.archived && 'opacity-60')}>
                            <td className="px-5 py-2.5">
                              <span className="font-medium" dir="auto">
                                {r.name}
                              </span>
                              <span className="ms-2 text-xs text-ink-500">{t(`taxes.kinds.${r.kind}`)}</span>
                              {r.archived && (
                                <span className="ms-2">
                                  <Pill>{t('taxes.archivedPill')}</Pill>
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-end tabular-nums">{r.rate}</td>
                            <td className="px-3 py-2.5 text-ink-600 dark:text-ink-300" dir="auto">
                              {r.outputAccount.code} · {r.outputAccount.name}
                            </td>
                            <td className="px-3 py-2.5 text-ink-600 dark:text-ink-300" dir="auto">
                              {r.inputAccount ? `${r.inputAccount.code} · ${r.inputAccount.name}` : '—'}
                            </td>
                            {canManage && (
                              <td className="px-3 py-1.5">
                                <RowMenu label={t('taxes.actionsFor', { name: r.name })} items={rateMenu(r)} />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </motion.div>
            </>
          )}
        </>
      )}

      {dialog?.kind === 'rate' && <RateDialog rate={dialog.rate} accounts={accounts.data ?? []} api={api} onClose={() => setDialog(null)} onSaved={() => (setDialog(null), refresh())} />}
      {dialog?.kind === 'group' && <GroupDialog group={dialog.group} rates={data?.rates ?? []} api={api} onClose={() => setDialog(null)} onSaved={() => (setDialog(null), refresh())} />}
      {dialog?.kind === 'gst' && gst && (
        <GstSetupDialog
          gst={gst}
          api={api}
          onClose={() => setDialog(null)}
          onDone={(r) => {
            setDialog(null);
            toast(r.created.groups.length ? t('taxes.gst.done', { count: r.created.groups.length }) : t('taxes.gst.nothingNew'));
            refresh();
          }}
        />
      )}
    </motion.div>
  );
}
