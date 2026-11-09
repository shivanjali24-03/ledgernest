import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { apiErrorMessage } from '../platform/errors';

const REASONS = ['is_base', 'already_enabled', 'in_use', 'no_currencies', 'source_unavailable', 'currency_not_enabled', 'currency_type'];

/** A translated explanation for a currency refusal. */
export function currencyErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`currencies.errors.${reason}`) : apiErrorMessage(e, t);
}
