-- DropIndex
DROP INDEX "quotes_organization_id_number_key";

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'quote';

-- CreateIndex
CREATE UNIQUE INDEX "quotes_organization_id_kind_number_key" ON "quotes"("organization_id", "kind", "number");

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_kind" CHECK ("kind" IN ('quote', 'proforma', 'sales_order'));
