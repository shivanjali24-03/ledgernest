import { useEffect } from 'react';
import { useParams } from 'react-router';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileDown, FileX, Smartphone } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useIntlLocale } from '../i18n';
import LanguageSwitcher from '../layout/LanguageSwitcher';
import Logo from '../layout/Logo';
import LegalLinks from '../legal/LegalLinks';
import ThemeToggle from '../layout/ThemeToggle';
import { formatDate, formatMoney } from '../lib/format';
import { saveBlob } from '../lib/saveBlob';
import { fadeUp, stagger } from '../motion/tokens';
import { Card, SkeletonRows } from '../ui/Kit';
import UpiQr from '../ui/UpiQr';
import { loadCustomerAccount } from './customerAccountApi';

/**
 * A customer's account, opened from the link their supplier sent: everything still owed, overdue first in mind, one
 * UPI QR code for the rupee total, and each invoice's PDF. No account needed; English, Hindi or Marathi.
 */
export default function CustomerAccount() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['customer-account', token], queryFn: () => loadCustomerAccount(token), retry: (n, e) => !(e instanceof ApiError && e.kind === 'not_found') && n < 2, refetchOnWindowFocus: false, staleTime: Infinity });
  const v = q.data?.view;
  useEffect(() => {
    document.title = v ? `${t('customerAccount.pageTitle')} · ${v.organization.name}` : 'LedgerNest';
  }, [v, t]);
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);

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
          <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-4">
            <motion.section variants={fadeUp} className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm sm:p-6 dark:border-ink-800 dark:bg-ink-900">
              <p className="font-semibold" dir="auto">
                {v.organization.name}
              </p>
              <p className="text-sm text-ink-500" dir="auto">
                {t('customerAccount.for', { name: v.customer.name })}
              </p>
              {!v.invoices.length ? (
                <p className="mt-5 flex items-center gap-2 font-medium text-income">
                  <CheckCircle2 className="size-5" aria-hidden /> {t('customerAccount.allPaid')}
                </p>
              ) : (
                <>
                  <p className="mt-5 text-sm text-ink-500">{t('customerAccount.owed', { count: v.invoices.length })}</p>
                  {v.totals.map((x) => (
                    <p key={x.currency} className="text-3xl font-semibold tracking-tight tabular-nums" dir="ltr">
                      {money(x.balance, x.currency)}
                    </p>
                  ))}
                  {v.overdue > 0 && <p className="mt-1 text-sm font-medium text-expense">{t('customerAccount.overdue', { amount: money(v.overdue, 'INR') })}</p>}
                  {!!v.msme?.interest && (
                    <p className="mt-2 text-sm text-ink-600 dark:text-ink-300" data-testid="msme-interest">
                      {t('customerAccount.msmeInterest', { amount: money(v.msme.interest, 'INR') })}
                      {v.msme.udyamNumber && <span className="block font-mono text-xs text-ink-500" dir="ltr">Udyam {v.msme.udyamNumber}</span>}
                    </p>
                  )}
                  {v.upi && (
                    <div className="mt-5 flex flex-col items-center gap-4 rounded-xl bg-ink-50 p-4 sm:flex-row dark:bg-ink-800/60" data-testid="account-upi">
                      <UpiQr value={v.upi.link} label={t('invoices.upi.qrLabel', { amount: money(v.upi.amount, 'INR'), upiId: v.upi.upiId })} size={160} />
                      <div className="space-y-2 text-center sm:text-start">
                        <p className="font-semibold">{t('customerAccount.payAll')}</p>
                        <p className="text-sm text-ink-600 dark:text-ink-300">{t('publicInvoice.upiBody')}</p>
                        <p className="font-mono text-xs text-ink-500" dir="ltr">
                          {v.upi.upiId}
                        </p>
                        <a href={v.upi.link} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">
                          <Smartphone className="size-4" aria-hidden /> {t('publicInvoice.payNow', { amount: money(v.upi.amount, 'INR') })}
                        </a>
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.section>
            {v.invoices.length > 0 && (
              <motion.section variants={fadeUp}>
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-ink-100 dark:divide-ink-800" aria-label={t('customerAccount.invoices')}>
                    {v.invoices.map((i) => {
                      const pdf = q.data!.pdf(i.id);
                      const filename = `invoice-${i.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
                      return (
                        <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono font-medium" dir="ltr">
                              {i.number}
                            </span>
                            <span className={clsx('block text-xs', i.state === 'overdue' ? 'text-expense' : 'text-ink-500')}>
                              {i.state === 'overdue' ? t('publicInvoice.overdueSince', { date: day(i.dueDate) }) : t('publicInvoice.dueOn', { date: day(i.dueDate) })}
                            </span>
                            {!!i.msmeInterest && <span className="block text-xs text-ink-500">{t('customerAccount.invoiceInterest', { amount: money(i.msmeInterest, i.currency) })}</span>}
                          </span>
                          <span className="font-mono font-semibold tabular-nums" dir="ltr">
                            {money(i.balance, i.currency)}
                          </span>
                          {'href' in pdf ? (
                            <a href={pdf.href} download={filename} aria-label={t('customerAccount.download', { number: i.number })} className="grid size-9 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800">
                              <FileDown className="size-4" aria-hidden />
                            </a>
                          ) : (
                            <button type="button" onClick={() => void pdf.blob().then((blob) => saveBlob({ blob, filename }))} aria-label={t('customerAccount.download', { number: i.number })} className="grid size-9 place-items-center rounded-lg text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800">
                              <FileDown className="size-4" aria-hidden />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </motion.section>
            )}
          </motion.div>
        )}
      </main>
      <footer className="flex items-center justify-center gap-2 pb-6 text-xs text-ink-500">
        <Logo className="size-4" /> {t('publicInvoice.poweredBy')}
      </footer>
      <LegalLinks className="pb-6 print:hidden" />
    </div>
  );
}
