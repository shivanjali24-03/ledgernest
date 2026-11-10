import { useTranslation } from 'react-i18next';
import EmailDialog from '../ui/EmailDialog';
import type { Quote, QuotesApi } from './types';

/** Emails a quote as a PDF to the customer (their address on file, or another), with an optional note */
export default function EmailQuoteDialog({ api, quote, onClose, onSent, errorMessage }: { api: QuotesApi; quote: Quote; onClose: () => void; onSent: (q: Quote) => void; errorMessage: (e: unknown) => string }) {
  const { t } = useTranslation();
  return (
    <EmailDialog
      title={t('quotes.email.title', { number: quote.number })}
      description={t(quote.status === 'draft' ? 'quotes.email.bodyDraft' : 'quotes.email.body')}
      defaultEmail={quote.contact.email}
      send={(input) => api.email(quote.id, input)}
      onSent={(r) => onSent(r.quote)}
      sentMessage={(email) => t('quotes.email.sent', { email })}
      demoMessage={(email) => t('quotes.email.sentDemo', { email })}
      errorMessage={errorMessage}
      onClose={onClose}
    />
  );
}
