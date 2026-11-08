import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, Building2, Check, Circle, Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { passwordProblems, type PasswordProblem } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { useAuth } from '../auth/context';
import { useIntlLocale } from '../i18n';
import LanguageSwitcher from '../layout/LanguageSwitcher';
import Logo from '../layout/Logo';
import ThemeToggle from '../layout/ThemeToggle';
import { formatDate } from '../lib/format';
import { fadeUp, stagger } from '../motion/tokens';
import { usePlatformApi } from '../platform/context';
import { apiErrorMessage } from '../platform/errors';
import type { InvitationPreview } from '../platform/types';
import Button from '../ui/Button';
import { inputClass, TextField } from '../ui/Field';
import { useToast } from '../ui/toastContext';

const RULES: PasswordProblem[] = ['too_short', 'needs_lowercase', 'needs_uppercase', 'needs_number'];

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex items-center justify-between p-4">
        <Link to="/" className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="font-bold tracking-tight">LedgerNest</span>
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
      <main className="flex flex-1 items-start justify-center px-5 pb-16 pt-6 sm:items-center sm:pt-0">
        <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="w-full max-w-md">
          {children}
        </motion.div>
      </main>
    </div>
  );
}

export default function AcceptInvite() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const api = usePlatformApi();
  const preview = useQuery({ queryKey: ['invitation', token], queryFn: () => api.previewInvitation(token), enabled: token.length >= 20, retry: false });

  if (token.length < 20 || preview.isError) {
    const e = preview.error;
    const message =
      e instanceof ApiError && e.kind === 'gone'
        ? /expired/i.test(e.message)
          ? t('invite.expired')
          : t('invite.used')
        : e instanceof ApiError && e.kind === 'forbidden'
          ? t('invite.orgSuspended')
          : e instanceof ApiError && (e.kind === 'network' || e.kind === 'server')
            ? t('auth.errors.network')
            : t('invite.invalid');
    return (
      <Shell>
        <motion.div variants={fadeUp} role="alert" className="rounded-card border border-ink-200 bg-white p-6 text-center shadow-card dark:border-ink-800 dark:bg-ink-900">
          <AlertCircle className="mx-auto size-8 text-warning" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">{t('invite.problemTitle')}</h1>
          <p className="mt-1 text-sm text-ink-500">{message}</p>
          <Link to="/sign-in" className="mt-5 inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
            {t('invite.goToSignIn')}
          </Link>
        </motion.div>
      </Shell>
    );
  }

  if (!preview.data) {
    return (
      <Shell>
        <div className="h-64 animate-pulse rounded-card bg-ink-100 dark:bg-ink-800" role="status" aria-label={t('common.loading')} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Invitation token={token} invite={preview.data} />
    </Shell>
  );
}

function Invitation({ token, invite }: { token: string; invite: InvitationPreview }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const role = invite.role.type === 'built_in' ? t(`roles.${invite.role.key}`) : (invite.role.name ?? '');

  return (
    <>
      <motion.div variants={fadeUp} className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
          <Building2 className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-ink-500">{t('invite.youreInvited')}</p>
          <h1 className="truncate text-xl font-bold tracking-tight" dir="auto">
            {invite.organizationName}
          </h1>
        </div>
      </motion.div>
      <motion.p variants={fadeUp} className="mt-4 text-sm text-ink-600 dark:text-ink-300">
        {t('invite.summary', { role, email: invite.email })}{' '}
        <span className="text-ink-400">{t('invite.expiresOn', { date: formatDate(invite.expiresAt, locale) })}</span>
      </motion.p>
      <motion.div variants={fadeUp} className="mt-6 rounded-card border border-ink-200 bg-white p-5 shadow-card dark:border-ink-800 dark:bg-ink-900">
        {invite.accountExists ? <ExistingAccount token={token} invite={invite} /> : <NewAccount token={token} invite={invite} />}
      </motion.div>
    </>
  );
}

