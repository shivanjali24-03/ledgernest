import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { journalErrorMessage } from '../journals/errors';

const REASONS = ['not_customer', 'contact_archived', 'account_required', 'not_income', 'item_archived', 'no_receivable_account', 'receivable_currency', 'zero_total', 'not_draft', 'not_issued', 'has_payments', 'document_entry', 'no_rate', 'no_period', 'period_closed', 'over_allocated', 'bank_currency', 'bank_invalid', 'invoice_not_issued', 'invoice_currency', 'already_void', 'nothing_owed', 'no_email', 'mail_off', 'mail_failed', 'composition_no_tax'];

/** A translated explanation for an invoice refusal (journal ones, like a closed month, included). */
export function invoiceErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  if (reason === 'insufficient_stock' || reason === 'stock_used') return t(`inventory.errors.${reason}`, { onHand: e instanceof ApiError ? e.details?.onHand : undefined });
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`invoices.errors.${reason}`) : journalErrorMessage(e, t);
}
