import { useEffect } from 'react';
import { useParams } from 'react-router';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileDown, FileX, Smartphone } from 'lucide-react';
import clsx from 'clsx';
import { currencyDigits, INDIAN_STATES } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useIntlLocale } from '../i18n';
import LanguageSwitcher from '../layout/LanguageSwitcher';
import Logo from '../layout/Logo';
import ThemeToggle from '../layout/ThemeToggle';
import { formatDate, formatMoney } from '../lib/format';
import { saveBlob } from '../lib/saveBlob';
import { fadeUp, stagger } from '../motion/tokens';
import { Card, SkeletonRows } from '../ui/Kit';
import UpiQr from '../ui/UpiQr';
import { loadPublicInvoice } from './publicInvoiceApi';

/**
 * An invoice opened from the link its business sent (by WhatsApp, SMS or email): no account needed. What's owed and
 * when, the pay-by-UPI QR code and button, the PDF, and the full invoice below. Readable in English, Hindi or Marathi.
 */
export default function PublicInvoice() {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['public-invoice', token], queryFn: () => loadPublicInvoice(token), retry: (n, e) => !(e instanceof ApiError && ['not_found', 'gone'].includes(e.kind)) && n < 2, refetchOnWindowFocus: false, staleTime: Infinity });
  const v = q.data?.view;
  useEffect(() => {
    document.title = v ? `${t('publicInvoice.pageTitle', { number: v.invoice.number })} · ${v.organization.name}` : 'LedgerNest';
  }, [v, t]);

  return (
    <div className="flex min-h-dvh flex-col bg-ink-50 dark:bg-ink-950 print:bg-white">
      <div className="flex items-center justify-end gap-1 p-3 print:hidden">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12">
        {q.isPending ? (
          <Card>
            <SkeletonRows rows={6} />
          </Card>
        ) : q.isError ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <FileX className="size-8 text-ink-400" aria-hidden />
            <h1 className="text-lg font-semibold">{q.error instanceof ApiError && q.error.kind === 'gone' ? t('publicInvoice.voided') : q.error instanceof ApiError && q.error.kind === 'not_found' ? t('publicInvoice.notFound') : t('publicInvoice.failed')}</h1>
            <p className="max-w-sm text-sm text-ink-500">{q.error instanceof ApiError && ['gone', 'not_found'].includes(q.error.kind) ? t('publicInvoice.askBusiness') : t('publicInvoice.tryAgain')}</p>
          </Card>
        ) : (
          v && <Invoice data={q.data!} locale={locale} />
        )}
      </main>
      <footer className="flex items-center justify-center gap-2 pb-6 text-xs text-ink-500 print:hidden">
        <Logo className="size-4" /> {t('publicInvoice.poweredBy')}
      </footer>
    </div>
  );
}