function NewAccount({ token, invite }: { token: string; invite: InvitationPreview }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; password?: string }>({});
  const problems = new Set(passwordProblems(password));

  const accept = useMutation({
    mutationFn: () => auth.acceptInvitation(token, name.trim(), password),
    onSuccess: () => navigate('/', { replace: true }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = t('invite.errors.name');
    if (problems.size) next.password = t('invite.errors.password');
    setErrors(next);
    if (!next.name && !next.password) accept.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <h2 className="font-semibold">{t('invite.createAccount')}</h2>
      <TextField label={t('auth.email')} value={invite.email} readOnly dir="ltr" className="bg-ink-50 dark:bg-ink-800" />
      <TextField label={t('invite.name')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="name" dir="auto" autoFocus />
      <div>
        <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium">
          {t('invite.password')}
        </label>
        <div className="relative" dir="ltr">
          <input
            id="new-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password || undefined}
            aria-describedby="password-rules"
            className={clsx(inputClass, 'pe-11', errors.password ? 'border-expense' : 'border-ink-200 dark:border-ink-700')}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
            aria-pressed={show}
            className="absolute inset-y-0 end-0 grid w-11 place-items-center text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
          >
            {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        </div>
        {/* Live checklist: each rule turns green as it's met */}
        <ul id="password-rules" className="mt-2 grid gap-1 text-xs sm:grid-cols-2" aria-live="polite">
          {RULES.map((r) => {
            const ok = password.length > 0 && !problems.has(r);
            return (
              <li key={r} className={clsx('flex items-center gap-1.5', ok ? 'text-income' : 'text-ink-500')}>
                {ok ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
                {t(`invite.rules.${r}`)}
                <span className="sr-only">{ok ? t('invite.rules.met') : t('invite.rules.notMet')}</span>
              </li>
            );
          })}
        </ul>
        {errors.password && <p className="mt-1.5 text-xs text-expense">{errors.password}</p>}
      </div>
      {accept.isError && (
        <p role="alert" className="rounded-xl bg-expense/10 p-3 text-sm text-expense">
          {accept.error instanceof ApiError && accept.error.kind === 'conflict' ? t('invite.accountNowExists') : apiErrorMessage(accept.error, t)}
        </p>
      )}
      <Button type="submit" className="w-full" loading={accept.isPending}>
        {t('invite.acceptAndJoin')}
      </Button>
    </form>
  );
}

function ExistingAccount({ token, invite }: { token: string; invite: InvitationPreview }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const api = usePlatformApi();
  const navigate = useNavigate();
  const toast = useToast();
  const here = `/accept-invite?token=${encodeURIComponent(token)}`;

  const accept = useMutation({
    mutationFn: () => api.acceptInvitationSignedIn(token),
    onSuccess: async (r) => {
      await auth.reload();
      toast(t('invite.joined', { name: r.organizationName }));
      navigate('/', { replace: true });
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });

  if (auth.state.status === 'loading') return <div className="h-20 animate-pulse rounded-xl bg-ink-100 dark:bg-ink-800" />;
  if (auth.state.status !== 'signedIn') {
    return (
      <div className="space-y-4 text-sm">
        <p>{t('invite.signInFirst', { email: invite.email })}</p>
        <Button className="w-full" onClick={() => navigate(`/sign-in?next=${encodeURIComponent(here)}`)}>
          {t('invite.signInToAccept')}
        </Button>
      </div>
    );
  }

  const signedInEmail = auth.state.me?.user.email ?? auth.state.demoEmail;
  if (auth.mode === 'live' && signedInEmail !== invite.email) {
    return (
      <div className="space-y-4 text-sm">
        <p role="alert">{t('invite.wrongAccount', { current: signedInEmail, email: invite.email })}</p>
        <Button variant="secondary" className="w-full" onClick={() => void auth.signOut()}>
          {t('auth.signOut')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <p>{t('invite.joinAs', { email: invite.email })}</p>
      <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
        {t('invite.accept')}
      </Button>
    </div>
  );
}
