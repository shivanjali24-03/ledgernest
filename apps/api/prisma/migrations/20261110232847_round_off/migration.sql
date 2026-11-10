-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "round_off" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "round_invoice_totals" BOOLEAN NOT NULL DEFAULT false;


-- Round-off differences get their own account, made the first time it's needed
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_system_key_check";
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_system_key_check" CHECK ("system_key" IS NULL OR "system_key" IN ('retained_earnings', 'opening_balance_equity', 'fx_realised', 'fx_unrealised', 'interest_income', 'round_off'));
