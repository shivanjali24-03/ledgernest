import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Eye, Link2Off, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatRelative } from '../lib/format';
import { useMoney } from '../lib/useMoney';
import { whatsappLink } from '../lib/whatsapp';
import { useSession } from '../layout/session';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { inputClass } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { Contact, ContactsApi } from './types';

const accountUrl = (token: string) => new URL(`c/${token}`, `${window.location.origin}${import.meta.env.BASE_URL}`).toString();

/** A customer's account link: everything they owe in one place, to pay by UPI, sent on WhatsApp or copied */
export default function ShareAccountDialog({ api, contact, onClose }: { api: ContactsApi; contact: Contact; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const money = useMoney();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['contacts'] });
  const share = useMutation({ mutationFn: () => api.share(contact.id), onSuccess: refresh, onError: (e) => toast(apiErrorMessage(e, t), 'error') });
  const unshare = useMutation({
    mutationFn: () => api.unshare(contact.id),
    onSuccess: () => {
      refresh();
      toast(t('invoices.share.turnedOff'));
      onClose();
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const { mutate } = share;
  useEffect(() => mutate(), [mutate]);
  const s = share.data;
  const link = s ? accountUrl(s.token) : '';
  const owed = (contact as Contact & { receivable?: number }).receivable ?? 0;
  const message = owed > 0 ? t('contacts.account.message', { name: contact.name, organization: session.organization, amount: money.format(owed), link }) : t('contacts.account.messageNothing', { name: contact.name, organization: session.organization, link });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(t('invoices.share.copyFailed'), 'error');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('contacts.account.title', { name: contact.name })}
      description={t('contacts.account.description')}
      footer={
        <>
          {s && (
            <Button variant="ghost" icon={<Link2Off className="size-4" />} loading={unshare.isPending} onClick={() => unshare.mutate()} className="me-auto text-expense">
              {t('invoices.share.turnOff')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      {!s ? (
        <p className="text-sm text-ink-500">{share.isError ? t('invoices.share.failed') : t('invoices.share.making')}</p>
      ) : (
        <div className="grid gap-4">
          <div className="flex gap-2">
            <input readOnly value={link} aria-label={t('contacts.account.link')} onFocus={(e) => e.target.select()} dir="ltr" className={`${inputClass} border-ink-200 font-mono text-xs dark:border-ink-700`} />
            <Button variant="secondary" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy()}>
              {copied ? t('invoices.share.copied') : t('invoices.share.copy')}
            </Button>
          </div>
          <p className="whitespace-pre-line rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600 dark:bg-ink-800/60 dark:text-ink-300" data-testid="account-message" dir="auto">
            {message}
          </p>
          <a href={whatsappLink(message, contact.phone)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1fa855] px-4 text-sm font-semibold text-white hover:bg-[#178a45]">
            <MessageCircle className="size-4" aria-hidden /> {t('invoices.share.whatsapp')}
          </a>
          <p className="flex items-center gap-1.5 text-sm text-ink-600 dark:text-ink-300">
            <Eye className="size-4" aria-hidden /> {s.views ? t('invoices.share.opened', { count: s.views, when: formatRelative(s.lastViewedAt!, locale) }) : t('invoices.share.notOpened')}
          </p>
        </div>
      )}
    </Modal>
  );
}
