import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Info, Languages, Loader2, ShieldCheck, Users } from 'lucide-react';
import clsx from 'clsx';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { emailSchema } from '@ledgernest/shared';
import { ApiError } from '../auth/client';
import { DEMO_EMAIL, DEMO_PASSWORD, useAuth } from '../auth/context';
import { safeNext } from '../auth/liveSession';
import LanguageSwitcher from '../layout/LanguageSwitcher';
import Logo from '../layout/Logo';
import { useTakingLong } from '../lib/useTakingLong';
import ThemeToggle from '../layout/ThemeToggle';
import { fadeUp, spring, stagger } from '../motion/tokens';

type FieldErrors = { email?: string; password?: string };

/** A translated message for every way sign-in can fail. Never shows raw server text. */
function errorMessage(e: unknown, t: TFunction) {
  if (!(e instanceof ApiError)) return t('auth.errors.server');
  switch (e.kind) {
    case 'invalid_credentials':
    case 'validation':
      return t('auth.errors.invalid');
    case 'locked':
      return t('auth.errors.locked', { minutes: e.retryAfterMinutes ?? 15 });
    case 'suspended':
      return t('auth.errors.suspended');
    case 'rate_limited':
      return t('auth.errors.rateLimited');
    case 'network':
      return t('auth.errors.network');
    default:
      return t('auth.errors.server');
  }
}

