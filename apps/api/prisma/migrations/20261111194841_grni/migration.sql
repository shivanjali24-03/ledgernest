-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "grni_cleared" JSONB;

-- AlterTable
ALTER TABLE "goods_receipt_lines" ADD COLUMN     "batch_no" TEXT,
ADD COLUMN     "expiry_date" DATE,
ADD COLUMN     "mfg_date" DATE,
ADD COLUMN     "serials" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "value" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "journal_entry_id" UUID;

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "grni_quantity" DECIMAL(13,4) NOT NULL DEFAULT 0,
ADD COLUMN     "grni_value" BIGINT NOT NULL DEFAULT 0;


ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_grni_check" CHECK ("grni_quantity" >= 0 AND "grni_value" >= 0);

-- Goods received, not yet billed: a system account
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_system_key_check";
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_system_key_check" CHECK ("system_key" IS NULL OR "system_key" IN ('retained_earnings', 'opening_balance_equity', 'fx_realised', 'fx_unrealised', 'interest_income', 'round_off', 'rcm_payable', 'goods_on_challan', 'grni'));
