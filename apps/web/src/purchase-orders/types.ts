import type { GoodsReceiptInput, PoStatus, PurchaseOrderDraftInput } from '@ledgernest/shared';

export interface PurchaseOrderLine {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  received: string;
  billed: string;
  /** Still to come, and come but not billed */
  toReceive: string;
  toBill: string;
  unitPrice: number;
  discount: number;
  amount: number;
  taxAmount: number;
  item: { id: string; name: string; unit: string | null; trackStock?: boolean; trackBatches?: boolean; trackSerials?: boolean } | null;
  /** Goods in stock received and not yet cleared by a recorded bill */
  grni?: { quantity: string; value: number };
  account: { id: string; code: string; name: string } | null;
  taxGroup: { id: string; name: string } | null;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  status: PoStatus;
  orderDate: string;
  expectedDate: string | null;
  currency: string | null;
  placeOfSupply: string | null;
  reference: string | null;
  notes: string | null;
  contact: { id: string; name: string; email: string | null };
  subtotal: number;
  taxTotal: number;
  total: number;
  lines: PurchaseOrderLine[];
  /** Goods receipt notes */
  receipts: { id: string; number: string; date: string; reference: string | null; notes: string | null; lines: { lineId: string; quantity: string; value?: number; batchNo?: string | null; serials?: string[] }[] }[];
  /** Goods received and not yet billed, in all: owed on "goods received, not yet billed" */
  grniValue?: number;
  /** Bills made from it */
  bills: { id: string; number: string | null; status: string; total: number }[];
}
export type PurchaseOrderSummary = Omit<PurchaseOrder, 'lines' | 'receipts'>;

/** Purchase orders. Live and demo both implement it. */
export interface PurchaseOrdersApi {
  list(q: { status?: PoStatus | 'open'; search?: string; page: number; pageSize: number }): Promise<{ total: number; page: number; pageSize: number; items: PurchaseOrderSummary[] }>;
  get(id: string): Promise<PurchaseOrder>;
  create(input: PurchaseOrderDraftInput): Promise<PurchaseOrder>;
  update(id: string, input: PurchaseOrderDraftInput): Promise<PurchaseOrder>;
  remove(id: string): Promise<void>;
  move(id: string, status: 'issued' | 'cancelled' | 'closed'): Promise<PurchaseOrder>;
  /** Records a goods receipt note */
  receive(id: string, input: GoodsReceiptInput): Promise<PurchaseOrder>;
  /** A draft bill for what came and isn't billed */
  bill(id: string): Promise<{ purchaseOrder: PurchaseOrder; billId: string }>;
}
