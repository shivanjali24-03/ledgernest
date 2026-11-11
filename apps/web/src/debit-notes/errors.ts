import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { billErrorMessage } from '../bills/errors';

const REASONS = ['over_credited', 'line_not_found', 'before_bill', 'vendor_credit_void', 'over_applied', 'has_refunds', 'before_vendor_credit', 'stock_line', 'bill_currency', 'bill_not_open', 'bill_reverse_charge', 'serial_not_bought', 'insufficient_stock', 'insufficient_batch', 'serials_count', 'bank_currency', 'no_rate'];

/** A translated explanation for a debit note refusal; the ones it shares with bills and payments read the same. */
export function debitNoteErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`debitNotes.errors.${reason}`) : billErrorMessage(e, t);
}
