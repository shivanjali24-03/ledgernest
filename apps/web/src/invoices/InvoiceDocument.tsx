import clsx from 'clsx';
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { currencyDigits, INDIAN_STATES, rupeesInWords, upiPayUri, batchLabel, dispatchLines, hsnSummary, supplyDeclaration, isExport, bankDetailsLine } from '@ledgernest/shared';
import { Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { countryName, formatDate, formatMoney } from '../lib/format';
import { useSession } from '../layout/session';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import { useSettingsApi } from '../settings/useSettingsApi';
import UpiQr from '../ui/UpiQr';
import type { Invoice } from './types';

const stateName = (code: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name ?? null;

/**
 * The invoice as the customer sees it: the organisation's logo and details, the customer, the lines with
 * HSN/SAC codes, the tax by rate and the total. It is also what prints (the app's chrome hides when printing).
 */
export default function InvoiceDocument({ invoice: i }: { invoice: Invoice }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const org = useOrganizationSettings().data;
  const settingsApi = useSettingsApi();
  const logo = useQuery({ queryKey: ['settings', session.organizationId, 'logo', org?.logo?.updatedAt], queryFn: () => settingsApi!.logo(), enabled: !!settingsApi && !!org?.logo });
  const logoUrl = useMemo(() => (logo.data ? URL.createObjectURL(logo.data) : null), [logo.data]);
  useEffect(() => () => void (logoUrl && URL.revokeObjectURL(logoUrl)), [logoUrl]);

  const currency = i.currency ?? org?.baseCurrency ?? 'INR';
  const digits = currencyDigits(currency);
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const address = (a: Record<string, string | null> | { line1: string | null; line2: string | null; city: string | null; region: string | null; postalCode: string | null; country?: string | null }) =>
    [a.line1, a.line2, [a.city, a.region, a.postalCode].filter(Boolean).join(', '), a.country && a.country !== org?.country ? countryName(a.country, locale) : null].filter(Boolean);
  const pos = stateName(i.placeOfSupply);
  // Pay by UPI: rupee invoices with something still owed, once the organisation has its UPI ID
  const upi =
    org?.upiId && currency === 'INR' && i.status === 'issued' && i.balance > 0 && i.number
      ? upiPayUri({ upiId: org.upiId, name: org.legalName ?? org.name, amount: i.balance, note: `Invoice ${i.number}`, reference: i.number })
      : null;

  return (
    <article className="rounded-2xl border border-ink-200 bg-white p-6 text-sm text-ink-900 shadow-sm sm:p-10 print:border-0 print:p-0 print:shadow-none dark:border-ink-800 dark:bg-ink-900 dark:text-ink-50 print:dark:bg-white print:dark:text-ink-900" aria-label={t('invoices.document', { number: i.number ?? t('invoices.draft') })}>
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-ink-200 pb-6 dark:border-ink-700">
        <div className="space-y-1">
          {logoUrl && <img src={logoUrl} alt="" className="mb-3 max-h-14 max-w-48 object-contain" />}
          <p className="text-base font-semibold" dir="auto">
            {org?.legalName ?? org?.name ?? session.organization}
          </p>
          {org && address(org.address).map((l) => (
            <p key={l} className="text-ink-600 dark:text-ink-300" dir="auto">
              {l}
            </p>
          ))}
          {org?.taxId && (
            <p className="text-ink-600 dark:text-ink-300">
              {t('invoices.gstin')} <span className="font-mono">{org.taxId}</span>
            </p>
          )}
        </div>
        <div className="text-end">
          <p className="text-2xl font-semibold tracking-tight">{i.taxBreakdown.length && org?.country === 'IN' ? t('invoices.taxInvoice') : t('invoices.invoice')}</p>
          <p className="mt-1 font-mono text-base" dir="ltr">
            {i.number ?? t('invoices.draft')}
          </p>
          <dl className="mt-3 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5 text-ink-600 dark:text-ink-300">
            <dt>{t('invoices.fields.issueDate')}</dt>
            <dd>{day(i.issueDate)}</dd>
            <dt>{t('invoices.fields.dueDate')}</dt>
            <dd>{day(i.dueDate)}</dd>
            {i.reference && (
              <>
                <dt>{t('invoices.fields.reference')}</dt>
                <dd dir="auto">{i.reference}</dd>
              </>
            )}
          </dl>
        </div>
      </header>

      <section className="grid gap-6 border-b border-ink-200 py-6 sm:grid-cols-2 dark:border-ink-700">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{t('invoices.billTo')}</p>
          <p className="font-semibold" dir="auto">
            {i.contact.legalName ?? i.contact.name}
          </p>
          {address(i.contact.billingAddress).map((l) => (
            <p key={l} className="text-ink-600 dark:text-ink-300" dir="auto">
              {l}
            </p>
          ))}
          {i.contact.taxId && (
            <p className="text-ink-600 dark:text-ink-300">
              {/^\d{2}[A-Z0-9]{13}$/.test(i.contact.taxId) ? t('invoices.gstin') : t('invoices.taxId')} <span className="font-mono">{i.contact.taxId}</span>
            </p>
          )}
          {i.shipTo && (
            <div className="pt-2" data-testid="invoice-ship-to">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{t('shipTo.title')}</p>
              <p className="font-semibold" dir="auto">
                {i.shipTo.name ?? i.contact.legalName ?? i.contact.name}
              </p>
              {address({ ...i.shipTo }).map((l) => (
                <p key={l} className="text-ink-600 dark:text-ink-300" dir="auto">
                  {l}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1 sm:text-end">
          {pos && (
            <p className="text-ink-600 dark:text-ink-300">
              {t('invoices.placeOfSupply', { state: pos, code: i.placeOfSupply })}
            </p>
          )}
          {i.currency && i.rate && <p className="text-ink-600 dark:text-ink-300">{t('invoices.rateNote', { code: i.currency, rate: i.rate, base: org?.baseCurrency ?? '' })}</p>}
        </div>
      </section>

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-700">
            <tr>
              <th scope="col" className="py-2 text-start font-semibold">
                {t('invoices.columns.item')}
              </th>
              <th scope="col" className="py-2 text-end font-semibold">
                {t('invoices.columns.qty')}
              </th>
              <th scope="col" className="py-2 text-end font-semibold">
                {t('invoices.columns.rate')}
              </th>
              <th scope="col" className="py-2 text-end font-semibold">
                {t('invoices.columns.tax')}
              </th>
              <th scope="col" className="py-2 text-end font-semibold">
                {t('invoices.columns.amount')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {i.lines.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="py-2.5 pe-4">
                  <span className="block" dir="auto">
                    {l.description}
                  </span>
                  {l.item?.hsnSac && <span className="block text-xs text-ink-500">{t('invoices.hsnSac', { code: l.item.hsnSac })}</span>}
                  {(l.serials?.length ?? 0) > 0 && (
                    <span className="block font-mono text-xs text-ink-500" dir="ltr">
                      {t('serials.short')} {l.serials!.join(', ')}
                    </span>
                  )}
                  {(l.batches ?? []).map((b) => (
                    <span key={b.batchNo} className="block text-xs text-ink-500" dir="ltr">
                      {batchLabel(b)} · {b.quantity}
                    </span>
                  ))}
                </td>
                <td className="py-2.5 text-end tabular-nums" dir="ltr">
                  {l.quantity}
                  {l.item?.unit && <span className="ms-1 text-xs text-ink-500">{l.item.unit}</span>}
                </td>
                <td className="py-2.5 text-end tabular-nums" dir="ltr">
                  {plain(l.unitPrice)}
                  {l.discount > 0 && <span className="block text-xs text-ink-500">−{l.discount}%</span>}
                </td>
                <td className="py-2.5 text-end text-ink-600 dark:text-ink-300">{(l.taxGroup ?? l.rcmTaxGroup)?.name ?? '—'}</td>
                <td className="py-2.5 text-end tabular-nums" dir="ltr">
                  {plain(l.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-4 flex flex-wrap-reverse items-start justify-between gap-6">
        {upi ? (
          <div className="flex items-center gap-4 rounded-xl border border-ink-200 p-3 dark:border-ink-700 print:border-ink-300" data-testid="invoice-upi">
            <UpiQr value={upi} label={t('invoices.upi.qrLabel', { amount: money(i.balance), upiId: org!.upiId })} size={112} />
            <div className="space-y-1">
              <p className="font-semibold">{t('invoices.upi.title')}</p>
              <p className="text-xs text-ink-600 dark:text-ink-300">{t('invoices.upi.body')}</p>
              <p className="text-base font-semibold tabular-nums" dir="ltr">
                {money(i.balance)}
              </p>
              <p className="font-mono text-xs text-ink-600 dark:text-ink-300" dir="ltr">
                {org!.upiId}
              </p>
              <a href={upi} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline sm:hidden print:hidden dark:text-brand-300">
                <Smartphone className="size-3.5" aria-hidden /> {t('invoices.upi.open')}
              </a>
            </div>
          </div>
        ) : (
          <span />
        )}
        <dl className="ms-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1">
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
          {!!i.discountTotal && (
            <>
              <dt className="text-ink-600 dark:text-ink-300">{t('invoices.discountIncluded')}</dt>
              <dd className="text-end tabular-nums" dir="ltr">
                −{plain(i.discountTotal)}
              </dd>
            </>
          )}
          {!!i.roundOff && (
            <>
              <dt className="text-ink-600 dark:text-ink-300">{t('invoices.roundOff')}</dt>
              <dd className="text-end tabular-nums" dir="ltr">
                {plain(i.roundOff)}
              </dd>
            </>
          )}
          <dt className="border-t border-ink-200 pt-2 font-semibold dark:border-ink-700">{t('invoices.total')}</dt>
          <dd className="border-t border-ink-200 pt-2 text-end text-base font-semibold tabular-nums dark:border-ink-700" dir="ltr">
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
      </section>
      {currency === 'INR' && (
        <p className="mt-4 text-end text-xs text-ink-600 dark:text-ink-300" data-testid="amount-in-words">
          <span className="font-medium">{t('invoices.amountInWords')}</span> {rupeesInWords(i.total)}
        </p>
      )}
      {i.notes && (
        <p className="mt-8 whitespace-pre-line border-t border-ink-200 pt-4 text-ink-600 dark:border-ink-700 dark:text-ink-300" dir="auto">
          {i.notes}
        </p>
      )}
      {org?.bankDetails && (
        <p className="mt-6 text-xs text-ink-600 dark:text-ink-300" dir="ltr" data-testid="invoice-bank">
          {bankDetailsLine(org.bankDetails)}
        </p>
      )}
      {org?.invoiceTerms && (
        <p className="mt-6 whitespace-pre-line text-xs text-ink-500" dir="auto" data-testid="invoice-terms">
          {org.invoiceTerms}
        </p>
      )}
      {i.pricesIncludeTax && <p className="mt-2 text-xs text-ink-500">{t('invoices.pricesIncludeTaxNote')}</p>}
      {(() => {
        const rows = hsnSummary(i.lines.map((l) => ({ ...l, ratePct: l.taxGroup ? Number(/(\d+(?:\.\d+)?)\s*%/.exec(l.taxGroup.name)?.[1] ?? NaN) || null : null })));
        return rows.length > 1 || (rows.length === 1 && i.lines.length > 1) ? (
          <table className="mt-4 text-xs" data-testid="invoice-hsn-summary">
            <caption className="pb-1 text-start font-semibold">{t('invoices.hsnSummary')}</caption>
            <thead className="text-ink-500">
              <tr>
                <th scope="col" className="pe-4 text-start font-medium">HSN/SAC</th>
                <th scope="col" className="pe-4 text-end font-medium">{t('reports.gst.rate')}</th>
                <th scope="col" className="pe-4 text-end font-medium">{t('reports.gst.taxable')}</th>
                <th scope="col" className="text-end font-medium">{t('invoices.taxColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.hsn}-${r.rate}`}>
                  <td className="pe-4 font-mono">{r.hsn}</td>
                  <td className="pe-4 text-end tabular-nums">{r.rate != null ? `${r.rate}%` : ''}</td>
                  <td className="pe-4 text-end tabular-nums" dir="ltr">{plain(r.taxable)}</td>
                  <td className="text-end tabular-nums" dir="ltr">{plain(r.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null;
      })()}
      {i.reverseCharge && (
        <div className="mt-4 rounded border border-ink-200 px-3 py-2 text-xs text-ink-700 dark:border-ink-700 dark:text-ink-200" data-testid="invoice-reverse-charge">
          <p className="font-semibold">{t('invoices.reverseCharge.yes')}</p>
          {!!i.reverseChargeTax?.length && (
            <p className="mt-1">
              {t('invoices.reverseCharge.buyerPays')}: <span dir="ltr">{i.reverseChargeTax.map((x) => `${x.name} ${money(x.amount)}`).join(', ')}</span>
            </p>
          )}
        </div>
      )}
      {i.supplyKind && i.supplyKind !== 'regular' && (
        <div className="mt-4 rounded border border-ink-200 px-3 py-2 text-xs text-ink-700 dark:border-ink-700 dark:text-ink-200" data-testid="invoice-supply-declaration">
          <p className="font-semibold">{supplyDeclaration(i.supplyKind, { number: org?.lutNumber ?? null })}</p>
          {isExport(i.supplyKind) && i.exportDetails && (
            <p className="mt-1" dir="ltr">
              {[i.exportDetails.shippingBillNo && `${t('invoices.exportFields.shippingBillNo')}: ${i.exportDetails.shippingBillNo}`, i.exportDetails.shippingBillDate && `${t('invoices.exportFields.shippingBillDate')}: ${i.exportDetails.shippingBillDate}`, i.exportDetails.portCode && `${t('invoices.exportFields.portCode')}: ${i.exportDetails.portCode}`, i.exportDetails.countryCode && `${t('invoices.exportFields.countryCode')}: ${i.exportDetails.countryCode}`].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      )}
      {i.dispatch && dispatchLines(i.dispatch).length > 0 && (
        <ul className="mt-4 grid gap-x-6 text-xs text-ink-600 sm:grid-cols-2 dark:text-ink-300" data-testid="invoice-dispatch">
          {dispatchLines(i.dispatch).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {i.instalments && i.instalments.length > 0 && (
        <table className="mt-6 text-xs" data-testid="invoice-instalments">
          <caption className="pb-1 text-start font-semibold">{t('instalments.payable')}</caption>
          <tbody>
            {i.instalments.map((x, n) => (
              <tr key={n}>
                <td className="pe-3 text-ink-500">{n + 1}.</td>
                <td className="pe-3">{day(x.dueDate)}</td>
                <td className="pe-3 text-end font-mono tabular-nums" dir="ltr">
                  {plain(x.amount)}
                </td>
                {x.state && i.status === 'issued' && <td className={clsx('print:hidden', x.state === 'overdue' ? 'text-expense' : 'text-ink-500')}>{t(`instalments.states.${x.state}`)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {i.interest && (
        <p className={clsx('text-xs text-ink-500', !org?.invoiceTerms && 'mt-6')} data-testid="invoice-interest-terms">
          {t(i.interest.graceDays ? 'invoices.interest.terms' : 'invoices.interest.termsNoGrace', { rate: i.interest.rateBp / 100, method: t(`invoices.interest.methods.${i.interest.method}`), grace: i.interest.graceDays, count: i.interest.graceDays })}
        </p>
      )}
    </article>
  );
}
