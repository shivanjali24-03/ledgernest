import type { StockAdjustmentInput, StockMovementKind } from '@ledgernest/shared';

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
  onHand: string;
  valueOnHand: number;
}
export interface StockValuation {
  asOf: string;
  rows: { itemId: string; name: string; sku: string | null; unit: string | null; archived: boolean; account: { id: string; code: string; name: string } | null; quantity: string; averageCost: number | null; value: number }[];
  total: number;
  /** Each inventory account: the stock in it beside what the books say */
  accounts: { id: string; code: string; name: string; stock: number; ledger: number }[];
}

/** Stock: valuation, movements and adjustments. Live and demo both implement it. */
export interface InventoryApi {
  valuation(asOf?: string): Promise<StockValuation>;
  movements(itemId: string): Promise<{ movements: StockMovement[] }>;
  adjust(input: StockAdjustmentInput): Promise<StockMovement>;
  undoAdjustment(id: string): Promise<void>;
}
