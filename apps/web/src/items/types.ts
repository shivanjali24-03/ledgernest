import type { ItemCreateInput, ItemKind, ItemUpdateInput } from '@ledgernest/shared';

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
  sku: string | null;
  description: string | null;
  unit: string | null;
  /** In the base currency's smallest unit */
  salePrice: number | null;
  purchasePrice: number | null;
  taxGroupId: string | null;
  taxGroup: { id: string; name: string; total: string } | null;
  hsnSac: string | null;
  incomeAccountId: string | null;
  expenseAccountId: string | null;
  incomeAccount: { id: string; code: string; name: string } | null;
  expenseAccount: { id: string; code: string; name: string } | null;
  /** Goods whose quantity on hand is kept, at average cost */
  trackStock: boolean;
  /** Tracked goods kept in batches with manufacturing and expiry dates */
  trackBatches?: boolean;
  inventoryAccountId: string | null;
  cogsAccountId: string | null;
  inventoryAccount: { id: string; code: string; name: string } | null;
  cogsAccount: { id: string; code: string; name: string } | null;
  /** For tracked goods: what's on hand, its value and average unit cost */
  stock: { onHand: string; value: number; averageCost: number | null; low: boolean } | null;
  /** Stock at or below this is low */
  reorderLevel: string | null;
  /** Maximum retail price, tax included (Legal Metrology) */
  mrp?: number | null;
  barcode?: string | null;
  brand?: string | null;
  category?: string | null;
  archived: boolean;
}

export interface ItemBatch {
  id: string;
  batchNo: string;
  mfgDate: string | null;
  expiryDate: string | null;
  onHand: string;
  expired: boolean;
}

/** Products and services. Live and demo both implement it. */
export interface ItemsApi {
  list(q: { search?: string; kind?: ItemKind; category?: string; archived?: boolean }): Promise<Item[]>;
  /** An item's batches, with what's on hand and whether each has expired */
  batches(itemId: string): Promise<ItemBatch[]>;
  /** The categories and brands in use, for suggestions */
  facets(): Promise<{ categories: string[]; brands: string[] }>;
  /** As CSV, in the columns the items import reads */
  exportList(q: { search?: string; kind?: ItemKind; archived?: boolean }): Promise<{ blob: Blob; filename: string }>;
  create(input: ItemCreateInput): Promise<Item>;
  update(id: string, input: ItemUpdateInput): Promise<Item>;
  archive(id: string, archive: boolean): Promise<Item>;
  remove(id: string): Promise<void>;
}
