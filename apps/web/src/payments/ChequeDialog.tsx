import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '../platform/errors';
import { saveBlob } from '../lib/saveBlob';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { Payment, PaymentsApi } from './types';

const KEY = 'ledgernest.cheque.alignment';
type Alignment = { offsetX: number; offsetY: number; crossed: boolean };
const DEFAULT: Alignment = { offsetX: 0, offsetY: 0, crossed: true };

/** How this printer lines up with the leaf, remembered on this device */
function remembered(): Alignment {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Alignment> | null) };
  } catch {
    return DEFAULT;
  }
}

/** A vendor payment printed onto a cheque leaf (CTS-2010), with the print nudged to suit the printer */
export default function ChequeDialog({ payment, api, onClose }: { payment: Payment; api: PaymentsApi; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [start] = useState(remembered);
  const [x, setX] = useState(String(start.offsetX));
  const [y, setY] = useState(String(start.offsetY));
  const [crossed, setCrossed] = useState(start.crossed);
  const mm = (v: string) => (v.trim() === '' || v.trim() === '-' ? 0 : Number(v));
  const bad = (v: string) => Number.isNaN(mm(v)) || Math.abs(mm(v)) > 30;
  const make = useMutation({
    mutationFn: () => api.cheque(payment.id, { offsetX: mm(x), offsetY: mm(y), crossed }),
    onSuccess: (f) => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ offsetX: mm(x), offsetY: mm(y), crossed }));
      } catch {
        /* not remembered */
      }
      saveBlob(f);
      onClose();
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!bad(x) && !bad(y)) make.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('payments.cheque.title', { number: payment.number })}
      description={t('payments.cheque.body', { name: payment.contact.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="cheque-form" loading={make.isPending} disabled={bad(x) || bad(y)}>
            {t('payments.cheque.download')}
          </Button>
        </>
      }
    >
      <form id="cheque-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('payments.cheque.right')} value={x} onChange={(e) => setX(e.target.value)} inputMode="decimal" dir="ltr" error={bad(x) ? t('payments.cheque.range') : undefined} />
        <TextField label={t('payments.cheque.down')} value={y} onChange={(e) => setY(e.target.value)} inputMode="decimal" dir="ltr" error={bad(y) ? t('payments.cheque.range') : undefined} />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={crossed} onChange={(e) => setCrossed(e.target.checked)} className="size-4 rounded accent-brand-600" />
          {t('payments.cheque.crossed')}
        </label>
        <p className="text-xs text-ink-500 sm:col-span-2">{t('payments.cheque.tip')}</p>
      </form>
    </Modal>
  );
}
