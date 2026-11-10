import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Eye, Link2Off, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '../i18n';
import { formatMoney, formatRelative } from '../lib/format';
import { whatsappLink } from '../lib/whatsapp';
import { useSession } from '../layout/session';
import { apiErrorMessage } from '../platform/errors';
import Button from '../ui/Button';
import { inputClass } from '../ui/Field';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import type { Quote, QuotesApi } from './types';

const quoteUrl = (token: string) => new URL(`q/${token}`, `${window.location.origin}${import.meta.env.BASE_URL}`).toString();

/** A quote's link for its customer, to see it and accept or decline: sent on WhatsApp or copied (a draft becomes sent) */
export default function ShareQuoteDialog({ api, quote, onClose }: { api: QuotesApi; quote: Quote; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useIntlLocale();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['quotes'] });
  const share = useMutation({ mutationFn: () => api.share(quote.id), onSuccess: refresh, onError: (e) => toast(apiErrorMessage(e, t), 'error') });
  const unshare = useMutation({
    mutationFn: () => api.unshare(quote.id),
    onSuccess: () => {
      refresh();
      toast(t('invoices.share.turnedOff'));
      onClose();
    },
    onError: (e) => toast(apiErrorMessage(e, t), 'error'),
  });
  const { mutate } = share;
  useEffect(() => mutate(), [mutate]);
  const s = share.data?.share;
  const link = s ? quoteUrl(s.token) : '';
  const message = t('quotes.share.message', { name: quote.contact.name, organization: session.organization, number: quote.number, amount: formatMoney(quote.total, quote.currency ?? 'INR', locale), link });
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
      title={t('quotes.share.title', { number: quote.number })}
      description={t('quotes.share.description')}
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
            <input readOnly value={link} aria-label={t('quotes.share.link')} onFocus={(e) => e.target.select()} dir="ltr" className={`${inputClass} border-ink-200 font-mono text-xs dark:border-ink-700`} />
            <Button variant="secondary" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy()}>
              {copied ? t('invoices.share.copied') : t('invoices.share.copy')}
            </Button>
          </div>
          <p className="whitespace-pre-line rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600 dark:bg-ink-800/60 dark:text-ink-300" data-testid="quote-message" dir="auto">
            {message}
          </p>
          <a href={whatsappLink(message)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1fa855] px-4 text-sm font-semibold text-white hover:bg-[#178a45]">
            <MessageCircle className="size-4" aria-hidden /> {t('invoices.share.whatsapp')}
          </a>
          <p className="flex items-center gap-1.5 text-sm text-ink-600 dark:text-ink-300">
            <Eye className="size-4" aria-hidden /> {s.views ? t('invoices.share.opened', { count: s.views, when: s.lastViewedAt ? formatRelative(s.lastViewedAt, locale) : '' }) : t('invoices.share.notOpened')}
          </p>
        </div>
      )}
    </Modal>
  );
}
