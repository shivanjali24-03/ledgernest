import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '../ui/Field';
import { useIfscLookup } from './ifscLookup';

import type { BankForm } from './form';

/**
 * Account name, number and IFSC; the bank and branch fill themselves from the IFSC (Razorpay's directory), and can
 * be typed when it's unknown or out of reach.
 */
export default function BankDetailsFields({ value, onChange, errors = {}, disabled }: { value: BankForm; onChange: (v: BankForm) => void; errors?: Record<string, string | undefined>; disabled?: boolean }) {
  const { t } = useTranslation();
  const look = useIfscLookup(value.ifsc, !disabled);
  const found = look.data;
  useEffect(() => {
    if (found && (value.bankName !== found.bank || value.branch !== found.branch)) onChange({ ...value, bankName: found.bank, branch: found.branch });
    // When the lookup answers (and only if it differs, so it settles)
  }, [found, value, onChange]);
  const set = (k: keyof BankForm) => (e: { target: { value: string } }) => onChange({ ...value, [k]: k === 'ifsc' ? e.target.value.toUpperCase() : e.target.value });
  return (
    <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-2" aria-label={t('bank.title')}>
      <TextField label={t('bank.accountName')} value={value.accountName} onChange={set('accountName')} error={errors.accountName} disabled={disabled} dir="auto" />
      <TextField label={t('bank.accountNumber')} value={value.accountNumber} onChange={set('accountNumber')} error={errors.accountNumber} disabled={disabled} inputMode="numeric" dir="ltr" className="font-mono" />
      <TextField
        label={t('bank.ifsc')}
        value={value.ifsc}
        onChange={set('ifsc')}
        error={errors.ifsc}
        disabled={disabled}
        dir="ltr"
        className="font-mono uppercase"
        placeholder="HDFC0001234"
        hint={look.isFetching ? t('bank.looking') : found ? [found.bank, found.branch, found.city].filter(Boolean).join(', ') : look.isError ? t('bank.unknownIfsc') : t('bank.ifscHint')}
      />
      <TextField label={t('bank.bankName')} value={value.bankName} onChange={set('bankName')} disabled={disabled} dir="auto" />
      <TextField label={t('bank.branch')} value={value.branch} onChange={set('branch')} disabled={disabled} dir="auto" />
    </fieldset>
  );
}
