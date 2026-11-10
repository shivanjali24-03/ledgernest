-- AlterTable
ALTER TABLE "bill_lines" ADD COLUMN     "rcm_tax_group_id" UUID;

-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "reverse_charge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "self_invoice_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bills_organization_id_self_invoice_number_key" ON "bills"("organization_id", "self_invoice_number");

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_organization_id_rcm_tax_group_id_fkey" FOREIGN KEY ("organization_id", "rcm_tax_group_id") REFERENCES "tax_groups"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- GST payable under reverse charge gets its own account, made the first time it's needed
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_system_key_check";
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_system_key_check" CHECK ("system_key" IS NULL OR "system_key" IN ('retained_earnings', 'opening_balance_equity', 'fx_realised', 'fx_unrealised', 'interest_income', 'round_off', 'rcm_payable'));
