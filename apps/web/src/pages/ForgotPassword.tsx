import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { emailSchema, PASSWORD_RESET_MINUTES } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/context';
import { fadeUp } from '../motion/tokens';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import PublicShell from './PublicShell';

/** Ask for a reset link. The answer is the same whether or not the address has an account. */
export default function ForgotPassword() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [tried, setTried] = useState(false);
  const bad = !emailSchema.safeParse(email).success;
  const send = useMutation({ mutationFn: () => auth.forgotPassword(emailSchema.parse(email)) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!bad) send.mutate();
  };
  return (
    <PublicShell>
      <motion.div variants={fadeUp} className="rounded-card border border-ink-200 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
        {send.isSuccess ? (
          <div role="status" className="text-center">
            <MailCheck className="mx-auto size-8 text-income" aria-hidden />
            <h1 className="mt-3 text-lg font-semibold">{t('password.forgot.sentTitle')}</h1>
            <p className="mt-1 text-sm text-ink-500">{t('password.forgot.sentBody', { email: email.trim(), minutes: PASSWORD_RESET_MINUTES })}</p>
            {auth.mode === 'demo' && <p className="mt-3 text-xs text-ink-500">{t('password.demo')}</p>}
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight">{t('password.forgot.title')}</h1>
              <p className="mt-1 text-sm text-ink-500">{t('password.forgot.body')}</p>
            </div>
            <TextField label={t('auth.email')} type="email" autoComplete="email" inputMode="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} error={tried && bad ? t('auth.errors.emailInvalid') : undefined} data-autofocus />
            {send.isError && (
              <p role="alert" className="text-sm text-expense">
                {apiErrorMessage(send.error, t)}
              </p>
            )}
            <Button type="submit" className="w-full" loading={send.isPending}>
              {t('password.forgot.send')}
            </Button>
          </form>
        )}
        <Link to="/sign-in" className="mt-5 block text-center text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
          {t('password.backToSignIn')}
        </Link>
      </motion.div>
    </PublicShell>
  );
}
