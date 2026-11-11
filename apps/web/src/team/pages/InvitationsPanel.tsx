import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, RotateCw, UserPlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { emailSchema } from '@ledgernest/shared';
import { useIntlLocale } from '../../i18n';
import { useSession } from '../../layout/session';
import { formatDate, formatRelative } from '../../lib/format';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { TextField } from '../../ui/Field';
import { Card, CopyField, EmptyState, ErrorState, Pill, SkeletonRows } from '../../ui/Kit';
import Modal from '../../ui/Modal';
import { useToast } from '../../ui/toastContext';
import { teamErrorMessage } from '../errors';
import { decodeChoice, memberRoleLabel } from '../labels';
import { useInvitations, useRoles, useTeamKey } from '../queries';
import RolePicker from '../RolePicker';
import type { InviteResult, PendingInvitation } from '../types';
import { useTeamApi } from '../useTeamApi';

/** The one-time link, shown once after inviting or resending. */
function LinkResult({ result }: { result: InviteResult }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  return (
    <div className="space-y-4">
      <p className="flex gap-2.5 rounded-xl bg-brand-50 p-3 text-sm text-brand-800 dark:bg-brand-950/40 dark:text-brand-200">
        <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('team.invite.sent', { email: result.email, date: formatDate(result.expiresAt, locale) })}
      </p>
      <CopyField label={t('platform.create.inviteLink')} value={result.inviteUrl} />
      <p className="text-xs text-ink-500">{t('platform.create.inviteOnce')}</p>
    </div>
  );
}

export default function InvitationsPanel({ inviteOpen, onInviteOpen }: { inviteOpen: boolean; onInviteOpen: (open: boolean) => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const api = useTeamApi()!; // Team renders panels only when there is an organisation
  const key = useTeamKey();
  const toast = useToast();
  const queryClient = useQueryClient();
  const invitations = useInvitations();
  const roles = useRoles();
  const canInvite = session.permissions.has('users.invite');

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const firstAssignable = roles.data?.builtIn.findLast((r) => r.canAssign);
  const [choice, setChoice] = useState<string>('');
  const role = choice || (firstAssignable ? `b:${firstAssignable.key}` : '');
  const [result, setResult] = useState<InviteResult | null>(null);
  const [revoking, setRevoking] = useState<PendingInvitation | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const invite = useMutation({
    mutationFn: () => api.invite(email, decodeChoice(role)),
    onSuccess: (r) => {
      setResult(r);
      void refresh();
    },
    onError: (e) => toast(teamErrorMessage(e, t), 'error'),
  });
  const resend = useMutation({
    mutationFn: (i: PendingInvitation) => api.resend(i.id),
    onSuccess: (r) => {
      setResult(r);
      void refresh();
    },
    onError: (e) => toast(teamErrorMessage(e, t), 'error'),
  });
  const revoke = useMutation({
    mutationFn: (i: PendingInvitation) => api.revoke(i.id),
    onSuccess: (_, i) => {
      setRevoking(null);
      toast(t('team.invite.revoked', { email: i.email }));
      void refresh();
    },
    onError: (e) => {
      setRevoking(null);
      toast(teamErrorMessage(e, t), 'error');
    },
  });

  const closeInvite = () => {
    onInviteOpen(false);
    setTimeout(() => {
      setResult(null);
      setEmail('');
      setEmailError(undefined);
      setChoice('');
      invite.reset();
    }, 200);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!emailSchema.safeParse(email).success) return setEmailError(t('auth.errors.emailInvalid'));
    setEmailError(undefined);
    invite.mutate();
  };

  let body;
  if (invitations.isPending) body = <SkeletonRows rows={3} />;
  else if (invitations.isError) body = <ErrorState onRetry={() => void invitations.refetch()} />;
  else if (invitations.data.length === 0)
    body = (
      <EmptyState
        icon={<Mail className="size-5" />}
        title={t('team.invite.empty')}
        body={t('team.invite.emptyBody')}
        action={
          canInvite ? (
            <Button icon={<UserPlus className="size-4" />} onClick={() => onInviteOpen(true)}>
              {t('team.invite.button')}
            </Button>
          ) : undefined
        }
      />
    );
  else
    body = (
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">
        {invitations.data.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold" dir="ltr">
                {i.email}
              </p>
              <p className="text-xs text-ink-500">{t('team.invite.invitedBy', { name: i.invitedBy, when: formatRelative(i.createdAt, locale) })}</p>
            </div>
            <Pill>{memberRoleLabel(i.role, t)}</Pill>
            {i.expired ? (
              <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning">{t('team.invite.expired')}</span>
            ) : (
              <span className="text-xs text-ink-500">{t('platform.detail.expires', { when: formatRelative(i.expiresAt, locale) })}</span>
            )}
            {canInvite && (
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" icon={<RotateCw className="size-3.5" />} loading={resend.isPending && resend.variables?.id === i.id} onClick={() => resend.mutate(i)}>
                  {t('team.invite.resend')}
                </Button>
                <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} aria-label={t('team.invite.revokeFor', { email: i.email })} onClick={() => setRevoking(i)} />
              </div>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <Card className="overflow-hidden">
      {body}

      <Modal
        open={inviteOpen || (result !== null && !inviteOpen && resend.isSuccess)}
        onClose={() => {
          closeInvite();
          resend.reset();
        }}
        title={result ? t('team.invite.doneTitle') : t('team.invite.title')}
        description={result ? undefined : t('team.invite.description')}
        footer={
          result ? (
            <Button
              onClick={() => {
                closeInvite();
                resend.reset();
              }}
            >
              {t('common.done')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={closeInvite} disabled={invite.isPending}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" form="invite-form" loading={invite.isPending} disabled={!role}>
                {t('team.invite.send')}
              </Button>
            </>
          )
        }
      >
        {result ? (
          <LinkResult result={result} />
        ) : (
          <form id="invite-form" onSubmit={submit} noValidate className="space-y-4">
            <TextField label={t('auth.email')} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={emailError} dir="ltr" placeholder="name@company.com" data-autofocus />
            {roles.data && <RolePicker roles={roles.data} value={role} onChange={setChoice} label={t('team.members.role')} />}
          </form>
        )}
      </Modal>

      <ConfirmDialog
        key={revoking?.id ?? 'none'}
        open={revoking !== null}
        tone="danger"
        busy={revoke.isPending}
        title={revoking ? t('team.invite.revokeTitle', { email: revoking.email }) : ''}
        body={t('team.invite.revokeBody')}
        confirmLabel={t('team.invite.revoke')}
        onConfirm={() => revoking && revoke.mutate(revoking)}
        onClose={() => setRevoking(null)}
      />
    </Card>
  );
}
