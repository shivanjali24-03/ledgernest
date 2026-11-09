import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { apiErrorMessage } from '../platform/errors';

const REASONS = ['exists', 'not_contiguous', 'already_closed', 'already_open', 'earlier_open', 'later_closed'];

/** A translated explanation for a financial-year refusal. */
export function periodErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`periods.errors.${reason}`) : apiErrorMessage(e, t);
}
