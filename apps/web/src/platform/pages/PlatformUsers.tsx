import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, MoreHorizontal, PlayCircle, ShieldCheck, ShieldOff, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { formatDate, formatRelative } from '../../lib/format';
import { useSession } from '../../layout/session';
import { fadeUp, scaleIn, stagger } from '../../motion/tokens';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Pill, SearchInput, Segmented, SkeletonRows, StatusBadge } from '../../ui/Kit';
import { useToast } from '../../ui/toastContext';
import { usePlatformApi } from '../context';
import { apiErrorMessage } from '../errors';
import type { PlatformUser, UserAction } from '../types';

type Filter = 'all' | 'superAdmins' | 'suspended';
const PAGE_SIZE = 20;

function ActionsMenu({ user, isSelf, onPick }: { user: PlatformUser; isSelf: boolean; onPick: (a: UserAction) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const actions: { action: UserAction; icon: typeof Ban; danger?: boolean; disabled?: boolean }[] = [
    user.isSuperAdmin ? { action: 'demote', icon: ShieldOff } : { action: 'promote', icon: ShieldCheck, disabled: user.status !== 'ACTIVE' },
    user.status === 'ACTIVE' ? { action: 'suspend', icon: Ban, danger: true, disabled: isSelf } : { action: 'reactivate', icon: PlayCircle },
  ];

  return (
    <div ref={root} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('platform.users.actionsFor', { name: user.name })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-200"
      >
        <MoreHorizontal className="size-5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            variants={scaleIn}
            initial="hidden"
            animate="show"
            exit="exit"
            className="absolute end-0 z-30 mt-1 w-56 origin-top-right rounded-xl border border-ink-200 bg-white p-1 shadow-pop rtl:origin-top-left dark:border-ink-700 dark:bg-ink-900"
          >
            {actions.map(({ action, icon: Icon, danger, disabled }) => (
              <button
                key={action}
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  onPick(action);
                }}
                className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-start text-sm disabled:cursor-not-allowed disabled:opacity-40 ${danger ? 'text-expense hover:bg-expense/10' : 'hover:bg-ink-100 dark:hover:bg-ink-800'}`}
              >
                <Icon className="size-4" aria-hidden /> {t(`platform.users.actions.${action}`)}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function PlatformUsers() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const api = usePlatformApi();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const filter = (params.get('show') as Filter | null) ?? 'all';
  const page = Number(params.get('page') ?? 1);
  const [pending, setPending] = useState<{ user: PlatformUser; action: UserAction } | null>(null);

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

  const query = {
    search: search || undefined,
    superAdmin: filter === 'superAdmins' ? true : undefined,
    status: filter === 'suspended' ? ('SUSPENDED' as const) : undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const { data, isPending, isError, refetch } = useQuery({ queryKey: ['platform', 'users', query], queryFn: () => api.listUsers(query), placeholderData: keepPreviousData });

  const act = useMutation({
    mutationFn: ({ user, action, reason }: { user: PlatformUser; action: UserAction; reason?: string }) => api.userAction(user.id, action, reason),
    onSuccess: (u, { action }) => {
      setPending(null);
      toast(t(`platform.users.done.${action}`, { name: u.name }));
      void queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (e) => {
      setPending(null);
      toast(apiErrorMessage(e, t), 'error');
    },
  });

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp}>
        <PageHeader eyebrow={t('platform.eyebrow')} title={t('platform.users.title')} description={t('platform.users.description')} />
      </motion.div>

      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={onSearch} label={t('platform.users.search')} />
        <Segmented<Filter>
          label={t('platform.users.filter')}
          value={filter}
          onChange={(v) => update({ show: v === 'all' ? null : v, page: null })}
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'superAdmins', label: t('roles.super_admin') },
            { value: 'suspended', label: t('common.status.SUSPENDED') },
          ]}
        />
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card>
          {isPending ? (
            <SkeletonRows />
          ) : isError ? (
            <ErrorState onRetry={() => void refetch()} />
          ) : data.items.length === 0 ? (
            <EmptyState icon={<Users className="size-5" />} title={t('platform.users.noMatches')} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('platform.users.columns.person')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('platform.users.columns.access')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('platform.organizations.columns.status')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-end font-semibold">
                        {t('platform.users.columns.organizations')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-start font-semibold">
                        {t('platform.users.columns.lastSignIn')}
                      </th>
                      <th scope="col" className="px-4 py-3">
                        <span className="sr-only">{t('platform.users.columns.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                    {data.items.map((u) => {
                      const isSelf = u.email === session.email;
                      return (
                        <tr key={u.id}>
                          <td className="px-4 py-3">
                            <p className="flex items-center gap-2 font-semibold">
                              <span dir="auto">{u.name}</span>
                              {isSelf && <Pill>{t('platform.users.you')}</Pill>}
                            </p>
                            <p className="text-xs text-ink-500" dir="ltr">
                              {u.email}
                            </p>
                          </td>
                          <td className="px-4 py-3">{u.isSuperAdmin ? <Pill tone="brand">{t('roles.super_admin')}</Pill> : <span className="text-ink-500">{t('platform.users.member')}</span>}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={u.status} />
                          </td>
                          <td className="tabular px-4 py-3 text-end">{new Intl.NumberFormat(locale).format(u.organizationCount)}</td>
                          <td className="px-4 py-3 text-ink-500">
                            {u.lastLoginAt ? (
                              <time dateTime={u.lastLoginAt} title={formatDate(u.lastLoginAt, locale)}>
                                {formatRelative(u.lastLoginAt, locale)}
                              </time>
                            ) : (
                              t('platform.users.never')
                            )}
                          </td>
                          <td className="px-4 py-3 text-end">
                            <ActionsMenu user={u} isSelf={isSelf} onPick={(action) => setPending({ user: u, action })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => update({ page: p > 1 ? String(p) : null })} />
            </>
          )}
        </Card>
      </motion.div>

      <ConfirmDialog
        key={pending ? `${pending.user.id}-${pending.action}` : 'none'}
        open={pending !== null}
        tone={pending?.action === 'suspend' || pending?.action === 'demote' ? 'danger' : 'primary'}
        askReason={pending?.action === 'suspend'}
        busy={act.isPending}
        title={pending ? t(`platform.users.confirm.${pending.action}.title`, { name: pending.user.name }) : ''}
        body={pending ? t(`platform.users.confirm.${pending.action}.body`) : ''}
        confirmLabel={pending ? t(`platform.users.actions.${pending.action}`) : ''}
        onConfirm={(reason) => pending && act.mutate({ ...pending, reason })}
        onClose={() => setPending(null)}
      />
    </motion.div>
  );
}
