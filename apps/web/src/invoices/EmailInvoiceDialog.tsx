import { useTranslation } from 'react-i18next';
import EmailDialog from '../ui/EmailDialog';
import { invoiceErrorMessage } from './errors';
import type { Invoice, InvoicesApi } from './types';

/** Emails an issued invoice as a PDF to the customer (their address on file, or another), with an optional note */
export default function EmailInvoiceDialog({ api, invoice, onClose }: { api: InvoicesApi; invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <EmailDialog
      title={t('invoices.email.title', { number: invoice.number })}
      description={t('invoices.email.body')}
      defaultEmail={invoice.contact.email}
      send={(input) => api.email(invoice.id, input)}
      sentMessage={(email) => t('invoices.email.sent', { email })}
      demoMessage={(email) => t('invoices.email.sentDemo', { email })}
      errorMessage={(e) => invoiceErrorMessage(e, t)}
      onClose={onClose}
    />
  );
}
