import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { apiErrorMessage } from '../platform/errors';

const REASONS = ['name_taken', 'currency_not_enabled', 'already_archived', 'not_archived'];

/** A translated explanation for a contact refusal. */
export function contactErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  if (reason === 'invalid' && e instanceof ApiError && e.message) return e.message;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`contacts.errors.${reason}`) : apiErrorMessage(e, t);
}
