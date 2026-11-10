import { currencyDigits, INDIAN_STATES, batchLabel } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatDate, formatMoney } from '../lib/format';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import type { Bill } from './types';

/** A recorded bill as booked: the vendor, what was bought and where it went, input tax by rate, and what's left to pay. */
export default function BillDocument({ bill: b }: { bill: Bill }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const org = useOrganizationSettings().data;
  const currency = b.currency ?? org?.baseCurrency ?? 'INR';
  const digits = currencyDigits(currency);
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const plain = (minor: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** digits);
  const day = (d: string) => formatDate(`${d}T00:00:00Z`, locale);
  const from = INDIAN_STATES.find((s) => s.code === b.placeOfSupply)?.name;
  const cell = 'px-3 py-2';

  return (
    <article
      className="rounded-2xl border border-ink-200 bg-white p-6 text-sm shadow-sm dark:border-ink-800 dark:bg-ink-900"
      aria-label={t('bills.document', {
        number: b.number ?? t('invoices.draft'),
      })}
    >
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-ink-200 pb-5 dark:border-ink-700">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-ink-400">{t('bills.fields.vendor')}</p>
          <p className="text-base font-semibold" dir="auto">
            {b.contact.legalName ?? b.contact.name}
          </p>
          {b.contact.taxId && (
            <p className="text-ink-600 dark:text-ink-300">
              {t('invoices.gstin')} <span className="font-mono">{b.contact.taxId}</span>
            </p>
          )}
          {from && <p className="text-ink-600 dark:text-ink-300">{t('bills.suppliedFrom', { state: from })}</p>}
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-end">
          <dt className="text-ink-500">{t('bills.fields.vendorReference')}</dt>
          <dd className="font-mono" dir="ltr">
            {b.vendorReference ?? '—'}
          </dd>
          {b.vendorBillDate && b.vendorBillDate !== b.billDate && (
            <>
              <dt className="text-ink-500">{t('bills.fields.vendorBillDate')}</dt>
              <dd>{day(b.vendorBillDate)}</dd>
            </>
          )}
          <dt className="text-ink-500">{t('bills.fields.billDate')}</dt>
          <dd>{day(b.billDate)}</dd>
          <dt className="text-ink-500">{t('invoices.fields.dueDate')}</dt>
          <dd>{day(b.dueDate)}</dd>
          {b.rate && (
            <>
              <dt className="text-ink-500">{t('bills.rate')}</dt>
              <dd className="font-mono" dir="ltr">
                1 {b.currency} = {b.rate} {org?.baseCurrency}
              </dd>
            </>
          )}
        </dl>
      </header>
      <div className="overflow-x-auto">
        <table className="mt-4 w-full min-w-[640px]">
          <thead className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-400 dark:border-ink-700">
            <tr>
              <th scope="col" className={`${cell} text-start font-semibold`}>
                {t('invoices.columns.description')}
              </th>
              <th scope="col" className={`${cell} text-start font-semibold`}>
                {t('bills.columns.account')}
              </th>
              <th scope="col" className={`${cell} text-end font-semibold`}>
                {t('invoices.columns.qty')}
              </th>
              <th scope="col" className={`${cell} text-end font-semibold`}>
                {t('invoices.columns.price', { currency })}
              </th>
              <th scope="col" className={`${cell} text-start font-semibold`}>
                {t('invoices.columns.tax')}
              </th>
              <th scope="col" className={`${cell} text-end font-semibold`}>
                {t('invoices.columns.amount')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {b.lines.map((l) => (
              <tr key={l.id}>
                <td className={cell} dir="auto">
                  {l.description}
                  {(l.serials?.length ?? 0) > 0 && (
                    <span className="block font-mono text-xs text-ink-500" dir="ltr">
                      {t('serials.short')} {l.serials!.join(', ')}
                    </span>
                  )}
                  {l.batchNo && (
                    <span className="block text-xs text-ink-500" dir="ltr">
                      {batchLabel({ batchNo: l.batchNo, mfgDate: l.mfgDate, expiryDate: l.expiryDate })}
                    </span>
                  )}
                </td>
                <td className={`${cell} text-ink-600 dark:text-ink-300`}>{l.account && `${l.account.code} · ${l.account.name}`}</td>
                <td className={`${cell} text-end font-mono tabular-nums`} dir="ltr">
                  {l.quantity}
                </td>
                <td className={`${cell} text-end font-mono tabular-nums`} dir="ltr">
                  {plain(l.unitPrice)}
                </td>
                <td className={cell}>{l.taxGroup?.name ?? '—'}</td>
                <td className={`${cell} text-end font-mono tabular-nums`} dir="ltr">
                  {plain(l.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ms-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1" aria-label={t('invoices.totals')}>
        <dt className="text-ink-500">{t('invoices.subtotal')}</dt>
        <dd className="text-end font-mono tabular-nums" dir="ltr">
          {plain(b.subtotal)}
        </dd>
        {b.taxBreakdown.map((x) => (
          <div key={x.name} className="contents">
            <dt className="text-ink-500">{x.name}</dt>
            <dd className="text-end font-mono tabular-nums" dir="ltr">
              {plain(x.amount)}
            </dd>
          </div>
        ))}
        <dt className="border-t border-ink-200 pt-1 font-semibold dark:border-ink-700">{t('invoices.total')}</dt>
        <dd className="border-t border-ink-200 pt-1 text-end font-mono font-semibold tabular-nums dark:border-ink-700" dir="ltr">
          {money(b.total)}
        </dd>
        {b.amountPaid > 0 && (
          <>
            <dt className="text-ink-500">{t('bills.paid')}</dt>
            <dd className="text-end font-mono tabular-nums" dir="ltr">
              {plain(b.amountPaid)}
            </dd>
          </>
        )}
        {b.status === 'open' && (
          <>
            <dt className="font-semibold">{t('bills.toPay')}</dt>
            <dd className="text-end font-mono font-semibold tabular-nums" dir="ltr">
              {money(b.balance)}
            </dd>
          </>
        )}
      </dl>
      {b.reverseCharge && (
        <div className="mt-4 rounded border border-ink-200 px-3 py-2 text-xs text-ink-700 dark:border-ink-700 dark:text-ink-200" data-testid="bill-reverse-charge">
          <p className="font-semibold">{t('bills.reverseCharge.note')}</p>
          {!!b.reverseChargeTax?.length && (
            <p className="mt-1">
              {t('bills.reverseCharge.wePay')}: <span dir="ltr">{b.reverseChargeTax.map((x) => `${x.name} ${plain(x.amount)}`).join(', ')}</span>
            </p>
          )}
          {b.selfInvoiceNumber && <p className="mt-1">{t('bills.reverseCharge.selfInvoiceNo', { number: b.selfInvoiceNumber })}</p>}
        </div>
      )}
      {b.notes && (
        <p className="mt-4 border-t border-ink-100 pt-4 text-ink-600 dark:border-ink-800 dark:text-ink-300" dir="auto">
          {b.notes}
        </p>
      )}
    </article>
  );
}
