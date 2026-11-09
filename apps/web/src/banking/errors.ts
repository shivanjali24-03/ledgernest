import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { invoiceErrorMessage } from '../invoices/errors';

const REASONS = ['use_documents', 'same_account', 'tax_foreign', 'account_currency', 'to_amount_required', 'to_amount_differs', 'tax_group_invalid', 'account_archived', 'no_fx_account', 'layout_unknown', 'nothing_to_import', 'has_reconciled'];

/** A translated explanation for a banking refusal; shared ones (a closed month, a missing rate) read as elsewhere. */
export function bankingErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`banking.errors.${reason}`) : invoiceErrorMessage(e, t);
}
