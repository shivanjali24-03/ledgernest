import { useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { passwordProblems } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { ApiError } from './client';
import type { Auth } from './context';
import PasswordRules from './PasswordRules';

/** Change your own password: the current one, then the new one twice; other devices are signed out */
export default function ChangePasswordDialog({ auth, onClose }: { auth: Auth; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const rulesId = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [tried, setTried] = useState(false);
  const errors = {
    current: !current ? t('password.errors.current') : undefined,
    next: passwordProblems(next).length ? t('password.errors.weak') : next === current ? t('password.errors.same') : undefined,
    confirm: confirm !== next ? t('password.errors.mismatch') : undefined,
  };
  const change = useMutation({
    mutationFn: () => auth.changePassword(current, next),
    onSuccess: () => {
      toast(auth.mode === 'demo' ? t('password.demo') : t('password.change.done'));
      onClose();
    },
  });
  const wrong = change.error instanceof ApiError && change.error.details?.reason === 'wrong_password';
  const locked = change.error instanceof ApiError && change.error.details?.reason === 'locked';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!errors.current && !errors.next && !errors.confirm) change.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('password.change.title')}
      description={t('password.change.description')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="change-password-form" loading={change.isPending}>
            {t('password.change.save')}
          </Button>
        </>
      }
    >
      <form id="change-password-form" onSubmit={submit} noValidate className="grid gap-3">
        <TextField label={t('password.current')} type="password" autoComplete="current-password" dir="ltr" value={current} onChange={(e) => setCurrent(e.target.value)} error={locked ? t('password.errors.locked') : wrong ? t('password.errors.wrongCurrent') : tried ? errors.current : undefined} data-autofocus />
        <div>
          <TextField label={t('password.newPassword')} type="password" autoComplete="new-password" dir="ltr" value={next} onChange={(e) => setNext(e.target.value)} error={tried ? errors.next : undefined} aria-describedby={rulesId} />
          <PasswordRules password={next} id={rulesId} />
        </div>
        <TextField label={t('password.confirm')} type="password" autoComplete="new-password" dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={tried ? errors.confirm : undefined} />
        {change.isError && !wrong && (
          <p role="alert" className="text-sm text-expense">
            {apiErrorMessage(change.error, t)}
          </p>
        )}
      </form>
    </Modal>
  );
}
