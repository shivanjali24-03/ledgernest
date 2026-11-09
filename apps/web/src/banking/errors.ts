import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { invoiceErrorMessage } from '../invoices/errors';

const REASONS = ['use_documents', 'same_account', 'tax_foreign', 'account_currency', 'to_amount_required', 'to_amount_differs', 'tax_group_invalid', 'account_archived', 'no_fx_account', 'layout_unknown', 'nothing_to_import', 'has_reconciled', 'amounts_differ', 'line_not_unmatched', 'line_not_matched', 'line_matched', 'reconciled', 'unmatched_lines', 'difference', 'before_last', 'not_latest', 'book_line_matched', 'book_line_not_found'];

/** A translated explanation for a banking refusal; shared ones (a closed month, a missing rate) read as elsewhere. */
export function bankingErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`banking.errors.${reason}`) : invoiceErrorMessage(e, t);
}
