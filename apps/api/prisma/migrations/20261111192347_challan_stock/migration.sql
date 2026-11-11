-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "back_at" DATE,
ADD COLUMN     "back_entry_id" UUID,
ADD COLUMN     "back_reason" TEXT,
ADD COLUMN     "dispatch_entry_id" UUID,
ADD COLUMN     "dispatched_at" DATE;


-- A delivery challan's goods come back one way
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_back_reason_check" CHECK ("back_reason" IS NULL OR "back_reason" IN ('invoiced', 'returned'));

-- Goods sent out on delivery challans: a system account
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_system_key_check";
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_system_key_check" CHECK ("system_key" IS NULL OR "system_key" IN ('retained_earnings', 'opening_balance_equity', 'fx_realised', 'fx_unrealised', 'interest_income', 'round_off', 'rcm_payable', 'goods_on_challan'));
