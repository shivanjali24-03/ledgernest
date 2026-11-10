import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { invoiceErrorMessage } from '../invoices/errors';

const REASONS = ['not_vendor', 'not_expense', 'no_payable_account', 'payable_currency', 'not_open', 'bill_not_open', 'bill_currency', 'bill_not_found', 'bill_reverse_charge', 'no_self_invoice'];

/** A translated explanation for a bill refusal; the ones it shares with invoices read the same. */
export function billErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`bills.errors.${reason}`) : invoiceErrorMessage(e, t);
}
