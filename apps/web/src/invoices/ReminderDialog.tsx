import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useSession } from '../layout/session';
import { formatMoney } from '../lib/format';
import { useMoney } from '../lib/useMoney';
import Button from '../ui/Button';
import { Field, inputClass, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { invoiceErrorMessage } from './errors';
import type { Invoice, InvoicesApi } from './types';

/** Emails the customer a payment reminder for what's still owed on an invoice, with an optional note */
export default function ReminderDialog({ api, invoice, onClose, onSent }: { api: InvoicesApi; invoice: Invoice; onClose: () => void; onSent: (r: { lastRemindedAt: string; reminders: number }) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const money = useMoney();
  const [email, setEmail] = useState(invoice.contact.email ?? '');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);
  const bad = !z.email().safeParse(email.trim()).success;
  const send = useMutation({
    mutationFn: () => api.remind(invoice.id, { email: email.trim(), message: message.trim() || undefined }),
    onSuccess: (r) => {
      toast(t(session.mode === 'demo' ? 'invoices.reminder.sentDemo' : 'invoices.reminder.sent', { email: r.sentTo }));
      onSent(r);
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
      title={t('invoices.reminder.title', { number: invoice.number })}
      description={t('invoices.reminder.body', { amount: formatMoney(invoice.balance, invoice.currency ?? money.currency, money.locale) })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="reminder-form" loading={send.isPending}>
            {t('invoices.reminder.send')}
          </Button>
        </>
      }
    >
      <form id="reminder-form" onSubmit={submit} noValidate className="grid gap-3">
        <TextField label={t('invoices.reminder.to')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={tried && bad ? t('invoices.reminder.badEmail') : undefined} dir="ltr" data-autofocus />
        <Field label={t('invoices.reminder.note')} hint={t('invoices.reminder.noteHint')}>
          {({ id, describedBy }) => <textarea id={id} aria-describedby={describedBy} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} dir="auto" className={`${inputClass} h-auto border-ink-200 py-2 dark:border-ink-700`} />}
        </Field>
      </form>
    </Modal>
  );
}
