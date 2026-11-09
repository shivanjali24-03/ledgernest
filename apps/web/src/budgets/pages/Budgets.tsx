import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Building2, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { PNL_SECTIONS, toMinor, todayIn, type PnlSection } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useIntlLocale } from '../../i18n';
import { useMoney } from '../../lib/useMoney';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import { useOrganizationSettings } from '../../settings/useOrganizationSettings';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { SelectField, TextField } from '../../ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import Tabs from '../../ui/Tabs';
import { useToast } from '../../ui/toastContext';
import { NewBudgetDialog, RenameBudgetDialog } from '../BudgetDialog';
import { budgetErrorMessage } from '../errors';
import type { BudgetComparison, BudgetGrid, BudgetsApi } from '../types';
import { useBudgetsApi } from '../useBudgetsApi';

type Tab = 'plan' | 'comparison';
const incomeSide = (s: PnlSection) => s === 'revenue' || s === 'otherIncome';

/** Budgets: a plan for each income and expense account by month, and how the year is going against it. */
export default function Budgets() {
  const { t } = useTranslation();
  const session = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const api = useBudgetsApi();
  const canManage = session.permissions.has('accounts.manage');
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'comparison' ? 'comparison' : 'plan';
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const role = session.role ?? session.customRoleName;
  const list = useQuery({ queryKey: ['budgets', session.organizationId, role, 'list'], queryFn: () => api!.list(), enabled: !!api });
  const chosen = params.get('budget');
  const id = list.data?.some((b) => b.id === chosen) ? chosen! : list.data?.[0]?.id;
  const set = (next: Record<string, string | null>) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(next)) if (v === null) p.delete(k);
        else p.set(k, v);
        return p;
      },
      { replace: true },
    );
  const remove = useMutation({
    mutationFn: () => api!.remove(id!),
    onSuccess: () => {
      const name = list.data?.find((b) => b.id === id)?.name ?? '';
      setDeleting(false);
      set({ budget: null });
      void qc.invalidateQueries({ queryKey: ['budgets'] });
      toast(t('budgets.deleted', { name }));
    },
    onError: (e) => (setDeleting(false), toast(budgetErrorMessage(e, t), 'error')),
  });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }
  const current = list.data?.find((b) => b.id === id);
  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('budgets.title')}
          description={t('budgets.description')}
          actions={
            canManage ? (
              <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('budgets.new')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>
      {list.isPending ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : list.isError ? (
        <Card>
          <ErrorState onRetry={() => void list.refetch()} />
        </Card>
      ) : !current ? (
        <Card>
          <EmptyState icon={<Target className="size-5" />} title={t('budgets.empty')} body={t('budgets.emptyBody')} />
        </Card>
      ) : (
        <>
          <motion.div variants={fadeUp} className="flex flex-wrap items-end gap-3">
            <div className="w-72">
              <SelectField label={t('budgets.budget')} value={current.id} onChange={(e) => set({ budget: e.target.value })} options={list.data!.map((b) => ({ value: b.id, label: `${b.name} · ${b.fiscalYear.name}` }))} />
            </div>
            {canManage && (
              <RowMenu
                label={t('budgets.actionsFor', { name: current.name })}
                items={[
                  { key: 'rename', label: t('budgets.rename'), icon: Pencil, onSelect: () => setRenaming(true) },
                  { key: 'delete', label: t('budgets.delete'), icon: Trash2, danger: true, onSelect: () => setDeleting(true) },
                ]}
              />
            )}
          </motion.div>
          <motion.div variants={fadeUp}>
            <Tabs<Tab>
              label={t('budgets.title')}
              value={tab}
              onChange={(v) => set({ tab: v === 'plan' ? null : v })}
              tabs={[
                { value: 'plan', label: t('budgets.plan') },
                { value: 'comparison', label: t('budgets.comparison') },
              ]}
            />
          </motion.div>
          <motion.div variants={fadeUp} role="tabpanel">
            {tab === 'plan' ? <PlanGrid key={current.id} api={api} id={current.id} canManage={canManage} /> : <ComparisonTable key={current.id} api={api} id={current.id} />}
          </motion.div>
        </>
      )}
      {creating && <NewBudgetDialog api={api} budgets={list.data ?? []} onClose={() => setCreating(false)} onDone={(b) => (setCreating(false), set({ budget: b.id, tab: null }))} />}
      {renaming && current && <RenameBudgetDialog api={api} budget={current} onClose={() => setRenaming(false)} />}
      <ConfirmDialog open={deleting} title={t('budgets.deleteTitle', { name: current?.name ?? '' })} body={t('budgets.deleteBody')} confirmLabel={t('budgets.delete')} tone="danger" busy={remove.isPending} onConfirm={() => remove.mutate()} onClose={() => setDeleting(false)} />
    </motion.div>
  );
}

