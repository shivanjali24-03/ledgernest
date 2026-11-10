import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { ApiError } from './client';
import type { Auth } from './context';

/** Erase your own account, with your password. The only Owner of an organisation is told to hand it over first. */
export default function DeleteAccountDialog({ auth, onClose }: { auth: Auth; onClose: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const remove = useMutation({ mutationFn: () => auth.deleteAccount(password) });
  const reason = remove.error instanceof ApiError ? remove.error.details?.reason : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password || auth.mode === 'demo') remove.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('account.delete.title')}
      description={t('account.delete.body')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="delete-account-form" variant="danger" loading={remove.isPending} disabled={auth.mode === 'live' && !password}>
            {t('account.delete.confirm')}
          </Button>
        </>
      }
    >
      <form id="delete-account-form" onSubmit={submit} noValidate className="space-y-3">
        {auth.mode === 'live' && <TextField label={t('password.current')} type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} data-autofocus />}
        {remove.isError && (
          <p role="alert" className="text-sm text-expense">
            {reason === 'wrong_password' ? t('password.errors.wrongCurrent') : reason === 'sole_owner' ? t('account.delete.soleOwner', { names: ((remove.error as ApiError).details?.organizations as string[] | undefined)?.join(', ') ?? '' }) : reason === 'last_super_admin' ? t('account.delete.lastSuperAdmin') : apiErrorMessage(remove.error, t)}
          </p>
        )}
      </form>
    </Modal>
  );
}
