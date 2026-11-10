import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Eye, Link2Off, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatDate, formatMoney, formatRelative } from '../lib/format';
import { whatsappLink } from '../lib/whatsapp';
import { useSession } from '../layout/session';
import Button from '../ui/Button';
import { inputClass } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { invoiceErrorMessage } from './errors';
import type { Invoice, InvoicesApi } from './types';

/** Where a shared link opens: this web app's own address, so it works wherever the app is hosted */
const shareUrl = (token: string) => new URL(`i/${token}`, `${window.location.origin}${import.meta.env.BASE_URL}`).toString();

/**
 * Share an invoice by link: made on opening, then copied or sent on WhatsApp with a message ready to go (to the
 * customer's mobile when one is on file). Shows whether the customer has opened it, and turns the link off.
 */
export default function ShareInvoiceDialog({ api, invoice, onClose }: { api: InvoicesApi; invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['invoices', session.organizationId, 'one', invoice.id] });
  const share = useMutation({ mutationFn: () => api.share(invoice.id), onSuccess: refresh, onError: (e) => toast(invoiceErrorMessage(e, t), 'error') });
  const unshare = useMutation({
    mutationFn: () => api.unshare(invoice.id),
    onSuccess: () => {
      refresh();
      toast(t('invoices.share.turnedOff'));
      onClose();
    },
    onError: (e) => toast(invoiceErrorMessage(e, t), 'error'),
  });
  const { mutate } = share;
  useEffect(() => mutate(), [mutate]);
  const link = share.data ? shareUrl(share.data.token) : '';
  const s = share.data;
  const money = (minor: number) => formatMoney(minor, invoice.currency ?? 'INR', locale);
  const message = t(invoice.balance > 0 ? 'invoices.share.message' : 'invoices.share.messagePaid', { name: invoice.contact.name, number: invoice.number, organization: session.organization, amount: money(invoice.balance > 0 ? invoice.balance : invoice.total), date: formatDate(`${invoice.dueDate}T00:00:00Z`, locale), link });
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
      title={t('invoices.share.title', { number: invoice.number })}
      description={t('invoices.share.description')}
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
      {share.isPending || !s ? (
        <p className="text-sm text-ink-500">{share.isError ? t('invoices.share.failed') : t('invoices.share.making')}</p>
      ) : (
        <div className="grid gap-4">
          <div className="flex gap-2">
            <input readOnly value={link} aria-label={t('invoices.share.link')} onFocus={(e) => e.target.select()} dir="ltr" className={`${inputClass} border-ink-200 font-mono text-xs dark:border-ink-700`} />
            <Button variant="secondary" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy()}>
              {copied ? t('invoices.share.copied') : t('invoices.share.copy')}
            </Button>
          </div>
          <a href={whatsappLink(message, invoice.contact.phone)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1fa855] px-4 text-sm font-semibold text-white hover:bg-[#178a45]">
            <MessageCircle className="size-4" aria-hidden /> {t('invoices.share.whatsapp')}
          </a>
          <p className="text-xs text-ink-500">{t('invoices.share.whatsappHint')}</p>
          <p className="flex items-center gap-1.5 text-sm text-ink-600 dark:text-ink-300">
            <Eye className="size-4" aria-hidden /> {s.views ? t('invoices.share.opened', { count: s.views, when: formatRelative(s.lastViewedAt!, locale) }) : t('invoices.share.notOpened')}
          </p>
        </div>
      )}
    </Modal>
  );
}
