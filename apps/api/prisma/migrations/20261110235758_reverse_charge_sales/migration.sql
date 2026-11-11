-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "rcm_tax_group_id" UUID;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "reverse_charge" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_rcm_tax_group_id_fkey" FOREIGN KEY ("organization_id", "rcm_tax_group_id") REFERENCES "tax_groups"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

