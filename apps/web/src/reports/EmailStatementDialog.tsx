import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import type { AgingSide } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { useSession } from '../layout/session';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { Field, inputClass, TextField } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { ReportsApi } from './types';

/** Emails the statement as a PDF to the contact (their address on file, or another), with an optional note */
export default function EmailStatementDialog({ api, contact, side, from, to, onClose }: { api: ReportsApi; contact: { id: string; name: string; email: string | null }; side: AgingSide; from: string; to: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const [email, setEmail] = useState(contact.email ?? '');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);
  const bad = !z.email().safeParse(email.trim()).success;
  const send = useMutation({
    mutationFn: () => api.emailStatement({ contactId: contact.id, side, from, to, email: email.trim(), message: message.trim() || undefined }),
    onSuccess: (r) => {
      toast(t(session.mode === 'demo' ? 'reports.statement.sentDemo' : 'reports.statement.sent', { email: r.sentTo }));
      onClose();
    },
    onError: (e) => toast(e instanceof ApiError && e.details?.reason === 'mail_off' ? t('reports.statement.mailOff') : apiErrorMessage(e, t), 'error'),
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
      title={t('reports.statement.emailTitle', { name: contact.name })}
      description={t('reports.statement.emailBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="statement-email-form" loading={send.isPending}>
            {t('reports.statement.send')}
          </Button>
        </>
      }
    >
      <form id="statement-email-form" onSubmit={submit} noValidate className="grid gap-3">
        <TextField label={t('reports.statement.emailTo')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={tried && bad ? t('reports.statement.badEmail') : undefined} dir="ltr" data-autofocus />
        <Field label={t('reports.statement.note')} hint={t('reports.statement.noteHint')}>
          {({ id, describedBy }) => <textarea id={id} aria-describedby={describedBy} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} dir="auto" className={`${inputClass} h-auto border-ink-200 py-2 dark:border-ink-700`} />}
        </Field>
      </form>
    </Modal>
  );
}
