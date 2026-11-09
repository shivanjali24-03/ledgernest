import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { apiErrorMessage } from '../platform/errors';

const REASONS = ['unbalanced', 'too_few_lines', 'zero', 'period_closed', 'no_period', 'account_archived', 'account_not_found', 'posted', 'not_posted', 'already_reversed', 'is_reversal', 'type_mismatch', 'too_large', 'tax_group_archived', 'tax_group_not_found', 'tax_too_small', 'closing_entry', 'currency_required', 'currency_mismatch', 'no_rate', 'amount_too_small', 'bank_matched'];

/** A translated explanation for a journal refusal. */
export function journalErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`journals.errors.${reason}`) : apiErrorMessage(e, t);
}
