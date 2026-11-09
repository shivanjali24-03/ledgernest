import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useSession } from '../layout/session';
import Button from '../ui/Button';
import { Field, inputClass, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { Quote, QuotesApi } from './types';

/** Emails a quote as a PDF to the customer (their address on file, or another), with an optional note */
export default function EmailQuoteDialog({ api, quote, onClose, onSent, errorMessage }: { api: QuotesApi; quote: Quote; onClose: () => void; onSent: (q: Quote) => void; errorMessage: (e: unknown) => string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const [email, setEmail] = useState(quote.contact.email ?? '');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);
  const bad = !z.email().safeParse(email.trim()).success;
  const send = useMutation({
    mutationFn: () => api.email(quote.id, { email: email.trim(), message: message.trim() || undefined }),
    onSuccess: (r) => {
      toast(t(session.mode === 'demo' ? 'quotes.email.sentDemo' : 'quotes.email.sent', { email: r.sentTo }));
      onSent(r.quote);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
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
      title={t('quotes.email.title', { number: quote.number })}
      description={t(quote.status === 'draft' ? 'quotes.email.bodyDraft' : 'quotes.email.body')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="quote-email-form" loading={send.isPending}>
            {t('quotes.email.send')}
          </Button>
        </>
      }
    >
      <form id="quote-email-form" onSubmit={submit} noValidate className="grid gap-3">
        <TextField label={t('quotes.email.to')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={tried && bad ? t('quotes.email.badEmail') : undefined} dir="ltr" data-autofocus />
        <Field label={t('quotes.email.note')} hint={t('quotes.email.noteHint')}>
          {({ id, describedBy }) => <textarea id={id} aria-describedby={describedBy} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} dir="auto" className={`${inputClass} h-auto border-ink-200 py-2 dark:border-ink-700`} />}
        </Field>
      </form>
    </Modal>
  );
}
