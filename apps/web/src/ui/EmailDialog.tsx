import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useSession } from '../layout/session';
import Button from './Button';
import { Field, inputClass, TextField } from './Field';
import Modal from './Modal';
import { useToast } from './toastContext';

/**
 * Sends something by email: an address (filled with the contact's) and an optional note. The caller says what's sent
 * and how; the demo's toast says nothing really went.
 */
export default function EmailDialog<R extends { sentTo: string }>({ title, description, defaultEmail, blankHint, sendLabel, send, onSent, sentMessage, demoMessage, errorMessage, onClose }: { title: string; description: string; defaultEmail: string | null; /** When set, a blank address is allowed and means the one on file */ blankHint?: string; /** The button, when "Send" isn't enough */ sendLabel?: string; send: (input: { email?: string; message?: string }) => Promise<R>; /** After it went, before the dialog closes (e.g. to update what's shown) */ onSent?: (r: R) => void; sentMessage: (email: string) => string; demoMessage: (email: string) => string; errorMessage: (e: unknown) => string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);
  const bad = email.trim() ? !z.email().safeParse(email.trim()).success : !blankHint;
  const mutation = useMutation({
    mutationFn: () => send({ email: email.trim() || undefined, message: message.trim() || undefined }),
    onSuccess: (r) => {
      toast(session.mode === 'demo' ? demoMessage(r.sentTo) : sentMessage(r.sentTo));
      onSent?.(r);
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!bad) mutation.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="email-dialog-form" loading={mutation.isPending}>
            {sendLabel ?? t('emailDialog.send')}
          </Button>
        </>
      }
    >
      <form id="email-dialog-form" onSubmit={submit} noValidate className="grid gap-3">
        <TextField label={t('emailDialog.to')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={tried && bad ? t('emailDialog.badEmail') : undefined} hint={blankHint} dir="ltr" data-autofocus />
        <Field label={t('emailDialog.note')} hint={t('emailDialog.noteHint')}>
          {({ id, describedBy }) => <textarea id={id} aria-describedby={describedBy} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} dir="auto" className={`${inputClass} h-auto border-ink-200 py-2 dark:border-ink-700`} />}
        </Field>
      </form>
    </Modal>
  );
}
