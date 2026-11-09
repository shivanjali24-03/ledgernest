import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currencyDigits, toMinor, todayIn } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useAccountsApi } from '../accounts/useAccountsApi';
import { useIntlLocale } from '../i18n';
import { useSession } from '../layout/session';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { creditNoteErrorMessage } from './errors';
import type { CreditNote, CreditNotesApi } from './types';

/** Pay a credit note's remaining credit back to the customer from a bank or cash account. */
export default function RefundDialog({ note, api, onClose }: { note: CreditNote; api: CreditNotesApi; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const settings = useOrganizationSettings().data;
  const accountsApi = useAccountsApi();
  const accounts = useQuery({ queryKey: ['accounts', session.organizationId, session.role ?? session.customRoleName, 'all'], queryFn: () => accountsApi!.list(true), enabled: !!accountsApi });
  const banks = useMemo(() => (accounts.data ?? []).filter((a) => a.type === 'asset' && (a.subtype === 'bank' || a.subtype === 'cash') && !a.archived && (!a.currency || a.currency === note.currency)), [accounts.data, note.currency]);
  const code = note.currency ?? settings?.baseCurrency ?? 'INR';
  const digits = currencyDigits(code);
  const plain = (minor: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
  const [bankAccountId, setBank] = useState('');
  const bank = bankAccountId || banks[0]?.id || '';
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [amount, setAmount] = useState(() => plain(note.remaining));
  const [reference, setReference] = useState('');
  const amt = toMinor(amount, digits);
  const problem = !bank ? 'bank' : !amt || amt > note.remaining ? 'amount' : null;
  const save = useMutation({
    mutationFn: () => api.refund(note.id, { date, bankAccountId: bank, amount: amt!, reference: reference || null }),
    onSuccess: (c) => {
      for (const k of ['credit-notes', 'contacts', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('creditNotes.refunded', { number: c.number }));
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
      title={t('creditNotes.refundTitle', { number: note.number })}
      description={t('creditNotes.refundBody', { name: note.contact.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="refund-form" loading={save.isPending} disabled={!!problem}>
            {t('creditNotes.refund')}
          </Button>
        </>
      }
    >
      <form id="refund-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('payments.fields.datePaid')} type="date" value={date} min={note.date} onChange={(e) => setDate(e.target.value)} />
        <SelectField label={t('payments.fields.from')} value={bank} onChange={(e) => setBank(e.target.value)} options={banks.length ? banks.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}${a.currency ? ` (${a.currency})` : ''}` })) : [{ value: '', label: t('payments.noBank') }]} />
        <TextField label={t('payments.fields.amount', { currency: code })} value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => amt && setAmount(plain(amt))} inputMode="decimal" dir="ltr" className="text-end font-mono" />
        <TextField label={t('payments.fields.reference')} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="NEFT 7731" dir="auto" />
      </form>
    </Modal>
  );
}
