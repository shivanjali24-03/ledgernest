import type { OpeningStockInput, StockAdjustmentInput, StockMovementKind, StockTransferInput, WarehouseInput, WarehouseUpdateInput } from '@ledgernest/shared';

export interface StockMovement {
  id: string;
  itemId: string;
  item: string;
  date: string;
  kind: StockMovementKind;
  /** The bill or invoice it came from */
  document: { id: string; number: string | null } | null;
  /** Signed: negative going out */
  quantity: string;
  value: number;
  reason: string | null;
  journalEntry: { id: string; number: string | null } | null;
  /** An adjustment that has since been undone */
  undone: boolean;
  /** Where (once the organisation keeps warehouses) */
  warehouse?: { id: string; name: string } | null;
  onHand: string;
  valueOnHand: number;
}
export interface StockValuation {
  asOf: string;
  rows: { itemId: string; name: string; sku: string | null; unit: string | null; archived: boolean; account: { id: string; code: string; name: string } | null; quantity: string; reorderLevel: string | null; low: boolean; averageCost: number | null; value: number }[];
  total: number;
  /** Each inventory account: the stock in it beside what the books say */
  accounts: { id: string; code: string; name: string; stock: number; ledger: number }[];
}

export interface SerialHistory {
  itemId: string;
  item: string;
  serialNo: string;
  status: 'in_stock' | 'sold' | 'written_off' | 'removed';
  movements: { id: string; date: string; kind: StockMovementKind; document: { id: string; number: string | null } | null; contact: string | null; reason: string | null }[];
}

/** Batches with stock that have expired or expire soon */
export interface ExpiringStock {
  asOf: string;
  days: number;
  rows: { itemId: string; item: string; unit: string | null; batchId: string; batchNo: string; mfgDate: string | null; expiryDate: string; daysLeft: number; expired: boolean; onHand: string; value: number }[];
  expired: { count: number; value: number };
  expiring: { count: number; value: number };
}

/** A place stock is kept, with how many items it holds and their value */
export interface Warehouse {
  id: string;
  name: string;
  code: string;
  address: Record<string, string | null> | null;
  isDefault: boolean;
  archived: boolean;
  items: number;
  value: number;
}
export interface StockTransfer {
  id: string;
  number: string;
  date: string;
  reference: string | null;
  notes: string | null;
  from: { id: string; name: string };
  to: { id: string; name: string };
  lines: { item: { id: string; name: string }; quantity: string; value: number }[];
  value: number;
}

/** Stock: valuation, movements and adjustments. Live and demo both implement it. */
export interface InventoryApi {
  warehouses(): Promise<{ warehouses: Warehouse[] }>;
  /** The first one brings a main warehouse that takes the stock there was */
  createWarehouse(input: WarehouseInput): Promise<Warehouse>;
  updateWarehouse(id: string, input: WarehouseUpdateInput): Promise<Warehouse>;
  archiveWarehouse(id: string): Promise<void>;
  warehouseStock(id: string): Promise<{ items: { itemId: string; name: string; unit: string | null; quantity: string; value: number }[] }>;
  transfers(): Promise<{ transfers: StockTransfer[] }>;
  transfer(input: StockTransferInput): Promise<StockTransfer>;
  valuation(asOf?: string): Promise<StockValuation>;
  movements(itemId: string): Promise<{ movements: StockMovement[] }>;
  /** A serial number's story: the item, where the unit is, and its movements */
  serial(serial: string): Promise<SerialHistory[]>;
  /** Batches that have expired or expire within some days */
  expiring(days: number): Promise<ExpiringStock>;
  adjust(input: StockAdjustmentInput): Promise<StockMovement>;
  /** Opening stock for many items at once, against Opening balance equity */
  openingStock(input: OpeningStockInput): Promise<{ movements: StockMovement[] }>;
  undoAdjustment(id: string): Promise<void>;
}
