import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { currencyDigits, toMinor, todayIn } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { useOrganizationSettings } from '../settings/useOrganizationSettings';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { bankingErrorMessage } from './errors';
import type { BankAccount, BankingApi } from './types';

/** Move money between two of the business's own accounts; between currencies, say what arrived too. */
export default function TransferDialog({ api, banks, fromAccountId, onClose }: { api: BankingApi; banks: BankAccount[]; fromAccountId?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useOrganizationSettings().data;
  const base = settings?.baseCurrency ?? 'INR';
  const usable = banks.filter((b) => !b.archived && !b.hasChildren);
  const [fromId, setFrom] = useState(fromAccountId ?? usable[0]?.id ?? '');
  const [toId, setTo] = useState(usable.find((b) => b.id !== (fromAccountId ?? usable[0]?.id))?.id ?? '');
  const from = usable.find((b) => b.id === fromId);
  const to = usable.find((b) => b.id === toId);
  const fromCode = from?.currency ?? base;
  const toCode = to?.currency ?? base;
  const crossCurrency = !!from && !!to && fromCode !== toCode;
  const [date, setDate] = useState(() => todayIn(settings?.timeZone ?? 'Asia/Kolkata'));
  const [amount, setAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const amt = toMinor(amount, currencyDigits(fromCode));
  const toAmt = crossCurrency ? toMinor(toAmount, currencyDigits(toCode)) : amt;
  const problem = !from || !to ? 'accounts' : from.id === to.id ? 'sameAccount' : !amt ? 'amount' : !toAmt ? 'toAmount' : null;

  const save = useMutation({
    mutationFn: () => api.transfer({ fromAccountId: fromId, toAccountId: toId, date, amount: amt!, toAmount: crossCurrency ? toAmt : null, reference: reference || null, description: description || null }),
    onSuccess: () => {
      for (const k of ['banking', 'journals', 'reports']) void queryClient.invalidateQueries({ queryKey: [k] });
      toast(t('banking.transferred', { from: from!.name, to: to!.name }));
      onClose();
    },
    onError: (e) => toast(bankingErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return toast(t(`banking.problems.${problem}`), 'error');
    save.mutate();
  };
  const option = (b: BankAccount) => ({ value: b.id, label: `${b.code} · ${b.name}${b.currency ? ` (${b.currency})` : ''}` });

  return (
    <Modal
      open
      onClose={onClose}
      title={t('banking.transferTitle')}
      description={t('banking.transferBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="transfer-form" loading={save.isPending} disabled={!!problem}>
            {t('banking.recordTransfer')}
          </Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('banking.fields.from')} value={fromId} onChange={(e) => setFrom(e.target.value)} options={usable.map(option)} />
        <SelectField label={t('banking.fields.to')} value={toId} onChange={(e) => setTo(e.target.value)} options={usable.filter((b) => b.id !== fromId).map(option)} />
        <TextField label={t('banking.fields.amountSent', { currency: fromCode })} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" data-autofocus />
        {crossCurrency ? <TextField label={t('banking.fields.amountReceived', { currency: toCode })} value={toAmount} onChange={(e) => setToAmount(e.target.value)} inputMode="decimal" dir="ltr" className="text-end font-mono" hint={t('banking.crossHint')} /> : <TextField label={t('banking.fields.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        {crossCurrency && <TextField label={t('banking.fields.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        <TextField label={t('banking.fields.reference')} value={reference} onChange={(e) => setReference(e.target.value)} dir="auto" />
        <div className="sm:col-span-2">
          <TextField label={t('banking.fields.description')} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('banking.transferPlaceholder')} dir="auto" />
        </div>
      </form>
    </Modal>
  );
}
