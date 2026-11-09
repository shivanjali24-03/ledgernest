import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currencyDigits, toMinor, todayIn } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { useSession } from '../layout/session';
import { usePaymentsApi } from '../payments/usePaymentsApi';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { creditNoteErrorMessage } from './errors';
import type { CreditNote, CreditNotesApi } from './types';

/** Put a credit note's remaining credit onto another of the customer's open invoices. */
export default function ApplyCreditDialog({ note, api, onClose }: { note: CreditNote; api: CreditNotesApi; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const settings = useOrganizationSettings().data;
  const paymentsApi = usePaymentsApi();
  const open = useQuery({ queryKey: ['payments', session.organizationId, 'open', 'receipt', note.contact.id], queryFn: () => paymentsApi!.openInvoices(note.contact.id), enabled: !!paymentsApi });
  const invoices = (open.data ?? []).filter((i) => i.currency === note.currency);
  const code = note.currency ?? settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(code);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const [invoiceId, setInvoice] = useState('');
  const chosen = invoices.find((i) => i.id === (invoiceId || invoices[0]?.id));
  const [amount, setAmount] = useState('');
  const amt = amount.trim() ? toMinor(amount, digits) : chosen ? Math.min(note.remaining, chosen.balance) : null;
  const problem = !chosen ? 'invoice' : !amt || amt > note.remaining || amt > chosen.balance ? 'amount' : null;
  const save = useMutation({
    mutationFn: () => api.apply(note.id, { invoiceId: chosen!.id, amount: amt!, date: todayIn(settings?.timeZone ?? 'Asia/Kolkata') }),
    onSuccess: (c) => {
      for (const k of ['credit-notes', 'invoices', 'contacts', 'payments', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('creditNotes.applied', { number: c.number, invoice: chosen!.number }));
      onClose();
    },
    onError: (e) => toast(creditNoteErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`creditNotes.problems.${problem}`), 'error');
    save.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('creditNotes.applyTitle', { number: note.number })}
      description={t('creditNotes.applyBody', { amount: `${code} ${plain(note.remaining)}` })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="apply-credit-form" loading={save.isPending} disabled={!!problem}>
            {t('creditNotes.apply')}
          </Button>
        </>
      }
    >
      <form id="apply-credit-form" onSubmit={submit} noValidate className="space-y-3">
        {invoices.length ? (
          <>
            <SelectField label={t('creditNotes.fields.invoice')} value={chosen?.id ?? ''} onChange={(e) => (setInvoice(e.target.value), setAmount(''))} options={invoices.map((i) => ({ value: i.id, label: `${i.number} · ${t('invoices.balanceDue')} ${plain(i.balance)}` }))} />
            <TextField label={t('payments.fields.amount', { currency: code })} value={amount} placeholder={amt ? plain(amt) : ''} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" />
          </>
        ) : (
          <p className="text-sm text-ink-500">{open.isPending ? '…' : t('payments.nothingOpen')}</p>
        )}
      </form>
    </Modal>
  );
}
