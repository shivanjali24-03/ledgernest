import type { TFunction } from 'i18next';
import { ApiError } from '../auth/client';
import { journalErrorMessage } from '../journals/errors';

const REASONS = ['insufficient_stock', 'stock_used', 'not_tracked', 'account_invalid', 'unit_cost_required', 'already_undone', 'stock_moved', 'not_goods', 'inventory_account_required', 'cogs_account_required', 'inventory_account_type', 'cogs_account_type'];

/** A translated explanation for a stock refusal; journal ones (a closed month) read as elsewhere. */
export function inventoryErrorMessage(e: unknown, t: TFunction): string {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  const onHand = e instanceof ApiError ? e.details?.onHand : undefined;
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`inventory.errors.${reason}`, { onHand }) : journalErrorMessage(e, t);
}
