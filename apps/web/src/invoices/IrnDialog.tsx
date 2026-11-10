import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { einvoiceIrnSchema, irnFromPortal } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import { Field, inputClass, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { invoiceErrorMessage } from './errors';
import type { Invoice, InvoicesApi } from './types';

/**
 * After uploading the e-invoice JSON, the portal gives the invoice an IRN, an acknowledgement and a signed QR code,
 * which must be printed on it. Paste the portal's response (or type the details) and they go on the PDF.
 */
export default function IrnDialog({ invoice, api, onClose }: { invoice: Invoice; api: InvoicesApi; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pasted, setPasted] = useState('');
  const [irn, setIrn] = useState(invoice.irn?.irn ?? '');
  const [ackNo, setAckNo] = useState(invoice.irn?.ackNo ?? '');
  const [ackDate, setAckDate] = useState(invoice.irn?.ackDate ?? '');
  const [qr, setQr] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The portal's response pasted in fills everything
  const paste = (text: string) => {
    setPasted(text);
    try {
      const found = irnFromPortal(JSON.parse(text));
      if (!found) return setError(t('invoices.irn.notFound'));
      setIrn(found.irn);
      setAckNo(found.ackNo);
      setAckDate(found.ackDate);
      setQr(found.signedQrCode);
      setError(null);
    } catch {
      if (text.trim()) setError(t('invoices.irn.notJson'));
    }
  };
  const save = useMutation({
    mutationFn: () => api.setIrn(invoice.id, { irn, ackNo, ackDate, signedQrCode: qr }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['invoice'] });
      toast(t('invoices.irn.saved'));
      onClose();
    },
    onError: (e) => toast(invoiceErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = einvoiceIrnSchema.safeParse({ irn, ackNo, ackDate, signedQrCode: qr });
    if (!r.success) return setError(t(`invoices.irn.invalid.${String(r.error.issues[0]?.path[0] ?? 'irn')}`));
    save.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('invoices.irn.title', { number: invoice.number })}
      description={t('invoices.irn.body')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="irn-form" loading={save.isPending}>
            {t('invoices.irn.save')}
          </Button>
        </>
      }
    >
      <form id="irn-form" onSubmit={submit} noValidate className="space-y-3">
        <Field label={t('invoices.irn.paste')} hint={t('invoices.irn.pasteHint')}>
          {({ id, describedBy }) => <textarea id={id} aria-describedby={describedBy} value={pasted} onChange={(e) => paste(e.target.value)} rows={3} dir="ltr" className={`${inputClass} h-auto border-ink-200 py-2 font-mono text-xs dark:border-ink-700`} />}
        </Field>
        <TextField label={t('invoices.irn.irn')} value={irn} onChange={(e) => setIrn(e.target.value)} dir="ltr" className="font-mono text-xs" />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('invoices.irn.ackNo')} value={ackNo} onChange={(e) => setAckNo(e.target.value)} dir="ltr" inputMode="numeric" />
          <TextField label={t('invoices.irn.ackDate')} value={ackDate} onChange={(e) => setAckDate(e.target.value)} dir="ltr" placeholder="2026-10-06 11:05:00" />
        </div>
        <TextField label={t('invoices.irn.qr')} value={qr} onChange={(e) => setQr(e.target.value)} dir="ltr" className="font-mono text-xs" />
        {error && (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
