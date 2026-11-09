import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { apiErrorMessage } from '../platform/errors';

const REASONS = [
  'name_taken',
  'output_not_liability',
  'input_not_asset',
  'same_account',
  'account_archived',
  'account_not_found',
  'in_active_group',
  'rate_archived',
  'rate_not_found',
  'not_india',
  'no_slabs',
  'code_taken',
  'overlap',
  'in_use',
  'slab_not_found',
];

/** A translated explanation for a tax refusal. */
export function taxErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`taxes.errors.${reason}`) : apiErrorMessage(e, t);
}

/** Which form field a refusal is about, if any. */
export function taxErrorField(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const field = e.details?.field;
  if (typeof field === 'string') return field;
  return e.details?.reason === 'name_taken' ? 'name' : null;
}
