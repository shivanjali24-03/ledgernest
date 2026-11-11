import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currencyDigits, formatQuantity, invoiceAmounts, parseQuantity, todayIn } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import type { Invoice } from '../invoices/types';
import { useSession } from '../layout/session';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import { useTaxesApi } from '../taxes/useTaxesApi';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { creditNoteErrorMessage } from './errors';
import type { CreditNote, CreditNotesApi } from './types';

/** Credit some or all of an invoice's lines: how much of each, worked out with its tax as you type. */
export default function CreditNoteDialog({ invoice, api, onClose, onDone }: { invoice: Invoice; api: CreditNotesApi; onClose: () => void; onDone: (c: CreditNote) => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const settings = useOrganizationSettings().data;
  const taxesApi = useTaxesApi();
  const taxes = useQuery({ queryKey: ['taxes', session.organizationId, session.role ?? session.customRoleName], queryFn: () => taxesApi!.list(), enabled: !!taxesApi });
  const left = useQuery({ queryKey: ['credit-notes', session.organizationId, 'creditable', invoice.id], queryFn: () => api.creditable(invoice.id) });
  const code = invoice.currency ?? settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(code);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [reason, setReason] = useState('');
  const [returnsStock, setReturnsStock] = useState(false);
  // Goods with serial numbers coming back: which units, ticked from those sold on the line
  const [back, setBack] = useState<Record<string, string[]>>({});
  const toggle = (lineId: string, serial: string) =>
    setBack((b) => {
      const now = b[lineId]?.includes(serial) ? b[lineId]!.filter((x) => x !== serial) : [...(b[lineId] ?? []), serial];
      setQty((q) => ({ ...q, [lineId]: now.length ? String(now.length) : '' }));
      return { ...b, [lineId]: now };
    });

  const room = (lineId: string) => parseQuantity(left.data?.find((l) => l.invoiceLineId === lineId)?.quantity ?? '0') ?? 0n;
  const rows = invoice.lines.map((l) => {
    const typed = qty[l.id]?.trim() ?? '';
    const q = typed ? parseQuantity(typed) : 0n;
    const rates = (taxes.data?.groups.find((g) => g.id === l.taxGroup?.id)?.rates ?? []).map((r) => ({ rateId: r.id, ratePpm: r.ratePpm }));
    return { line: l, typed, q, rates, invalid: q === null || (q ?? 0n) > room(l.id) };
  });
  const chosen = rows.filter((r) => r.q && !r.invalid);
  const amounts = invoiceAmounts(chosen.map((r) => ({ quantity: formatQuantity(r.q!), unitPrice: r.line.unitPrice, discountPpm: Math.round(r.line.discount * 10_000), rates: r.rates })));
  const problem = rows.some((r) => r.invalid) ? 'quantity' : !chosen.length ? 'nothing' : null;

  const save = useMutation({
    mutationFn: () => api.create({ invoiceId: invoice.id, date, reason: reason || null, returnsStock, lines: chosen.map((r) => ({ invoiceLineId: r.line.id, quantity: formatQuantity(r.q!), ...(returnsStock && r.line.item?.trackSerials ? { serials: back[r.line.id] ?? [] } : {}) })) }),
    onSuccess: (c) => {
      for (const k of ['credit-notes', 'invoices', 'contacts', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('creditNotes.issued', { number: c.number }));
      onDone(c);
    },
    onError: (e) => toast(creditNoteErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`creditNotes.problems.${problem}`), 'error');
    save.mutate();
  };
  const all = () => setQty(Object.fromEntries(invoice.lines.map((l) => [l.id, formatQuantity(room(l.id))])));

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={t('creditNotes.createTitle', { number: invoice.number })}
      description={t('creditNotes.createBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="credit-note-form" loading={save.isPending} disabled={!!problem}>
            {t('creditNotes.issue')}
          </Button>
        </>
      }
    >
      <form id="credit-note-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('creditNotes.fields.date')} type="date" value={date} min={invoice.issueDate} onChange={(e) => setDate(e.target.value)} />
          <TextField label={t('creditNotes.fields.reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('creditNotes.reasonPlaceholder')} dir="auto" data-autofocus />
        </div>
        {invoice.lines.some((l) => l.item) && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={returnsStock} onChange={(e) => setReturnsStock(e.target.checked)} className="mt-0.5 size-4 rounded accent-brand-600" />
            <span>
              <span className="font-medium">{t('creditNotes.returnsStock')}</span>
              <span className="block text-xs text-ink-500">{t('creditNotes.returnsStockHint')}</span>
            </span>
          </label>
        )}
        <fieldset className="space-y-2">
          <div className="flex items-center gap-2">
            <legend className="flex-1 text-sm font-semibold">{t('creditNotes.whichLines')}</legend>
            <Button type="button" size="sm" variant="ghost" onClick={all} disabled={!left.data}>
              {t('creditNotes.creditAll')}
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th scope="col" className="py-1.5 text-start font-semibold">
                  {t('invoices.columns.description')}
                </th>
                <th scope="col" className="py-1.5 text-end font-semibold">
                  {t('creditNotes.left')}
                </th>
                <th scope="col" className="w-28 py-1.5 text-end font-semibold">
                  {t('creditNotes.credit')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {rows.map((r) => (
                <tr key={r.line.id}>
                  <td className="py-1.5 pe-3" dir="auto">
                    {r.line.description}
                    <span className="block text-xs text-ink-500">
                      {r.line.quantity} × {plain(r.line.unitPrice)}
                      {r.line.taxGroup && ` · ${r.line.taxGroup.name}`}
                    </span>
                    {returnsStock && r.line.item?.trackSerials && (r.line.serials?.length ?? 0) > 0 && (
                      <fieldset className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <legend className="sr-only">{t('serials.returning', { description: r.line.description })}</legend>
                        {r.line.serials!.map((sn) => (
                          <label key={sn} className="flex items-center gap-1 font-mono text-xs" dir="ltr">
                            <input type="checkbox" checked={back[r.line.id]?.includes(sn) ?? false} onChange={() => toggle(r.line.id, sn)} className="size-3.5 rounded accent-brand-600" />
                            {sn}
                          </label>
                        ))}
                      </fieldset>
                    )}
                  </td>
                  <td className="py-1.5 text-end font-mono tabular-nums" dir="ltr">
                    {left.data ? formatQuantity(room(r.line.id)) : '…'}
                  </td>
                  <td className="py-1 ps-3">
                    <input
                      aria-label={t('creditNotes.creditLine', { description: r.line.description })}
                      value={qty[r.line.id] ?? ''}
                      onChange={(e) => setQty((q) => ({ ...q, [r.line.id]: e.target.value }))}
                      inputMode="decimal"
                      placeholder="0"
                      disabled={!room(r.line.id)}
                      dir="ltr"
                      className={`h-8 w-full rounded-lg border bg-white px-2 text-end font-mono text-sm disabled:opacity-50 dark:bg-ink-900 ${r.invalid ? 'border-expense' : 'border-ink-200 dark:border-ink-700'}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
        <dl className="ms-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm" role="status" aria-label={t('invoices.totals')}>
          <dt className="text-ink-500">{t('invoices.subtotal')}</dt>
          <dd className="text-end font-mono tabular-nums" dir="ltr">
            {plain(amounts.subtotal)}
          </dd>
          <dt className="text-ink-500">{t('creditNotes.tax')}</dt>
          <dd className="text-end font-mono tabular-nums" dir="ltr">
            {plain(amounts.tax)}
          </dd>
          <dt className="border-t border-ink-200 pt-1 font-semibold dark:border-ink-700">{t('creditNotes.total')}</dt>
          <dd className="border-t border-ink-200 pt-1 text-end font-mono font-semibold tabular-nums dark:border-ink-700" dir="ltr">
            {code} {plain(amounts.total)}
          </dd>
        </dl>
        {amounts.total > 0 && <p className="text-sm text-ink-500">{amounts.total > invoice.balance ? t('creditNotes.someLeftOver', { amount: `${code} ${plain(amounts.total - Math.max(invoice.balance, 0))}` }) : t('creditNotes.offInvoice')}</p>}
      </form>
    </Modal>
  );
}
