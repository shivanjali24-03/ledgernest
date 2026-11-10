import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileDown, FileX, MessageSquareWarning } from 'lucide-react';
import { currencyDigits, toMinor } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useIntlLocale } from '../i18n';
import LanguageSwitcher from '../layout/LanguageSwitcher';
import Logo from '../layout/Logo';
import ThemeToggle from '../layout/ThemeToggle';
import { formatDate, formatMoney } from '../lib/format';
import { saveBlob } from '../lib/saveBlob';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { Card, SkeletonRows } from '../ui/Kit';
import { loadConfirmation, type ConfirmationView } from './confirmationApi';

/**
 * A customer or vendor confirming their balance with a business for its audit, from the link they were sent: the
 * balance on the day as the business's books show it, the statement behind it, and Agree or Dispute. No account.
 */
export default function BalanceConfirmation() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const queryClient = useQueryClient();
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['confirmation', token], queryFn: () => loadConfirmation(token), retry: (n, e) => !(e instanceof ApiError && e.kind === 'not_found') && n < 2, refetchOnWindowFocus: false, staleTime: Infinity });
  const v = q.data?.view;
  const [answer, setAnswer] = useState<'agree' | 'dispute' | null>(null);
  const [name, setName] = useState('');
  const [theirs, setTheirs] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = v ? `${t('confirmation.pageTitle')} · ${v.organization.name}` : 'LedgerNest';
  }, [v, t]);
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const send = useMutation({
    mutationFn: (input: Parameters<NonNullable<typeof q.data>['respond']>[0]) => q.data!.respond(input),
    onSuccess: (view: ConfirmationView) => queryClient.setQueryData(['confirmation', token], { ...q.data!, view }),
    onError: (e) => setError(e instanceof ApiError && e.kind === 'conflict' ? t('confirmation.errors.answered') : t('confirmation.errors.failed')),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!v || !answer) return;
    setError(null);
    if (name.trim().length < 2) return setError(t('confirmation.errors.name'));
    const theirBalance = theirs.trim() ? toMinor(theirs, currencyDigits(v.currency)) : null;
    if (theirs.trim() && theirBalance === null) return setError(t('confirmation.errors.amount'));
    if (answer === 'dispute' && theirBalance === null && !note.trim()) return setError(t('confirmation.errors.why'));
    send.mutate({ response: answer, name: name.trim(), theirBalance: answer === 'dispute' ? theirBalance : null, note: note.trim() || null });
  };
  const statementName = `statement-${v?.asOf ?? ''}.pdf`;
  const owed = (x: ConfirmationView, amount: number) => {
    if (amount === 0) return t('confirmation.nothing');
    const theyOwe = x.side === 'receivable' ? amount > 0 : amount < 0;
    return t(theyOwe ? 'confirmation.youOwe' : 'confirmation.weOwe', { amount: money(Math.abs(amount), x.currency), organization: x.organization.name });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-ink-50 dark:bg-ink-950">
      <div className="flex items-center justify-end gap-1 p-3">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-12">
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
            <div>
              <p className="font-semibold" dir="auto">{v.organization.name}</p>
              {v.organization.taxId && <p className="font-mono text-xs text-ink-500" dir="ltr">GSTIN {v.organization.taxId}</p>}
            </div>
            <div>
              <h1 className="text-lg font-semibold">{t('confirmation.title')}</h1>
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-300" dir="auto">{t('confirmation.dear', { name: v.party.name, organization: v.organization.name })}</p>
            </div>
            <div className="rounded-xl bg-ink-50 p-4 dark:bg-ink-800/60">
              <p className="text-sm text-ink-500">{t('confirmation.asOf', { date: formatDate(`${v.asOf}T00:00:00Z`, locale) })}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight" data-testid="confirmation-balance">{owed(v, v.balance)}</p>
              {'href' in q.data!.statement ? (
                <a href={q.data!.statement.href} download={statementName} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                  <FileDown className="size-4" aria-hidden /> {t('confirmation.statement')}
                </a>
              ) : (
                <button type="button" onClick={() => void (q.data!.statement as { blob: () => Promise<Blob> }).blob().then((blob) => saveBlob({ blob, filename: statementName }))} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                  <FileDown className="size-4" aria-hidden /> {t('confirmation.statement')}
                </button>
              )}
            </div>
            {v.status !== 'pending' ? (
              <div role="status" className={`flex items-start gap-2 rounded-xl p-4 text-sm ${v.status === 'agreed' ? 'bg-income/10 text-income' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>
                {v.status === 'agreed' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <MessageSquareWarning className="mt-0.5 size-4 shrink-0" aria-hidden />}
                <span>
                  {t(v.status === 'agreed' ? 'confirmation.thanksAgreed' : 'confirmation.thanksDisputed', { name: v.respondedBy ?? '' })}
                  {v.theirBalance !== null && <span className="block">{t('confirmation.yourFigure', { figure: owed(v, v.theirBalance) })}</span>}
                </span>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="space-y-4" aria-label={t('confirmation.formLabel')}>
                <fieldset className="grid gap-2 sm:grid-cols-2">
                  <legend className="mb-2 text-sm font-medium">{t('confirmation.question')}</legend>
                  {(['agree', 'dispute'] as const).map((a) => (
                    <label key={a} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm ${answer === a ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40' : 'border-ink-200 dark:border-ink-700'}`}>
                      <input type="radio" name="answer" value={a} checked={answer === a} onChange={() => setAnswer(a)} className="accent-brand-600" />
                      {t(`confirmation.${a}`)}
                    </label>
                  ))}
                </fieldset>
                {answer && (
                  <>
                    {answer === 'dispute' && <TextField label={t('confirmation.theirs', { currency: v.currency })} value={theirs} onChange={(e) => setTheirs(e.target.value)} inputMode="decimal" dir="ltr" hint={t('confirmation.theirsHint')} />}
                    <TextField label={answer === 'dispute' ? t('confirmation.why') : t('confirmation.noteOptional')} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" />
                    <TextField label={t('confirmation.name')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" dir="auto" />
                    {error && (
                      <p role="alert" className="text-sm text-expense">
                        {error}
                      </p>
                    )}
                    <Button type="submit" loading={send.isPending}>
                      {t(answer === 'agree' ? 'confirmation.sendAgree' : 'confirmation.sendDispute')}
                    </Button>
                  </>
                )}
              </form>
            )}
          </section>
        )}
      </main>
      <footer className="flex items-center justify-center gap-2 pb-6 text-xs text-ink-500">
        <Logo className="size-4" /> {t('publicInvoice.poweredBy')}
      </footer>
    </div>
  );
}
