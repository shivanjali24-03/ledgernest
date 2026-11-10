import type { AgingSide } from '@ledgernest/shared';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../auth/client';
import { apiErrorMessage } from '../platform/errors';
import EmailDialog from '../ui/EmailDialog';
import type { ReportsApi } from './types';

/** Emails the statement as a PDF to the contact (their address on file, or another), with an optional note */
export default function EmailStatementDialog({ api, contact, side, from, to, onClose }: { api: ReportsApi; contact: { id: string; name: string; email: string | null }; side: AgingSide; from: string; to: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <EmailDialog
      title={t('reports.statement.emailTitle', { name: contact.name })}
      description={t('reports.statement.emailBody')}
      defaultEmail={contact.email}
      send={(input) => api.emailStatement({ contactId: contact.id, side, from, to, ...input })}
      sentMessage={(email) => t('reports.statement.sent', { email })}
      demoMessage={(email) => t('reports.statement.sentDemo', { email })}
      errorMessage={(e) => (e instanceof ApiError && e.details?.reason === 'mail_off' ? t('reports.statement.mailOff') : apiErrorMessage(e, t))}
      onClose={onClose}
    />
  );
}
