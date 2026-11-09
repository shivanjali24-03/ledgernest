import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { invoiceErrorMessage } from '../invoices/errors';

const REASONS = ['over_credited', 'line_not_found', 'before_invoice', 'credit_note_void', 'over_applied', 'has_refunds', 'before_credit_note'];

/** A translated explanation for a credit note refusal; the ones it shares with invoices and payments read the same. */
export function creditNoteErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`creditNotes.errors.${reason}`) : invoiceErrorMessage(e, t);
}