function Invoice({ data, locale }: { data: Awaited<ReturnType<typeof loadPublicInvoice>>; locale: string }) {
  const { t } = useTranslation();
  const { organization: org, invoice: i, upi } = data.view;
  const money = (minor: number) => formatMoney(minor, i.currency, locale);
  const digits = currencyDigits(i.currency);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const paid = i.state === 'paid';
  const overdue = i.state === 'overdue';
  const address = [org.address.line1, org.address.line2, [org.address.city, org.address.region, org.address.postalCode].filter(Boolean).join(', ')].filter(Boolean);
  const pos = INDIAN_STATES.find((s) => s.code === i.placeOfSupply);
  const pdf = data.pdf;
  const filename = `invoice-${i.number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;

  return (
    <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-4">
      {/* What's owed, and how to pay it */}
      <motion.section variants={fadeUp} aria-labelledby="due" className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm sm:p-6 dark:border-ink-800 dark:bg-ink-900 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-3">
              {data.logoUrl && <img src={data.logoUrl} alt="" className="max-h-10 max-w-32 object-contain" />}
              <p className="font-semibold" dir="auto">
                {org.name}
              </p>
            </div>
            <p className="text-sm text-ink-500">
              {t('publicInvoice.billedTo', { name: i.customer.name })} · <span dir="ltr">{i.number}</span>
            </p>
          </div>
          <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', paid ? 'bg-income/10 text-income' : overdue ? 'bg-expense/10 text-expense' : 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300')}>
            {paid && <CheckCircle2 className="size-3.5" aria-hidden />}
            {paid ? t('publicInvoice.paid') : overdue ? t('publicInvoice.overdueSince', { date: day(i.dueDate) }) : t('publicInvoice.dueOn', { date: day(i.dueDate) })}
          </span>
        </div>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p id="due" className="text-sm text-ink-500">
              {paid ? t('publicInvoice.totalPaid') : t('publicInvoice.amountDue')}
            </p>
            <p className="text-3xl font-semibold tracking-tight tabular-nums" dir="ltr">
              {money(paid ? i.total : i.balance)}
            </p>
            {i.amountPaid > 0 && !paid && <p className="mt-1 text-sm text-ink-500">{t('publicInvoice.paidSoFar', { paid: money(i.amountPaid), total: money(i.total) })}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {'href' in pdf ? (
              <a href={pdf.href} download={filename} className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 px-4 text-sm font-medium hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800">
                <FileDown className="size-4" aria-hidden /> {t('common.downloadPdf')}
              </a>
            ) : (
              <button type="button" onClick={() => saveBlob({ blob: pdf.blob(), filename })} className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 px-4 text-sm font-medium hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800">
                <FileDown className="size-4" aria-hidden /> {t('common.downloadPdf')}
              </button>
            )}
          </div>
        </div>
        {upi && !paid && (
          <div className="mt-5 flex flex-col items-center gap-4 rounded-xl bg-ink-50 p-4 sm:flex-row dark:bg-ink-800/60" data-testid="public-upi">
            <UpiQr value={upi.link} label={t('invoices.upi.qrLabel', { amount: money(i.balance), upiId: upi.upiId })} size={160} />
            <div className="space-y-2 text-center sm:text-start">
              <p className="font-semibold">{t('invoices.upi.title')}</p>
              <p className="text-sm text-ink-600 dark:text-ink-300">{t('publicInvoice.upiBody')}</p>
              <p className="font-mono text-xs text-ink-500" dir="ltr">
                {upi.upiId}
              </p>
              <a href={upi.link} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">
                <Smartphone className="size-4" aria-hidden /> {t('publicInvoice.payNow', { amount: money(i.balance) })}
              </a>
              <p className="text-xs text-ink-500">{t('publicInvoice.upiAfter')}</p>
            </div>
          </div>
        )}
      </motion.section>

      {/* The invoice itself */}
      <motion.article variants={fadeUp} aria-label={t('invoices.document', { number: i.number })} className="rounded-2xl border border-ink-200 bg-white p-5 text-sm shadow-sm sm:p-8 dark:border-ink-800 dark:bg-ink-900 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-200 pb-4 dark:border-ink-700">
          <div className="space-y-0.5">
            <p className="font-semibold" dir="auto">
              {org.name}
            </p>
            {address.map((l) => (
              <p key={l} className="text-ink-600 dark:text-ink-300" dir="auto">
                {l}
              </p>
            ))}
            {org.taxId && (
              <p className="text-ink-600 dark:text-ink-300">
                {t('invoices.gstin')} <span className="font-mono">{org.taxId}</span>
              </p>
            )}
            {(org.phone || org.email) && (
              <p className="text-ink-600 dark:text-ink-300" dir="ltr">
                {[org.phone, org.email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="text-end">
            <p className="text-lg font-semibold">{i.taxBreakdown.length ? t('invoices.taxInvoice') : t('invoices.invoice')}</p>
            <p className="font-mono" dir="ltr">
              {i.number}
            </p>
            <p className="text-ink-600 dark:text-ink-300">{t('publicInvoice.dated', { date: day(i.issueDate) })}</p>
          </div>
        </header>
        <div className="grid gap-4 border-b border-ink-200 py-4 sm:grid-cols-2 dark:border-ink-700">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{t('invoices.billTo')}</p>
            <p className="font-medium" dir="auto">
              {i.customer.name}
            </p>
            {i.customer.taxId && <p className="font-mono text-ink-600 dark:text-ink-300">{i.customer.taxId}</p>}
          </div>
          <div className="sm:text-end">
            {pos && <p className="text-ink-600 dark:text-ink-300">{t('publicInvoice.placeOfSupply', { state: `${pos.name} (${pos.code})` })}</p>}
            {i.reference && <p className="text-ink-600 dark:text-ink-300">{t('publicInvoice.reference', { reference: i.reference })}</p>}
          </div>
        </div>
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="mt-2 w-full min-w-[32rem]">
            <thead className="text-start text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-2 text-start font-medium">{t('invoices.columns.item')}</th>
                <th className="py-2 text-end font-medium">{t('invoices.columns.qty')}</th>
                <th className="py-2 text-end font-medium">{t('invoices.columns.rate')}</th>
                <th className="py-2 text-end font-medium">{t('invoices.columns.amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {i.lines.map((l, n) => (
                <tr key={n}>
                  <td className="py-2 pe-3">
                    <span dir="auto">{l.description}</span>
                    {l.hsnSac && <span className="block text-xs text-ink-500">HSN/SAC {l.hsnSac}</span>}
                  </td>
                  <td className="py-2 text-end tabular-nums" dir="ltr">
                    {l.quantity}
                  </td>
                  <td className="py-2 text-end tabular-nums" dir="ltr">
                    {plain(l.unitPrice)}
                    {l.discount > 0 && <span className="block text-xs text-ink-500">−{l.discount}%</span>}
                  </td>
                  <td className="py-2 text-end tabular-nums" dir="ltr">
                    {plain(l.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ms-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          <dt className="text-ink-600 dark:text-ink-300">{t('invoices.subtotal')}</dt>
          <dd className="text-end tabular-nums" dir="ltr">
            {plain(i.subtotal)}
          </dd>
          {i.taxBreakdown.map((x) => (
            <div key={x.name} className="contents">
              <dt className="text-ink-600 dark:text-ink-300">{x.name}</dt>
              <dd className="text-end tabular-nums" dir="ltr">
                {plain(x.amount)}
              </dd>
            </div>
          ))}
          <dt className="border-t border-ink-200 pt-2 font-semibold dark:border-ink-700">{t('invoices.total')}</dt>
          <dd className="border-t border-ink-200 pt-2 text-end font-semibold tabular-nums dark:border-ink-700" dir="ltr">
            {money(i.total)}
          </dd>
          {i.amountPaid > 0 && (
            <>
              <dt className="text-ink-600 dark:text-ink-300">{t('invoices.paid')}</dt>
              <dd className="text-end tabular-nums" dir="ltr">
                {plain(i.amountPaid)}
              </dd>
              <dt className="font-semibold">{t('invoices.balanceDue')}</dt>
              <dd className="text-end font-semibold tabular-nums" dir="ltr">
                {money(i.balance)}
              </dd>
            </>
          )}
        </dl>
        {org.terms && (
          <p className="mt-6 whitespace-pre-line border-t border-ink-200 pt-4 text-xs text-ink-500 dark:border-ink-700" dir="auto">
            {org.terms}
          </p>
        )}
      </motion.article>
    </motion.div>
  );
}
