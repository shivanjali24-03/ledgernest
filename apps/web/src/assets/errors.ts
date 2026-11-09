import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { journalErrorMessage } from '../journals/errors';

const REASONS = ['cost_account', 'accumulated_account', 'expense_account', 'tag_taken', 'disposed', 'has_depreciation', 'nothing_to_depreciate', 'not_latest', 'before_in_service', 'before_depreciated', 'gain_loss_account', 'bank_invalid'];

/** A translated explanation for a fixed asset refusal; journal ones (a closed month) read as elsewhere. */
export function assetErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`assets.errors.${reason}`) : journalErrorMessage(e, t);
}
