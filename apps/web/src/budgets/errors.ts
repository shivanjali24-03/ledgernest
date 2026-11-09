import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';

const REASONS = ['name_taken', 'year_not_found', 'budget_not_found', 'not_pnl_account'];

/** A translated explanation for a budget refusal. */
export function budgetErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  if (typeof reason === 'string' && REASONS.includes(reason)) return t(`budgets.errors.${reason}`);
  if (e instanceof ApiError && e.status === 403) return t('budgets.errors.forbidden');
  return t('budgets.errors.generic');
}
