import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fiscalYearOf, fiscalYearSpan, todayIn } from '@ledgernest/shared';
import { Building2, Calculator, LogOut, Monitor, Plus, Trash2, Undo2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { useOrganizationSettings } from '../../settings/useOrganizationSettings';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { TextField } from '../../ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pill, Segmented, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import { AssetDialog, DisposeDialog, RunDialog } from '../AssetDialogs';
import { assetErrorMessage } from '../errors';
import type { FixedAsset } from '../types';
import { useAssetsApi } from '../useAssetsApi';

const num = 'px-4 py-2 text-end font-mono tabular-nums';

/** The fixed asset register: what's owned, what it's worth now, depreciation runs, and the schedule for a period. */
export default function FixedAssets() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useOrganizationSettings().data;
  const api = useAssetsApi();
  const canManage = session.permissions.has('journals.post');
  const today = todayIn(settings?.timeZone ?? 'Asia/Kolkata');
  const year = fiscalYearSpan(fiscalYearOf(today, settings?.fiscalYearStartMonth ?? 4), settings?.fiscalYearStartMonth ?? 4);
  const [view, setView] = useState<'register' | 'schedule'>('register');
  const [from, setFrom] = useState(year.startDate);
  const [to, setTo] = useState(today);
  const [dialog, setDialog] = useState<'add' | 'run' | null>(null);
  const [disposing, setDisposing] = useState<FixedAsset | null>(null);
  const [deleting, setDeleting] = useState<FixedAsset | null>(null);
  const key = ['assets', session.organizationId, session.role ?? session.customRoleName] as const;
  const list = useQuery({ queryKey: [...key, 'list'], queryFn: () => api!.list(), enabled: !!api });
  const runs = useQuery({ queryKey: [...key, 'runs'], queryFn: () => api!.runs(), enabled: !!api });
  const schedule = useQuery({ queryKey: [...key, 'schedule', from, to], queryFn: () => api!.schedule(from, to), enabled: !!api && view === 'schedule' && from <= to, placeholderData: keepPreviousData });
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      for (const k of ['assets', 'journals', 'reports']) void qc.invalidateQueries({ queryKey: [k] });
      setDeleting(null);
    },
    onError: (e) => {
      setDeleting(null);
      toast(assetErrorMessage(e, t), 'error');
    },
  });
  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const active = (list.data ?? []).filter((a) => a.status === 'active');
  const totals = { cost: active.reduce((s, a) => s + a.cost, 0), accumulated: active.reduce((s, a) => s + a.accumulated, 0), book: active.reduce((s, a) => s + a.bookValue, 0) };
  const how = (a: FixedAsset) => (a.method === 'straight_line' ? t('assets.slOver', { months: a.usefulLifeMonths }) : t('assets.wdvAt', { rate: a.wdvRate }));

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('assets.title')}
          description={t('assets.description')}
          actions={
            canManage ? (
              <>
                <Button variant="secondary" icon={<Calculator className="size-4" />} onClick={() => setDialog('run')} disabled={!active.length}>
                  {t('assets.runDepreciation')}
                </Button>
                <Button icon={<Plus className="size-4" />} onClick={() => setDialog('add')}>
                  {t('assets.add')}
                </Button>
              </>
            ) : undefined
          }
        />
      </motion.div>
      <motion.div variants={fadeUp} className="flex flex-wrap items-end gap-4">
        <Segmented<'register' | 'schedule'> label={t('assets.view')} value={view} onChange={setView} options={[{ value: 'register', label: t('assets.register') }, { value: 'schedule', label: t('assets.schedule') }]} />
        {view === 'schedule' && (
          <>
            <div className="w-44"><TextField label={t('reports.from')} type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
            <div className="w-44"><TextField label={t('reports.to')} type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
          </>
        )}
      </motion.div>

      {view === 'register' ? (
        <motion.div variants={fadeUp} className="grid grid-cols-[minmax(0,1fr)] gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="overflow-hidden">
            {list.isPending ? (
              <SkeletonRows rows={4} />
            ) : list.isError ? (
              <ErrorState onRetry={() => void list.refetch()} />
            ) : !list.data!.length ? (
              <EmptyState icon={<Monitor className="size-5" />} title={t('assets.empty')} body={t('assets.emptyBody')} />
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <caption className="sr-only">{t('assets.register')}</caption>
                  <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t('assets.columns.asset')}</th>
                      <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t('assets.columns.method')}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('assets.columns.cost')}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('assets.columns.accumulated')}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('assets.columns.bookValue')}</th>
                      <th scope="col" className="w-10"><span className="sr-only">{t('assets.columns.actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {list.data!.map((a) => (
                      <tr key={a.id} className={clsx(a.status === 'disposed' && 'opacity-60')}>
                        <td className="px-4 py-2">
                          <span className="me-2 font-mono text-xs text-ink-500">{a.tag}</span>
                          <span className="font-medium" dir="auto">{a.name}</span>
                          {a.status === 'disposed' && <Pill>{t('assets.disposedPill')}</Pill>}
                          <span className="block text-xs text-ink-500">{t('assets.inService', { date: day(a.inServiceDate) })}{a.depreciatedTo && ` · ${t('assets.chargedTo', { date: day(a.depreciatedTo) })}`}</span>
                        </td>
                        <td className="px-4 py-2 text-ink-600 dark:text-ink-300">{how(a)}</td>
                        <td className={num} dir="ltr">{money.plain(a.cost)}</td>
                        <td className={num} dir="ltr">{money.plain(a.accumulated)}</td>
                        <td className={`${num} font-semibold`} dir="ltr">{money.plain(a.bookValue)}</td>
                        <td className="pe-2">
                          {canManage && a.status === 'active' && (
                            <RowMenu
                              label={t('assets.actionsFor', { tag: a.tag })}
                              items={[
                                { key: 'dispose', label: t('assets.dispose'), icon: LogOut, onSelect: () => setDisposing(a) },
                                ...(a.accumulated === a.openingAccumulated ? [{ key: 'delete', label: t('assets.delete'), icon: Trash2, danger: true, onSelect: () => setDeleting(a) }] : []),
                              ]}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
                    <tr>
                      <td className="px-4 py-2.5" colSpan={2}>{t('assets.inUse', { count: active.length })}</td>
                      <td className={num} dir="ltr">{money.plain(totals.cost)}</td>
                      <td className={num} dir="ltr">{money.plain(totals.accumulated)}</td>
                      <td className={num} dir="ltr">{money.plain(totals.book)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
          <Card className="self-start p-5">
            <h2 className="font-semibold">{t('assets.runs')}</h2>
            {runs.data && !runs.data.length ? (
              <p className="mt-2 text-sm text-ink-500">{t('assets.noRuns')}</p>
            ) : (
              <ul className="mt-3 divide-y divide-ink-100 text-sm dark:divide-ink-800">
                {(runs.data ?? []).map((r, n) => (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block">{t('assets.runTo', { date: day(r.upTo) })}</span>
                      <Link to={`/journals/${r.journalEntry.id}`} className="font-mono text-xs text-brand-700 hover:underline dark:text-brand-300" dir="ltr">{r.journalEntry.number}</Link>
                    </span>
                    <span className="font-mono tabular-nums" dir="ltr">{money.plain(r.total)}</span>
                    {canManage && n === 0 && (
                      <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => act.mutate(() => api.undoRun(r.id))} aria-label={t('assets.undoRun', { date: day(r.upTo) })}>
                        {t('assets.undo')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </motion.div>
      ) : (
        <motion.div variants={fadeUp}>
          <Card className="overflow-hidden">
            {schedule.isPending ? (
              <SkeletonRows rows={4} />
            ) : schedule.isError || !schedule.data ? (
              <ErrorState onRetry={() => void schedule.refetch()} />
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[960px] text-sm">
                  <caption className="sr-only">{t('assets.schedule')}</caption>
                  <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t('assets.columns.asset')}</th>
                      {(['openingCost', 'additions', 'disposals', 'closingCost', 'openingDepreciation', 'depreciation', 'depreciationOnDisposals', 'closingDepreciation', 'closingBookValue'] as const).map((k) => (
                        <th key={k} scope="col" className="px-3 py-2.5 text-end font-semibold">{t(`assets.sched.${k}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {[...schedule.data.rows.map((r) => ({ ...r, label: `${r.tag} ${r.name}`, total: false })), { ...schedule.data.totals, assetId: 'total', label: t('assets.total'), total: true }].map((r) => (
                      <tr key={r.assetId} className={clsx(r.total && 'border-t-2 border-ink-200 font-semibold dark:border-ink-700')}>
                        <td className="px-4 py-2" dir="auto">{r.label}</td>
                        {(['openingCost', 'additions', 'disposals', 'closingCost', 'openingDepreciation', 'depreciation', 'depreciationOnDisposals', 'closingDepreciation', 'closingBookValue'] as const).map((k) => (
                          <td key={k} className="px-3 py-2 text-end font-mono tabular-nums" dir="ltr">{r[k] ? money.plain(r[k]) : '–'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </motion.div>
      )}

      {dialog === 'add' && <AssetDialog api={api} onClose={() => setDialog(null)} />}
      {dialog === 'run' && <RunDialog api={api} onClose={() => setDialog(null)} />}
      {disposing && <DisposeDialog api={api} asset={disposing} onClose={() => setDisposing(null)} />}
      <ConfirmDialog open={!!deleting} title={deleting ? t('assets.deleteTitle', { tag: deleting.tag }) : ''} body={t('assets.deleteBody')} confirmLabel={t('assets.delete')} tone="danger" busy={act.isPending} onConfirm={() => deleting && act.mutate(() => api.remove(deleting.id))} onClose={() => setDeleting(null)} />
    </motion.div>
  );
}
