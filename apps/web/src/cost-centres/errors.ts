import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';

const REASONS = ['code_taken', 'in_use', 'cost_centre_not_found', 'cost_centre_archived'];

/** A translated explanation for a cost centre refusal. */
export function costCentreErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  if (typeof reason === 'string' && REASONS.includes(reason)) return t(`costCentres.errors.${reason}`);
  if (e instanceof ApiError && e.status === 403) return t('costCentres.errors.forbidden');
  return t('costCentres.errors.generic');
}
