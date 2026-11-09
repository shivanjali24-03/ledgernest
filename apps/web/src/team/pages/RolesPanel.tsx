import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ORGANIZATION_PERMISSIONS } from '@ledgernest/shared';
import { useSession } from '../../layout/session';
import { fadeUp, stagger } from '../../motion/tokens';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/Kit';
import Modal from '../../ui/Modal';
import { useToast } from '../../ui/toastContext';
import { teamErrorMessage } from '../errors';
import { useRoles, useTeamKey } from '../queries';
import RoleEditor, { type RoleDraft } from '../RoleEditor';
import type { CustomRoleRow } from '../types';
import { useTeamApi } from '../useTeamApi';

type Editing = { mode: 'create' } | { mode: 'edit'; role: CustomRoleRow } | { mode: 'view'; title: string; draft: RoleDraft };

function RoleCard({ title, description, count, members, actions, onOpen, builtIn }: { title: string; description?: string | null; count: number; members: number; actions?: ReactNode; onOpen: () => void; builtIn?: boolean }) {
  const { t } = useTranslation();
  return (
    <motion.article variants={fadeUp} className="lift flex flex-col rounded-card border border-ink-200 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-start gap-2">
        <h3 className="flex-1 font-semibold" dir="auto">
          {title}
        </h3>
        {builtIn && <Lock className="size-4 text-ink-400" aria-label={t('team.roles.builtInLocked')} />}
      </div>
      {description && (
        <p className="mt-1 line-clamp-2 text-sm text-ink-500" dir="auto">
          {description}
        </p>
      )}
      <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-ink-500">
        <button onClick={onOpen} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
          {t('team.roles.permissionCount', { count, total: ORGANIZATION_PERMISSIONS.length })}
        </button>
        <span>{t('team.roles.memberCount', { count: members })}</span>
        <span className="ms-auto flex gap-1">{actions}</span>
      </div>
    </motion.article>
  );
}

export default function RolesPanel() {
  const { t } = useTranslation();
  const session = useSession();
  const api = useTeamApi()!; // Team renders panels only when there is an organisation
  const key = useTeamKey();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = useRoles();
  const canManage = session.permissions.has('roles.manage');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<CustomRoleRow | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: (d: RoleDraft) => {
      const body = { name: d.name, description: d.description || null, permissions: d.permissions };
      return editing?.mode === 'edit' ? api.updateRole(editing.role.id, body) : api.createRole(body);
    },
    onSuccess: (_, d) => {
      toast(editing?.mode === 'edit' ? t('team.roles.saved', { name: d.name }) : t('team.roles.created', { name: d.name }));
      setEditing(null);
      void refresh();
    },
    onError: (e) => toast(teamErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: (r: CustomRoleRow) => api.deleteRole(r.id),
    onSuccess: (_, r) => {
      setDeleting(null);
      toast(t('team.roles.deleted', { name: r.name }));
      void refresh();
    },
    onError: (e) => {
      setDeleting(null);
      toast(teamErrorMessage(e, t), 'error');
    },
  });

  if (roles.isPending) return <SkeletonRows rows={4} />;
  if (roles.isError) return <ErrorState onRetry={() => void roles.refetch()} />;
  const { builtIn, custom } = roles.data;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">{t('team.roles.builtIn')}</h2>
        <p className="mt-1 text-sm text-ink-500">{t('team.roles.builtInHint')}</p>
        <motion.div variants={stagger(0.04)} initial="hidden" animate="show" className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {builtIn.map((r) => (
            <RoleCard
              key={r.key}
              builtIn
              title={t(`roles.${r.key}`)}
              description={t(`team.roles.describe.${r.key}`)}
              count={r.permissions.length}
              members={r.memberCount}
              onOpen={() => setEditing({ mode: 'view', title: t(`roles.${r.key}`), draft: { name: '', description: '', permissions: r.permissions } })}
            />
          ))}
        </motion.div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">{t('team.roles.custom')}</h2>
            <p className="mt-1 text-sm text-ink-500">{t('team.roles.customHint')}</p>
          </div>
          {canManage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ mode: 'create' })}>
              {t('team.roles.new')}
            </Button>
          )}
        </div>
        {custom.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-ink-300 dark:border-ink-700">
            <EmptyState icon={<ShieldCheck className="size-5" />} title={t('team.roles.noCustom')} body={t('team.roles.noCustomBody')} />
          </div>
        ) : (
          <motion.div variants={stagger(0.04)} initial="hidden" animate="show" className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {custom.map((r) => (
              <RoleCard
                key={r.id}
                title={r.name}
                description={r.description}
                count={r.permissions.length}
                members={r.memberCount}
                onOpen={() => setEditing(canManage && r.canAssign ? { mode: 'edit', role: r } : { mode: 'view', title: r.name, draft: { name: r.name, description: r.description ?? '', permissions: r.permissions } })}
                actions={
                  canManage && r.canAssign ? (
                    <>
                      <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} aria-label={t('team.roles.editFor', { name: r.name })} onClick={() => setEditing({ mode: 'edit', role: r })} />
                      <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label={t('team.roles.deleteFor', { name: r.name })} onClick={() => setDeleting(r)} />
                    </>
                  ) : undefined
                }
              />
            ))}
          </motion.div>
        )}
      </section>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        size="lg"
        title={editing?.mode === 'create' ? t('team.roles.new') : editing?.mode === 'edit' ? t('team.roles.editTitle', { name: editing.role.name }) : (editing?.title ?? '')}
        description={editing?.mode === 'view' ? t('team.roles.viewOnly') : t('team.roles.editorHint')}
        footer={
          editing?.mode === 'view' ? (
            <Button onClick={() => setEditing(null)}>{t('common.done')}</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={save.isPending}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" form="role-editor" loading={save.isPending}>
                {editing?.mode === 'edit' ? t('common.save') : t('team.roles.create')}
              </Button>
            </>
          )
        }
      >
        {editing && (
          <RoleEditor
            key={editing.mode === 'edit' ? editing.role.id : editing.mode}
            id="role-editor"
            readOnly={editing.mode === 'view'}
            initial={
              editing.mode === 'edit'
                ? { name: editing.role.name, description: editing.role.description ?? '', permissions: editing.role.permissions }
                : editing.mode === 'view'
                  ? editing.draft
                  : { name: '', description: '', permissions: [] }
            }
            onSubmit={(d) => save.mutate(d)}
          />
        )}
      </Modal>

      <ConfirmDialog
        key={deleting?.id ?? 'none'}
        open={deleting !== null}
        tone="danger"
        busy={remove.isPending}
        title={deleting ? t('team.roles.deleteTitle', { name: deleting.name }) : ''}
        body={deleting && deleting.memberCount > 0 ? t('team.errors.inUse') : t('team.roles.deleteBody')}
        confirmLabel={t('team.roles.delete')}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
