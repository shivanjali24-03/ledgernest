import { useTranslation } from 'react-i18next';
import { formatMoney } from '../lib/format';
import { useMoney } from '../lib/useMoney';
import EmailDialog from '../ui/EmailDialog';
import { invoiceErrorMessage } from './errors';
import type { Invoice, InvoicesApi } from './types';

/** Emails the customer a payment reminder for what's still owed on an invoice, with an optional note */
export default function ReminderDialog({ api, invoice, onClose, onSent }: { api: InvoicesApi; invoice: Invoice; onClose: () => void; onSent: (r: { lastRemindedAt: string; reminders: number }) => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  return (
    <EmailDialog<{ sentTo: string; lastRemindedAt: string; reminders: number }>
      title={t('invoices.reminder.title', { number: invoice.number })}
      description={t('invoices.reminder.body', { amount: formatMoney(invoice.balance, invoice.currency ?? money.currency, money.locale) })}
      defaultEmail={invoice.contact.email}
      sendLabel={t('invoices.reminder.send')}
      send={(input) => api.remind(invoice.id, input)}
      onSent={onSent}
      sentMessage={(email) => t('invoices.reminder.sent', { email })}
      demoMessage={(email) => t('invoices.reminder.sentDemo', { email })}
      errorMessage={(e) => invoiceErrorMessage(e, t)}
      onClose={onClose}
    />
  );
}
