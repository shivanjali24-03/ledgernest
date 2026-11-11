import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileDown, FileX, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useIntlLocale } from '../i18n';
import LanguageSwitcher from '../layout/LanguageSwitcher';
import Logo from '../layout/Logo';
import ThemeToggle from '../layout/ThemeToggle';
import LegalLinks from '../legal/LegalLinks';
import { formatDate, formatMoney } from '../lib/format';
import { saveBlob } from '../lib/saveBlob';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { Card, SkeletonRows } from '../ui/Kit';
import { loadPublicQuote, type PublicQuoteView } from './publicQuoteApi';

/** A quote its customer opens from the link they were sent: the lines and totals, the PDF, and Accept or Decline */
export default function PublicQuote() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const queryClient = useQueryClient();
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['public-quote', token], queryFn: () => loadPublicQuote(token), retry: (n, e) => !(e instanceof ApiError && e.kind === 'not_found') && n < 2, refetchOnWindowFocus: false, staleTime: Infinity });
  const v = q.data?.view;
  const [answer, setAnswer] = useState<'accept' | 'decline' | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = v ? `${t('publicQuote.pageTitle', { number: v.number })} · ${v.organization.name}` : 'LedgerNest';
  }, [v, t]);
  const money = (minor: number) => formatMoney(minor, v?.currency ?? 'INR', locale);
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const decide = useMutation({
    mutationFn: (input: { response: 'accept' | 'decline'; name: string; note: string | null }) => q.data!.decide(input),
    onSuccess: (view: PublicQuoteView) => queryClient.setQueryData(['public-quote', token], { ...q.data!, view }),
    onError: (e) => setError(e instanceof ApiError && e.kind === 'conflict' ? t('publicQuote.errors.closed') : t('publicQuote.errors.failed')),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!answer) return;
    if (name.trim().length < 2) return setError(t('publicQuote.errors.name'));
    setError(null);
    decide.mutate({ response: answer, name: name.trim(), note: note.trim() || null });
  };
  const filename = `quote-${(v?.number ?? '').toLowerCase()}.pdf`;
  return (
    <div className="flex min-h-dvh flex-col bg-ink-50 dark:bg-ink-950">
      <div className="flex items-center justify-end gap-1 p-3">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12">
        {q.isPending ? (
          <Card>
            <SkeletonRows rows={5} />
          </Card>
        ) : q.isError || !v ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <FileX className="size-8 text-ink-400" aria-hidden />
            <h1 className="text-lg font-semibold">{t('publicInvoice.notFound')}</h1>
            <p className="max-w-sm text-sm text-ink-500">{t('publicInvoice.askBusiness')}</p>
          </Card>
        ) : (
          <section className="space-y-5 rounded-2xl border border-ink-200 bg-white p-5 shadow-sm sm:p-6 dark:border-ink-800 dark:bg-ink-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold" dir="auto">{v.organization.name}</p>
                <p className="text-sm text-ink-500" dir="auto">{t('customerAccount.for', { name: v.customer.name })}</p>
              </div>
              <div className="text-end">
                <h1 className="font-mono text-lg font-semibold" dir="ltr">{t('publicQuote.title', { number: v.number })}</h1>
                <p className="text-xs text-ink-500">{t('publicQuote.dates', { date: day(v.quoteDate), until: day(v.expiryDate) })}</p>
              </div>
            </div>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('publicQuote.lines')}</caption>
              <thead className="text-xs uppercase tracking-wide text-ink-400">
                <tr>
                  <th scope="col" className="py-2 text-start font-semibold">{t('publicQuote.cols.item')}</th>
                  <th scope="col" className="py-2 text-end font-semibold">{t('publicQuote.cols.qty')}</th>
                  <th scope="col" className="py-2 text-end font-semibold">{t('publicQuote.cols.amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {v.lines.map((l, n) => (
                  <tr key={n}>
                    <td className="py-2" dir="auto">{l.description}</td>
                    <td className="py-2 text-end font-mono tabular-nums" dir="ltr">{l.quantity}</td>
                    <td className="py-2 text-end font-mono tabular-nums" dir="ltr">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr><td colSpan={2} className="pt-3 text-end text-ink-500">{t('publicQuote.subtotal')}</td><td className="pt-3 text-end font-mono tabular-nums" dir="ltr">{money(v.subtotal)}</td></tr>
                {v.taxTotal > 0 && <tr><td colSpan={2} className="text-end text-ink-500">{t('publicQuote.tax')}</td><td className="text-end font-mono tabular-nums" dir="ltr">{money(v.taxTotal)}</td></tr>}
                <tr><td colSpan={2} className="pt-1 text-end font-semibold">{t('publicQuote.total')}</td><td className="pt-1 text-end font-mono text-base font-semibold tabular-nums" dir="ltr" data-testid="quote-total">{money(v.total)}</td></tr>
              </tfoot>
            </table>
            {'href' in q.data!.pdf ? (
              <a href={q.data!.pdf.href} download={filename} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                <FileDown className="size-4" aria-hidden /> {t('publicQuote.pdf')}
              </a>
            ) : (
              <button type="button" onClick={() => void (q.data!.pdf as { blob: () => Promise<Blob> }).blob().then((blob) => saveBlob({ blob, filename }))} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                <FileDown className="size-4" aria-hidden /> {t('publicQuote.pdf')}
              </button>
            )}
            {v.status === 'accepted' || v.status === 'declined' || v.status === 'invoiced' ? (
              <p role="status" className={`flex items-start gap-2 rounded-xl p-4 text-sm ${v.status === 'declined' ? 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200' : 'bg-income/10 text-income'}`}>
                {v.status === 'declined' ? <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />}
                {v.status === 'declined' ? t('publicQuote.declined', { name: v.decidedBy ?? '' }) : t('publicQuote.accepted', { name: v.decidedBy ?? '' })}
              </p>
            ) : v.state === 'expired' ? (
              <p role="status" className="rounded-xl bg-ink-100 p-4 text-sm text-ink-600 dark:bg-ink-800 dark:text-ink-300">{t('publicQuote.expired', { date: day(v.expiryDate) })}</p>
            ) : v.status === 'sent' ? (
              <form onSubmit={submit} noValidate className="space-y-3" aria-label={t('publicQuote.formLabel')}>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant={answer === 'accept' ? 'primary' : 'secondary'} icon={<CheckCircle2 className="size-4" />} onClick={() => setAnswer('accept')} aria-pressed={answer === 'accept'}>
                    {t('publicQuote.accept')}
                  </Button>
                  <Button type="button" variant={answer === 'decline' ? 'danger' : 'ghost'} icon={<XCircle className="size-4" />} onClick={() => setAnswer('decline')} aria-pressed={answer === 'decline'}>
                    {t('publicQuote.decline')}
                  </Button>
                </div>
                {answer && (
                  <>
                    <TextField label={t('publicQuote.name')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" dir="auto" />
                    <TextField label={t('publicQuote.note')} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" />
                    {error && (
                      <p role="alert" className="text-sm text-expense">
                        {error}
                      </p>
                    )}
                    <Button type="submit" loading={decide.isPending}>
                      {t(answer === 'accept' ? 'publicQuote.sendAccept' : 'publicQuote.sendDecline')}
                    </Button>
                  </>
                )}
              </form>
            ) : null}
            {v.organization.terms && <p className="whitespace-pre-line border-t border-ink-100 pt-4 text-xs text-ink-500 dark:border-ink-800" dir="auto">{v.organization.terms}</p>}
          </section>
        )}
      </main>
      <footer className="flex items-center justify-center gap-2 pb-6 text-xs text-ink-500">
        <Logo className="size-4" /> {t('publicInvoice.poweredBy')}
      </footer>
      <LegalLinks className="pb-6" />
    </div>
  );
}
