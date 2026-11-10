import { useId, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { passwordProblems } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useAuth } from '../auth/context';
import PasswordRules from '../auth/PasswordRules';
import { fadeUp } from '../motion/tokens';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import PublicShell from './PublicShell';

/** Choose a new password from the emailed link; afterwards every device is signed out and you sign in again */
export default function ResetPassword() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [tried, setTried] = useState(false);
  const rulesId = useId();
  const weak = passwordProblems(password).length > 0;
  const mismatch = confirm !== password;
  const reset = useMutation({ mutationFn: () => auth.resetPassword(token, password) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!weak && !mismatch) reset.mutate();
  };
  const linkBroken = !/^[A-Za-z0-9_-]{32,128}$/.test(token) || (reset.error instanceof ApiError && reset.error.details?.reason === 'invalid_token');

  return (
    <PublicShell>
      <motion.div variants={fadeUp} className="rounded-card border border-ink-200 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
        {reset.isSuccess ? (
          <div role="status" className="text-center">
            <CheckCircle2 className="mx-auto size-8 text-income" aria-hidden />
            <h1 className="mt-3 text-lg font-semibold">{t('password.reset.doneTitle')}</h1>
            <p className="mt-1 text-sm text-ink-500">{t('password.reset.doneBody')}</p>
            <Link to="/sign-in" className="mt-5 inline-flex h-10 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">
              {t('auth.submit')}
            </Link>
          </div>
        ) : linkBroken ? (
          <div role="alert" className="text-center">
            <AlertCircle className="mx-auto size-8 text-warning" aria-hidden />
            <h1 className="mt-3 text-lg font-semibold">{t('password.reset.badLinkTitle')}</h1>
            <p className="mt-1 text-sm text-ink-500">{t('password.reset.badLinkBody')}</p>
            <Link to="/forgot-password" className="mt-5 inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
              {t('password.reset.askAgain')}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight">{t('password.reset.title')}</h1>
              <p className="mt-1 text-sm text-ink-500">{t('password.reset.body')}</p>
            </div>
            <div>
              <TextField label={t('password.newPassword')} type="password" autoComplete="new-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} error={tried && weak ? t('password.errors.weak') : undefined} aria-describedby={rulesId} data-autofocus />
              <PasswordRules password={password} id={rulesId} />
            </div>
            <TextField label={t('password.confirm')} type="password" autoComplete="new-password" dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={tried && mismatch ? t('password.errors.mismatch') : undefined} />
            {reset.isError && !linkBroken && (
              <p role="alert" className="text-sm text-expense">
                {apiErrorMessage(reset.error, t)}
              </p>
            )}
            <Button type="submit" className="w-full" loading={reset.isPending}>
              {t('password.reset.save')}
            </Button>
          </form>
        )}
      </motion.div>
    </PublicShell>
  );
}
