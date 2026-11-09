import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_TYPES, MAX_ACCOUNT_DEPTH, type AccountType } from '@ledgernest/shared';
import { Archive, ArchiveRestore, Building2, LayoutTemplate, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListTree, Lock, Pencil, Plus, SearchX, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, PageHeader, Pill, SearchInput, Segmented, SkeletonRows } from '../../ui/Kit';
import RowMenu from '../../ui/RowMenu';
import { useToast } from '../../ui/toastContext';
import AccountDialog, { type Editing } from '../AccountDialog';
import TemplateDialog from '../TemplateDialog';
import { accountErrorMessage } from '../errors';
import { flattenTree, levelOf, searchAccounts } from '../tree';
import type { Account } from '../types';
import { useAccountsApi } from '../useAccountsApi';

type Filter = 'all' | AccountType;
type Confirming = { action: 'archive' | 'delete'; account: Account };

/** The chart of accounts: every account as a tree, grouped by type. */
export default function ChartOfAccounts() {
  const { t } = useTranslation();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const api = useAccountsApi();
  const canManage = session.permissions.has('accounts.manage');
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const filter = (ACCOUNT_TYPES as readonly string[]).includes(params.get('type') ?? '') ? (params.get('type') as AccountType) : 'all';
  const showArchived = params.get('archived') === '1';
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [picking, setPicking] = useState(false);

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
  const onSearch = useCallback((v: string) => update({ q: v || null }), [update]);

  const key = ['accounts', session.organizationId, session.role ?? session.customRoleName] as const;
  // Always load archived accounts too: they're needed to explain the tree, and filtering locally is instant
  const query = useQuery({ queryKey: [...key, 'all'], queryFn: () => api!.list(true), enabled: !!api });
  const all = useMemo(() => query.data ?? [], [query.data]);
  const visible = useMemo(() => searchAccounts(showArchived ? all : all.filter((a) => !a.archived), search), [all, showArchived, search]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const act = useMutation({
    mutationFn: async ({ action, account }: { action: 'archive' | 'restore' | 'delete'; account: Account }): Promise<void> => {
      if (action === 'archive') await api!.archive(account.id);
      else if (action === 'restore') await api!.restore(account.id);
      else await api!.remove(account.id);
    },
    onSuccess: (_r, { action, account }) => {
      setConfirming(null);
      toast(t(`accounts.done.${action}`, { name: account.name }));
      void refresh();
    },
    onError: (e) => {
      setConfirming(null);
      toast(accountErrorMessage(e, t), 'error');
    },
  });

  if (!api) {
    return (
      <Card>
        <EmptyState icon={<Building2 className="size-5" />} title={t('team.noOrganization')} body={t('team.noOrganizationBody')} />
      </Card>
    );
  }

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // While searching, every match is shown expanded
  const effectiveCollapsed = search ? new Set<string>() : collapsed;
  const groups = (filter === 'all' ? ACCOUNT_TYPES : [filter]).map((type) => ({ type, rows: flattenTree(visible.filter((a) => a.type === type), effectiveCollapsed) }));
  const total = visible.length;
  const parents = all.filter((a) => a.childCount > 0).map((a) => a.id);

  const menuFor = (a: Account) =>
    canManage
      ? [
          { key: 'edit', label: t('accounts.actions.edit'), icon: Pencil, onSelect: () => setEditing({ mode: 'edit', account: a }) },
          ...(!a.archived && levelOf(all, a.id) < MAX_ACCOUNT_DEPTH ? [{ key: 'sub', label: t('accounts.actions.addSub'), icon: Plus, onSelect: () => setEditing({ mode: 'create', parent: a }) }] : []),
          ...(a.system
            ? []
            : a.archived
              ? [{ key: 'restore', label: t('accounts.actions.restore'), icon: ArchiveRestore, onSelect: () => act.mutate({ action: 'restore', account: a }) }]
              : [{ key: 'archive', label: t('accounts.actions.archive'), icon: Archive, onSelect: () => setConfirming({ action: 'archive', account: a }) }]),
          ...(a.system || a.childCount > 0 ? [] : [{ key: 'delete', label: t('accounts.actions.delete'), icon: Trash2, danger: true, onSelect: () => setConfirming({ action: 'delete', account: a }) }]),
        ]
      : [];

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader
          eyebrow={<span dir="auto">{session.organization}</span>}
          title={t('accounts.title')}
          description={t('accounts.description')}
          actions={
            canManage ? (
              <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ mode: 'create', type: filter === 'all' ? undefined : filter })}>
                {t('accounts.new')}
              </Button>
            ) : undefined
          }
        />
      </motion.div>

      {/* A new organisation has only its system accounts: offer a ready-made chart */}
      {canManage && query.data && all.every((a) => a.system) && (
        <motion.div variants={fadeUp}>
          <Card className="flex flex-wrap items-center gap-4 border-brand-200 bg-brand-50/60 p-5 dark:border-brand-900 dark:bg-brand-900/20">
            <span className="grid size-10 place-items-center rounded-xl bg-white text-brand-700 shadow-card dark:bg-ink-900 dark:text-brand-300">
              <LayoutTemplate className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{t('accounts.templates.bannerTitle')}</h2>
              <p className="text-sm text-ink-600 dark:text-ink-300">{t('accounts.templates.bannerBody')}</p>
            </div>
            <Button onClick={() => setPicking(true)}>{t('accounts.templates.use')}</Button>
          </Card>
        </motion.div>
      )}

      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={onSearch} label={t('accounts.search')} />
        <Segmented<Filter>
          label={t('accounts.filter')}
          value={filter}
          onChange={(v) => update({ type: v === 'all' ? null : v })}
          options={[{ value: 'all', label: t('common.all') }, ...ACCOUNT_TYPES.map((x) => ({ value: x, label: t(`accounts.typesPlural.${x}`) }))]}
        />
        <label className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-300">
          <input type="checkbox" checked={showArchived} onChange={(e) => update({ archived: e.target.checked ? '1' : null })} className="size-4 accent-brand-700" />
          {t('accounts.showArchived')}
        </label>
        <div className="ms-auto flex gap-1">
          <Button variant="ghost" size="sm" icon={<ChevronsUpDown className="size-4" />} onClick={() => setCollapsed(new Set())} disabled={!!search}>
            {t('accounts.expandAll')}
          </Button>
          <Button variant="ghost" size="sm" icon={<ChevronsDownUp className="size-4" />} onClick={() => setCollapsed(new Set(parents))} disabled={!!search}>
            {t('accounts.collapseAll')}
          </Button>
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="overflow-hidden">
          {query.isPending ? (
            <SkeletonRows rows={8} />
          ) : query.isError ? (
            <ErrorState onRetry={() => void query.refetch()} />
          ) : total === 0 ? (
            search ? (
              <EmptyState icon={<SearchX className="size-5" />} title={t('accounts.noMatches')} />
            ) : (
              <EmptyState icon={<ListTree className="size-5" />} title={t('accounts.empty')} body={t('accounts.emptyBody')} />
            )
          ) : (
            groups
              .filter((g) => g.rows.length)
              .map(({ type, rows }) => (
                <section key={type} aria-labelledby={`accounts-${type}`}>
                  <h2 id={`accounts-${type}`} className="flex items-baseline gap-2 border-b border-ink-100 bg-ink-50/70 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-400 dark:border-ink-800 dark:bg-ink-950/30">
                    {t(`accounts.typesPlural.${type}`)}
                    <span className="font-normal normal-case tracking-normal">{t(`accounts.hints.normal.${type === 'asset' || type === 'expense' ? 'debit' : 'credit'}`)}</span>
                  </h2>
                  <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                    {rows.map(({ account: a, depth, hasChildren }) => (
                      <li key={a.id} className={clsx('flex items-center gap-2 py-2 pe-3 hover:bg-ink-50 dark:hover:bg-ink-800/40', a.archived && 'text-ink-400')} style={{ paddingInlineStart: `${12 + depth * 24}px` }}>
                        {hasChildren && !search ? (
                          <button
                            type="button"
                            onClick={() => toggle(a.id)}
                            aria-expanded={!effectiveCollapsed.has(a.id)}
                            aria-label={t(effectiveCollapsed.has(a.id) ? 'accounts.expand' : 'accounts.collapse', { name: a.name })}
                            className="grid size-6 place-items-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"
                          >
                            <ChevronRight className={clsx('size-4 transition-transform rtl:-scale-x-100', !effectiveCollapsed.has(a.id) && 'rotate-90 rtl:-rotate-90')} aria-hidden />
                          </button>
                        ) : (
                          <span className="size-6" aria-hidden />
                        )}
                        <code className="w-24 shrink-0 truncate text-xs text-ink-500" dir="ltr">
                          {a.code}
                        </code>
                        <span className="min-w-0 flex-1">
                          <span className={clsx('block truncate text-sm', depth === 0 && 'font-semibold')} dir="auto">
                            {a.name}
                          </span>
                          {a.description && (
                            <span className="block truncate text-xs text-ink-400" dir="auto">
                              {a.description}
                            </span>
                          )}
                        </span>
                        <span className="hidden text-xs text-ink-400 sm:inline">{t(`accounts.subtypes.${a.subtype}`)}</span>
                        {a.system && (
                          <span title={t('accounts.systemHint')}>
                            <Pill>
                              <Lock className="me-1 size-3" aria-hidden />
                              {t('accounts.system')}
                            </Pill>
                          </span>
                        )}
                        {a.archived && <Pill>{t('accounts.archived')}</Pill>}
                        <RowMenu label={t('accounts.actionsFor', { name: a.name })} items={menuFor(a)} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
          )}
        </Card>
      </motion.div>

      {editing && (
        <AccountDialog
          editing={editing}
          accounts={all}
          api={api}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
      {picking && (
        <TemplateDialog
          api={api}
          onClose={() => setPicking(false)}
          onApplied={() => {
            setPicking(false);
            void refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={!!confirming}
        title={confirming ? t(`accounts.confirm.${confirming.action}Title`, { name: confirming.account.name }) : ''}
        body={confirming ? t(`accounts.confirm.${confirming.action}Body`) : ''}
        confirmLabel={confirming ? t(`accounts.actions.${confirming.action}`) : ''}
        tone={confirming?.action === 'delete' ? 'danger' : 'primary'}
        busy={act.isPending}
        onConfirm={() => confirming && act.mutate(confirming)}
        onClose={() => setConfirming(null)}
      />
    </motion.div>
  );
}
