import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { invoiceErrorMessage } from '../invoices/errors';

const REASONS = ['has_invoices', 'ended', 'not_customer', 'contact_archived'];

/** A translated explanation for a schedule refusal. */
export function recurringErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`recurring.errors.${reason}`) : invoiceErrorMessage(e, t);
}