/** The plan: accounts down by section, the year's months across; editors type straight into the cells */
function PlanGrid({ api, id, canManage }: { api: BudgetsApi; id: string; canManage: boolean }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const session = useSession();
  const q = useQuery({ queryKey: ['budgets', session.organizationId, session.role ?? session.customRoleName, id], queryFn: () => api.get(id) });
  // Cells as typed, only for the rows someone has changed
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const dirty = Object.keys(draft).length > 0;
  const parsed = useMemo(() => Object.entries(draft).map(([accountId, cells]) => ({ accountId, amounts: cells.map((c) => (c.trim() ? toMinor(c, money.digits) : 0)) })), [draft, money.digits]);
  const invalid = parsed.some((l) => l.amounts.some((v) => v === null));
  const save = useMutation({
    mutationFn: () => api.setLines(id, parsed as { accountId: string; amounts: number[] }[]),
    onSuccess: (g) => {
      qc.setQueryData(['budgets', session.organizationId, session.role ?? session.customRoleName, id], g);
      void qc.invalidateQueries({ queryKey: ['budgets', session.organizationId, session.role ?? session.customRoleName, 'list'] });
      setDraft({});
      toast(t('budgets.saved', { name: g.name }));
    },
    onError: (e) => toast(budgetErrorMessage(e, t), 'error'),
  });
  if (q.isPending)
    return (
      <Card>
        <SkeletonRows rows={8} />
      </Card>
    );
  if (q.isError)
    return (
      <Card>
        <ErrorState onRetry={() => void q.refetch()} />
      </Card>
    );
  const g: BudgetGrid = q.data;
  const month = (m: string) => new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
  const cells = (accountId: string, amounts: number[]) => draft[accountId] ?? amounts.map((v) => (v ? money.plain(v) : ''));
  const amountsOf = (accountId: string, amounts: number[]) => (draft[accountId] ? parsed.find((l) => l.accountId === accountId)!.amounts.map((v) => v ?? 0) : amounts);
  const edit = (accountId: string, amounts: number[], k: number, v: string) => setDraft((d) => ({ ...d, [accountId]: cells(accountId, amounts).map((c, i) => (i === k ? v : c)) }));
  /** A year's total typed into the last column, spread evenly over the months (what doesn't divide goes in the last) */
  const spread = (accountId: string, v: string) => {
    const total = toMinor(v, money.digits);
    if (total === null) return;
    const each = Math.trunc(total / 12);
    setDraft((d) => ({ ...d, [accountId]: Array.from({ length: 12 }, (_x, k) => money.plain(k === 11 ? total - each * 11 : each)) }));
  };
  const sectionTotals = (sec: PnlSection) => g.months.map((_m, k) => g.rows.filter((r) => r.section === sec).reduce((s, r) => s + (amountsOf(r.accountId, r.amounts)[k] ?? 0), 0));
  const net = g.months.map((_m, k) => PNL_SECTIONS.reduce((s, sec) => s + (incomeSide(sec) ? 1 : -1) * sectionTotals(sec)[k]!, 0));
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const num = 'px-2 py-1.5 text-end font-mono tabular-nums whitespace-nowrap';
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3 dark:border-ink-800">
        <p className="flex-1 text-sm text-ink-500">{t('budgets.planHint', { year: g.fiscalYear.name, currency: money.currency })}</p>
        {canManage && dirty && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setDraft({})}>
              {t('budgets.discard')}
            </Button>
            <Button size="sm" loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th scope="col" className="sticky start-0 z-10 bg-white px-4 py-2 text-start font-semibold dark:bg-ink-900">
                {t('reports.statements.account')}
              </th>
              {g.months.map((m) => (
                <th key={m} scope="col" className="px-2 py-2 text-end font-semibold whitespace-nowrap">
                  {month(m)}
                </th>
              ))}
              <th scope="col" className="px-4 py-2 text-end font-semibold">
                {t('budgets.total')}
              </th>
            </tr>
          </thead>
          {PNL_SECTIONS.map((sec) => {
            const rows = g.rows.filter((r) => r.section === sec);
            if (!rows.length) return null;
            const totals = sectionTotals(sec);
            return (
              <tbody key={sec} className="border-t border-ink-100 dark:border-ink-800">
                <tr>
                  <th scope="rowgroup" colSpan={14} className="sticky start-0 bg-ink-50 px-4 py-1.5 text-start text-xs font-semibold uppercase tracking-wide text-ink-500 dark:bg-ink-800/60">
                    {t(`reports.statements.pnl.${sec}`)}
                  </th>
                </tr>
                {rows.map((r) => {
                  const am = amountsOf(r.accountId, r.amounts);
                  const label = `${r.code} · ${r.name}`;
                  return (
                    <tr key={r.accountId} className="border-t border-ink-50 dark:border-ink-800/60">
                      <th scope="row" className="sticky start-0 z-10 max-w-56 truncate bg-white px-4 py-1.5 text-start font-normal dark:bg-ink-900" dir="auto" title={label}>
                        <span className="font-mono text-xs text-ink-500" dir="ltr">
                          {r.code}
                        </span>{' '}
                        {r.name}
                      </th>
                      {g.months.map((m, k) =>
                        canManage ? (
                          <td key={m} className="px-1 py-1">
                            <input
                              aria-label={t('budgets.cell', { account: label, month: month(m) })}
                              value={cells(r.accountId, r.amounts)[k]}
                              onChange={(e) => edit(r.accountId, r.amounts, k, e.target.value)}
                              inputMode="decimal"
                              dir="ltr"
                              className={clsx('h-8 w-24 rounded-md border bg-white px-2 text-end font-mono text-sm dark:bg-ink-900', draft[r.accountId] && parsed.find((l) => l.accountId === r.accountId)?.amounts[k] === null ? 'border-expense' : 'border-ink-200 dark:border-ink-700')}
                            />
                          </td>
                        ) : (
                          <td key={m} className={num} dir="ltr">
                            {am[k] ? money.plain(am[k]!) : '—'}
                          </td>
                        ),
                      )}
                      <td className="px-2 py-1">
                        {canManage ? (
                          <input
                            key={sum(am)}
                            aria-label={t('budgets.yearTotal', { account: label })}
                            title={t('budgets.spreadHint')}
                            defaultValue={sum(am) ? money.plain(sum(am)) : ''}
                            onBlur={(e) => {
                              const v = toMinor(e.target.value, money.digits);
                              if (v !== null && v !== sum(am)) spread(r.accountId, e.target.value);
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                            inputMode="decimal"
                            dir="ltr"
                            className="h-8 w-28 rounded-md border border-ink-200 bg-ink-50 px-2 text-end font-mono text-sm font-semibold dark:border-ink-700 dark:bg-ink-800"
                          />
                        ) : (
                          <span className="block text-end font-mono font-semibold tabular-nums" dir="ltr">
                            {money.plain(sum(am))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-ink-100 font-semibold dark:border-ink-800">
                  <th scope="row" className="sticky start-0 z-10 bg-white px-4 py-1.5 text-start dark:bg-ink-900">
                    {t('reports.statements.totalOf', { section: t(`reports.statements.pnl.${sec}`) })}
                  </th>
                  {totals.map((v, k) => (
                    <td key={k} className={num} dir="ltr">
                      {money.plain(v)}
                    </td>
                  ))}
                  <td className={clsx(num, 'px-4')} dir="ltr">
                    {money.plain(sum(totals))}
                  </td>
                </tr>
              </tbody>
            );
          })}
          <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
            <tr>
              <th scope="row" className="sticky start-0 z-10 bg-white px-4 py-2 text-start dark:bg-ink-900">
                {t(sum(net) < 0 ? 'reports.statements.pnl.netLoss' : 'reports.statements.pnl.netProfit')}
              </th>
              {net.map((v, k) => (
                <td key={k} className={clsx(num, v < 0 && 'text-expense')} dir="ltr">
                  {money.plain(v)}
                </td>
              ))}
              <td className={clsx(num, 'px-4', sum(net) < 0 && 'text-expense')} dir="ltr">
                {money.plain(sum(net))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

/** A variance, signed so positive is better than planned, with an arrow and words as well as colour */
function Variance({ v, percent }: { v: number; percent?: number | null }) {
  const { t } = useTranslation();
  const money = useMoney();
  return (
    <span className={clsx('inline-flex items-center justify-end gap-1', v > 0 ? 'text-income' : v < 0 ? 'text-expense' : 'text-ink-500')}>
      {v > 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : v < 0 ? <ArrowDownRight className="size-3.5" aria-hidden /> : null}
      <span className="sr-only">{t(v >= 0 ? 'budgets.better' : 'budgets.worse')}</span>
      {money.plain(v)}
      {percent !== undefined && percent !== null && (
        <span className="text-xs text-ink-500">
          ({percent > 0 ? '+' : ''}
          {percent}%)
        </span>
      )}
    </span>
  );
}

/** Budget against actual for the year so far: each account's variance, positive when better than planned */
function ComparisonTable({ api, id }: { api: BudgetsApi; id: string }) {
  const { t } = useTranslation();
  const money = useMoney();
  const session = useSession();
  const settings = useOrganizationSettings().data;
  const [upTo, setUpTo] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const q = useQuery({ queryKey: ['budgets', session.organizationId, session.role ?? session.customRoleName, id, 'comparison', upTo], queryFn: () => api.comparison(id, upTo) });
  const c: BudgetComparison | undefined = q.data;
  const num = 'px-4 py-1.5 text-end font-mono tabular-nums whitespace-nowrap';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-48">
          <TextField label={t('budgets.upTo')} type="date" value={upTo} onChange={(e) => e.target.value && setUpTo(e.target.value)} />
        </div>
        {c && <p className="pb-2 text-sm text-ink-500">{t('budgets.monthsIn', { count: c.months, year: c.fiscalYear.name })}</p>}
      </div>
      <Card className="overflow-hidden">
        {q.isPending ? (
          <SkeletonRows rows={8} />
        ) : q.isError || !c ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : !c.sections.some((s) => s.rows.length) ? (
          <EmptyState icon={<Target className="size-5" />} title={t('budgets.nothingYet')} body={t('budgets.nothingYetBody')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-400">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-semibold">
                    {t('reports.statements.account')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-semibold">
                    {t('budgets.columns.budget')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-semibold">
                    {t('budgets.columns.actual')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-semibold">
                    {t('budgets.columns.variance')}
                  </th>
                </tr>
              </thead>
              {c.sections
                .filter((s) => s.rows.length)
                .map((s) => (
                  <tbody key={s.section} className="border-t border-ink-100 dark:border-ink-800">
                    <tr>
                      <th scope="rowgroup" colSpan={4} className="bg-ink-50 px-4 py-1.5 text-start text-xs font-semibold uppercase tracking-wide text-ink-500 dark:bg-ink-800/60">
                        {t(`reports.statements.pnl.${s.section}`)}
                      </th>
                    </tr>
                    {s.rows.map((r) => (
                      <tr key={r.accountId} className="border-t border-ink-50 dark:border-ink-800/60">
                        <th scope="row" className="px-4 py-1.5 text-start font-normal" dir="auto">
                          <span className="font-mono text-xs text-ink-500" dir="ltr">
                            {r.code}
                          </span>{' '}
                          {r.name}
                        </th>
                        <td className={num} dir="ltr">
                          {money.plain(r.budget)}
                        </td>
                        <td className={num} dir="ltr">
                          {money.plain(r.actual)}
                        </td>
                        <td className={num} dir="ltr">
                          <Variance v={r.variance} percent={r.percent} />
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-ink-100 font-semibold dark:border-ink-800">
                      <th scope="row" className="px-4 py-1.5 text-start">
                        {t('reports.statements.totalOf', { section: t(`reports.statements.pnl.${s.section}`) })}
                      </th>
                      <td className={num} dir="ltr">
                        {money.plain(s.budget)}
                      </td>
                      <td className={num} dir="ltr">
                        {money.plain(s.actual)}
                      </td>
                      <td className={num} dir="ltr">
                        <Variance v={s.variance} />
                      </td>
                    </tr>
                  </tbody>
                ))}
              <tfoot className="border-t-2 border-ink-200 font-semibold dark:border-ink-700">
                <tr>
                  <th scope="row" className="px-4 py-2 text-start">
                    {t('reports.statements.pnl.netProfit')}
                  </th>
                  <td className={num} dir="ltr">
                    {money.plain(c.netProfit.budget)}
                  </td>
                  <td className={num} dir="ltr">
                    {money.plain(c.netProfit.actual)}
                  </td>
                  <td className={num} dir="ltr">
                    <Variance v={c.netProfit.variance} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-ink-500">{t('budgets.varianceHint')}</p>
    </div>
  );
}
