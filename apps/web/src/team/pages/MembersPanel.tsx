import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, UserMinus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../../i18n';
import { useSession } from '../../layout/session';
import { formatDate, formatRelative } from '../../lib/format';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { Card, EmptyState, ErrorState, Pill, SkeletonRows } from '../../ui/Kit';
import Modal from '../../ui/Modal';
import { useToast } from '../../ui/toastContext';
import { teamErrorMessage } from '../errors';
import { choiceOf, decodeChoice, memberRoleLabel } from '../labels';
import { useMembers, useRoles, useTeamKey } from '../queries';
import RolePicker from '../RolePicker';
import type { Member } from '../types';
import { useTeamApi } from '../useTeamApi';

export default function MembersPanel() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const api = useTeamApi()!; // Team renders panels only when there is an organisation
  const key = useTeamKey();
  const toast = useToast();
  const queryClient = useQueryClient();
  const members = useMembers();
  const roles = useRoles();
  const canManage = session.permissions.has('users.manage');
  const [editing, setEditing] = useState<Member | null>(null);
  const [choice, setChoice] = useState('');
  const [removing, setRemoving] = useState<Member | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const change = useMutation({
    mutationFn: ({ m, value }: { m: Member; value: string }) => api.changeRole(m.id, decodeChoice(value)),
    onSuccess: (_, { m }) => {
      setEditing(null);
      toast(t('team.members.roleChanged', { name: m.user.name }));
      void refresh();
    },
    onError: (e) => toast(teamErrorMessage(e, t), 'error'),
  });
  const remove = useMutation({
    mutationFn: (m: Member) => api.removeMember(m.id),
    onSuccess: (_, m) => {
      setRemoving(null);
      toast(t('team.members.removed', { name: m.user.name }));
      void refresh();
    },
    onError: (e) => {
      setRemoving(null);
      toast(teamErrorMessage(e, t), 'error');
    },
  });

  if (members.isPending) return <Card>{<SkeletonRows />}</Card>;
  if (members.isError) return <Card>{<ErrorState onRetry={() => void members.refetch()} />}</Card>;
  if (members.data.length === 0) return <Card>{<EmptyState icon={<Users className="size-5" />} title={t('team.members.empty')} />}</Card>;

  return (
    <Card className="overflow-hidden">
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-800">
            <tr>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {t('platform.users.columns.person')}
              </th>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {t('team.members.role')}
              </th>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {t('team.members.joined')}
              </th>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                {t('platform.users.columns.lastSignIn')}
              </th>
              {canManage && (
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">{t('platform.users.columns.actions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {members.data.map((m) => {
              const isSelf = m.user.email === session.email;
              return (
                <tr key={m.id}>
                  <td className="px-4 py-3">
                    <p className="flex items-center gap-2 font-semibold">
                      <span dir="auto">{m.user.name}</span>
                      {isSelf && <Pill>{t('platform.users.you')}</Pill>}
                    </p>
                    <p className="text-xs text-ink-500" dir="ltr">
                      {m.user.email}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={m.role.type === 'built_in' && m.role.key === 'owner' ? 'brand' : 'neutral'}>{memberRoleLabel(m.role, t)}</Pill>
                  </td>
                  <td className="px-4 py-3 text-ink-500">{formatDate(m.joinedAt, locale)}</td>
                  <td className="px-4 py-3 text-ink-500">{m.user.lastLoginAt ? formatRelative(m.user.lastLoginAt, locale) : t('platform.users.never')}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-end">
                      {!isSelf && (
                        <div className="inline-flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Pencil className="size-3.5" />}
                            aria-label={t('team.members.changeRoleFor', { name: m.user.name })}
                            onClick={() => {
                              setChoice(choiceOf(m.role));
                              setEditing(m);
                            }}
                          >
                            <span className="hidden sm:inline">{t('team.members.changeRole')}</span>
                          </Button>
                          <Button size="sm" variant="ghost" icon={<UserMinus className="size-3.5" />} aria-label={t('team.members.removeFor', { name: m.user.name })} onClick={() => setRemoving(m)} />
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? t('team.members.changeRoleTitle', { name: editing.user.name }) : ''}
        description={t('team.members.changeRoleHint')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={change.isPending}>
              {t('common.cancel')}
            </Button>
            <Button loading={change.isPending} disabled={!editing || choice === choiceOf(editing.role)} onClick={() => editing && change.mutate({ m: editing, value: choice })}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {roles.data && <RolePicker roles={roles.data} value={choice} onChange={setChoice} label={t('team.members.role')} />}
      </Modal>

      <ConfirmDialog
        key={removing?.id ?? 'none'}
        open={removing !== null}
        tone="danger"
        busy={remove.isPending}
        title={removing ? t('team.members.removeTitle', { name: removing.user.name }) : ''}
        body={t('team.members.removeBody')}
        confirmLabel={t('team.members.remove')}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </Card>
  );
}
