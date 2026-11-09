import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useSession } from '../layout/session';
import Button from '../ui/Button';
import { Field, inputClass, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { invoiceErrorMessage } from './errors';
import type { Invoice, InvoicesApi } from './types';

/** Emails an issued invoice as a PDF to the customer (their address on file, or another), with an optional note */
export default function EmailInvoiceDialog({ api, invoice, onClose }: { api: InvoicesApi; invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const [email, setEmail] = useState(invoice.contact.email ?? '');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);
  const bad = !z.email().safeParse(email.trim()).success;
  const send = useMutation({
    mutationFn: () => api.email(invoice.id, { email: email.trim(), message: message.trim() || undefined }),
    onSuccess: (r) => {
      toast(t(session.mode === 'demo' ? 'invoices.email.sentDemo' : 'invoices.email.sent', { email: r.sentTo }));
      onClose();
    },
    onError: (e) => toast(invoiceErrorMessage(e, t), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!bad) send.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('invoices.email.title', { number: invoice.number })}
      description={t('invoices.email.body')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="invoice-email-form" loading={send.isPending}>
            {t('invoices.email.send')}
          </Button>
        </>
      }
    >
      <form id="invoice-email-form" onSubmit={submit} noValidate className="grid gap-3">
        <TextField label={t('invoices.email.to')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={tried && bad ? t('invoices.email.badEmail') : undefined} dir="ltr" data-autofocus />
        <Field label={t('invoices.email.note')} hint={t('invoices.email.noteHint')}>
          {({ id, describedBy }) => <textarea id={id} aria-describedby={describedBy} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} dir="auto" className={`${inputClass} h-auto border-ink-200 py-2 dark:border-ink-700`} />}
        </Field>
      </form>
    </Modal>
  );
}
