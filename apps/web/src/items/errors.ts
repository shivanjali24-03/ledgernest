import { ApiError } from '../auth/client';
import { apiErrorMessage } from '../platform/errors';

/** A translated explanation for an item refusal. */
const REASONS = ['name_taken', 'sku_taken', 'income_account_type', 'expense_account_type', 'tax_group_archived', 'account_archived'];
export const itemErrorMessage = (e: unknown, t: (k: string) => string) => {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`items.errors.${reason}`) : apiErrorMessage(e, t as never);
};

