import { useEffect } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../layout/LanguageSwitcher';
import Logo from '../layout/Logo';
import ThemeToggle from '../layout/ThemeToggle';
import { privacyNotice, termsOfUse } from './content';

/** The privacy notice or terms of use, readable without signing in */
export default function LegalPage({ which }: { which: 'privacy' | 'terms' }) {
  const { t, i18n } = useTranslation();
  const doc = which === 'privacy' ? privacyNotice() : termsOfUse();
  const title = t(`legal.${which}`);
  useEffect(() => {
    document.title = `${title} · LedgerNest`;
  }, [title]);
  return (
    <div className="min-h-dvh bg-ink-50 dark:bg-ink-950">
      <div className="flex items-center justify-between gap-2 p-3">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> <Logo className="size-5" /> LedgerNest
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <article className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm sm:p-10 dark:border-ink-800 dark:bg-ink-900" lang="en">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-ink-500">{t('legal.updated', { date: doc.updated })}</p>
          {i18n.language !== 'en' && (
            <p className="mt-4 rounded-xl bg-ink-50 p-3 text-sm text-ink-600 dark:bg-ink-800 dark:text-ink-300" lang={i18n.language}>
              {t('legal.english')}
            </p>
          )}
          {doc.sections.map((s) => (
            <section key={s.heading} className="mt-8">
              <h2 className="text-lg font-semibold">{s.heading}</h2>
              {s.body.map((b, n) =>
                typeof b === 'string' ? (
                  <p key={n} className="mt-2 text-[15px] leading-relaxed text-ink-700 dark:text-ink-200">
                    {b}
                  </p>
                ) : (
                  <ul key={n} className="mt-2 list-disc space-y-1.5 ps-5 text-[15px] leading-relaxed text-ink-700 dark:text-ink-200">
                    {b.map((li) => (
                      <li key={li}>{li}</li>
                    ))}
                  </ul>
                ),
              )}
            </section>
          ))}
          <p className="mt-10 text-sm">
            <Link to={which === 'privacy' ? '/terms' : '/privacy'} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
              {t(which === 'privacy' ? 'legal.terms' : 'legal.privacy')}
            </Link>
          </p>
        </article>
      </main>
    </div>
  );
}