export default function SignIn() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [params] = useSearchParams();
  const demo = auth.mode === 'demo';

  const [email, setEmail] = useState(demo ? DEMO_EMAIL : '');
  const [password, setPassword] = useState(demo ? DEMO_PASSWORD : '');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const shake = useAnimationControls();
  const waking = useTakingLong(submitting && !demo);
  const ids = { email: useId(), password: useId(), emailErr: useId(), passwordErr: useId(), caps: useId() };

  if (auth.state.status === 'signedIn') return <Navigate to={safeNext(params.get('next'))} replace />;

  const reason = auth.state.status === 'signedOut' ? auth.state.reason : undefined;
  const notice = !error && reason ? { expired: t('auth.errors.expired'), network: t('auth.errors.network'), signedOut: t('auth.signedOut') }[reason] : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const errs: FieldErrors = {};
    if (!emailSchema.safeParse(email).success) errs.email = t('auth.errors.emailInvalid');
    if (!password) errs.password = t('auth.errors.passwordRequired');
    setFieldErrors(errs);
    setError(null);
    if (errs.email || errs.password) {
      void shake.start({ x: [0, -8, 8, -5, 5, 0], transition: { duration: 0.4 } });
      document.getElementById(errs.email ? ids.email : ids.password)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await auth.signIn(email.trim().toLowerCase(), password);
    } catch (err) {
      setError(errorMessage(err, t));
      setPassword('');
      void shake.start({ x: [0, -8, 8, -5, 5, 0], transition: { duration: 0.4 } });
      document.getElementById(ids.password)?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const onPasswordKey = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'));

  const input =
    'h-11 w-full rounded-xl border bg-white px-3.5 text-[15px] outline-none transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:bg-ink-900';

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />

      <main className="flex flex-col">
        <div className="flex items-center justify-between gap-2 p-4 lg:justify-end">
          <div className="flex items-center gap-2 lg:hidden">
            <Logo className="size-8" />
            <span className="font-bold tracking-tight">LedgerNest</span>
          </div>
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 pb-16">
          <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="w-full max-w-sm">
            <motion.h1 variants={fadeUp} className="text-2xl font-bold tracking-tight sm:text-3xl">
              {t('auth.title')}
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-2 text-sm text-ink-500">
              {t('auth.subtitle')}
            </motion.p>

            {demo && (
              <motion.div variants={fadeUp} className="mt-6 flex gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-3.5 text-sm dark:border-brand-900 dark:bg-brand-950/40">
                <Info className="mt-0.5 size-4 shrink-0 text-brand-700 dark:text-brand-300" aria-hidden />
                <p>
                  <span className="font-semibold text-brand-800 dark:text-brand-200">{t('auth.demoTitle')}.</span>{' '}
                  <span className="text-ink-600 dark:text-ink-300">{t('auth.demoBody')}</span>
                </p>
              </motion.div>
            )}

            <AnimatePresence initial={false}>
              {(error ?? notice) && (
                <motion.div
                  key={error ?? notice}
                  role={error ? 'alert' : 'status'}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={spring.snappy}
                  className={clsx(
                    'mt-6 flex gap-2.5 rounded-xl p-3 text-sm',
                    error ? 'bg-expense/10 text-expense' : 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
                  )}
                >
                  {error ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />}
                  <span>{error ?? notice}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.form variants={fadeUp} animate={shake} onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
              <div>
                <label htmlFor={ids.email} className="mb-1.5 block text-sm font-medium">
                  {t('auth.email')}
                </label>
                <input
                  id={ids.email}
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  dir="ltr"
                  autoFocus={!demo}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? ids.emailErr : undefined}
                  className={clsx(input, fieldErrors.email ? 'border-expense' : 'border-ink-200 dark:border-ink-700')}
                />
                {fieldErrors.email && (
                  <p id={ids.emailErr} className="mt-1.5 text-xs text-expense">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor={ids.password} className="mb-1.5 block text-sm font-medium">
                  {t('auth.password')}
                </label>
                {/* The field and its eye button share one direction, so they never overlap in RTL */}
                <div className="relative" dir="ltr">
                  <input
                    id={ids.password}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={onPasswordKey}
                    onKeyUp={onPasswordKey}
                    onBlur={() => setCapsLock(false)}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby={[fieldErrors.password && ids.passwordErr, capsLock && ids.caps].filter(Boolean).join(' ') || undefined}
                    className={clsx(input, 'pe-11', fieldErrors.password ? 'border-expense' : 'border-ink-200 dark:border-ink-700')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 end-0 grid w-11 place-items-center rounded-e-xl text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                  >
                    {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p id={ids.passwordErr} className="mt-1.5 text-xs text-expense">
                    {fieldErrors.password}
                  </p>
                )}
                {capsLock && (
                  <p id={ids.caps} className="mt-1.5 text-xs font-medium text-warning">
                    {t('auth.capsLock')}
                  </p>
                )}
              </div>

              <motion.button
                type="submit"
                disabled={submitting}
                whileTap={{ scale: 0.98 }}
                transition={spring.snappy}
                className="group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 text-[15px] font-semibold text-white shadow-card hover:bg-brand-800 disabled:cursor-wait disabled:opacity-80"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> {t('auth.submitting')}
                  </>
                ) : (
                  <>
                    {demo ? t('auth.demoCta') : t('auth.submit')}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
                  </>
                )}
              </motion.button>
              {waking && (
                <p role="status" className="text-center text-xs text-ink-500">
                  {t('auth.waking')}
                </p>
              )}
            </motion.form>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

/** Left half on large screens: what LedgerNest is, with ledger cards that drift (transform only). */
function BrandPanel() {
  const { t } = useTranslation();
  const points = [
    { icon: ShieldCheck, text: t('auth.brand.secure') },
    { icon: Languages, text: t('auth.brand.languages') },
    { icon: Users, text: t('auth.brand.roles') },
  ];
  const float = (delay: number) => ({ y: [0, -10, 0], transition: { duration: 6, delay, repeat: Infinity, ease: 'easeInOut' as const } });

  return (
    <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-900 to-brand-950 p-12 text-white lg:flex lg:flex-col">
      {/* Soft glow; static, so it costs nothing per frame */}
      <div className="pointer-events-none absolute -end-32 -top-32 size-[28rem] rounded-full bg-brand-400/25 blur-3xl" aria-hidden />

      <div className="relative flex items-center gap-2.5">
        <Logo className="size-10" />
        <span className="text-xl font-bold tracking-tight">LedgerNest</span>
      </div>

      <div className="relative mt-auto max-w-md">
        <h2 className="text-4xl font-bold leading-tight tracking-tight">{t('auth.brand.title')}</h2>
        <ul className="mt-8 space-y-4">
          {points.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-brand-50/90">
              <span className="grid size-9 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      {/* Decorative sample cards: numbers are illustrative and hidden from screen readers */}
      <div className="relative mt-12 mb-auto grid max-w-md grid-cols-2 gap-4" aria-hidden>
        <motion.div animate={float(0)} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur">
          <p className="text-xs text-brand-100/80">{t('auth.brand.trialBalance')}</p>
          <p className="mt-1 flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="size-4 text-brand-300" /> {t('auth.brand.balanced')}
          </p>
          <p className="tabular mt-2 text-xs text-brand-100/70" dir="ltr">Dr ₹4,82,150 = Cr ₹4,82,150</p>
        </motion.div>
        <motion.div animate={float(1.5)} className="mt-8 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur">
          <p className="text-xs text-brand-100/80">{t('dashboard.kpi.cash')}</p>
          <p className="tabular mt-1 text-xl font-semibold" dir="ltr">₹12,40,900</p>
          <p className="mt-1 text-xs text-brand-300">▲ 8.2%</p>
        </motion.div>
      </div>
    </aside>
  );
}
