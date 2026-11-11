import { ApiError } from '../auth/client';
import { apiErrorMessage } from '../platform/errors';

/** A translated explanation for an item refusal. */
const STOCK = ['not_goods', 'inventory_account_required', 'cogs_account_required', 'inventory_account_type', 'cogs_account_type', 'stock_moved', 'in_use'];
const REASONS = ['name_taken', 'sku_taken', 'barcode_taken', 'above_mrp', 'income_account_type', 'expense_account_type', 'tax_group_archived', 'account_archived'];
export const itemErrorMessage = (e: unknown, t: (k: string) => string) => {
  const reason = e instanceof ApiError ? e.details?.reason : undefined;
  if (typeof reason === 'string' && STOCK.includes(reason)) return t(`inventory.errors.${reason}`);
  if (reason === 'batches_need_stock') return t('batches.errors.batches_need_stock');
  if (reason === 'serials_need_stock' || reason === 'batches_or_serials') return t(`serials.errors.${reason}`);
  return typeof reason === 'string' && REASONS.includes(reason) ? t(`items.errors.${reason}`) : apiErrorMessage(e, t as never);
};

