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
import { debitNoteErrorMessage } from './errors';
import type { DebitNote, DebitNotesApi } from './types';

/** Put a debit note's remaining credit onto another of the vendor's open bills. */
export default function ApplyDebitDialog({ note, api, onClose }: { note: DebitNote; api: DebitNotesApi; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const settings = useOrganizationSettings().data;
  const paymentsApi = usePaymentsApi();
  const open = useQuery({ queryKey: ['payments', session.organizationId, 'open', 'payment', note.contact.id], queryFn: () => paymentsApi!.openBills(note.contact.id), enabled: !!paymentsApi });
  const bills = (open.data ?? []).filter((b) => !b.currency);
  const code = settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(code);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const [billId, setBill] = useState('');
  const chosen = bills.find((b) => b.id === (billId || bills[0]?.id));
  const [amount, setAmount] = useState('');
  const amt = amount.trim() ? toMinor(amount, digits) : chosen ? Math.min(note.remaining, chosen.balance) : null;
  const problem = !chosen ? 'bill' : !amt || amt > note.remaining || amt > chosen.balance ? 'amount' : null;
  const save = useMutation({
    mutationFn: () => api.apply(note.id, { billId: chosen!.id, amount: amt!, date: todayIn(settings?.timeZone ?? 'Asia/Kolkata') }),
    onSuccess: (c) => {
      for (const k of ['debit-notes', 'bills', 'contacts', 'payments', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('debitNotes.applied', { number: c.number, bill: chosen!.number }));
      onClose();
    },
    onError: (e) => toast(debitNoteErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`debitNotes.problems.${problem}`), 'error');
    save.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('debitNotes.applyTitle', { number: note.number })}
      description={t('debitNotes.applyBody', { amount: `${code} ${plain(note.remaining)}` })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="apply-debit-form" loading={save.isPending} disabled={!!problem}>
            {t('debitNotes.apply')}
          </Button>
        </>
      }
    >
      <form id="apply-debit-form" onSubmit={submit} noValidate className="space-y-3">
        {bills.length ? (
          <>
            <SelectField label={t('debitNotes.fields.bill')} value={chosen?.id ?? ''} onChange={(e) => (setBill(e.target.value), setAmount(''))} options={bills.map((b) => ({ value: b.id, label: `${b.number}${b.vendorReference ? ` (${b.vendorReference})` : ''} · ${t('invoices.balanceDue')} ${plain(b.balance)}` }))} />
            <TextField label={t('payments.fields.amount', { currency: code })} value={amount} placeholder={amt ? plain(amt) : ''} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" />
          </>
        ) : (
          <p className="text-sm text-ink-500">{open.isPending ? '…' : t('payments.nothingToPay')}</p>
        )}
      </form>
    </Modal>
  );
}
