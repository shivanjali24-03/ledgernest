import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { journalErrorMessage } from '../journals/errors';

const REASONS = ['not_customer', 'contact_archived', 'account_required', 'not_income', 'item_archived', 'no_receivable_account', 'receivable_currency', 'zero_total', 'not_draft', 'not_issued', 'has_payments', 'document_entry', 'no_rate', 'no_period', 'period_closed', 'over_allocated', 'bank_currency', 'bank_invalid', 'invoice_not_issued', 'invoice_currency', 'already_void', 'nothing_owed', 'no_email', 'mail_off', 'mail_failed', 'composition_no_tax', 'nothing_to_charge', 'waive_too_much', 'already_charged', 'no_interest_terms', 'instalments_total', 'instalments_before_issue', 'no_lut'];

/** Refusals about batches of goods (shared with bills and stock counts) */
export const BATCH_REASONS = ['batch_required', 'batch_dates_differ', 'batch_expired', 'insufficient_batch', 'insufficient_unexpired', 'batch_invalid', 'batches_need_stock'];
/** Refusals about serial numbers */
export const SERIAL_REASONS = ['serials_not_whole', 'serials_count', 'serials_duplicate', 'serial_in_stock', 'serial_not_in_stock', 'serial_not_sold', 'serials_need_stock', 'batches_or_serials'];

/** A translated explanation for an invoice refusal (journal ones, like a closed month, included). */
export function invoiceErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  if (reason === 'insufficient_stock' || reason === 'stock_used') return t(`inventory.errors.${reason}`, { onHand: e instanceof ApiError ? e.details?.onHand : undefined });
  if (typeof reason === 'string' && SERIAL_REASONS.includes(reason)) return t(`serials.errors.${reason}`, { serial: e instanceof ApiError ? e.details?.serial : undefined });
  if (typeof reason === 'string' && BATCH_REASONS.includes(reason)) return t(`batches.errors.${reason}`, { onHand: e instanceof ApiError ? e.details?.onHand : undefined, batch: e instanceof ApiError ? e.details?.batchNo : undefined });
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`invoices.errors.${reason}`) : journalErrorMessage(e, t);
}
