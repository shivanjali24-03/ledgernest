-- AlterTable
ALTER TABLE "items" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "brand" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "mrp" BIGINT;

-- CreateIndex
CREATE INDEX "items_organization_id_category_idx" ON "items"("organization_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "items_organization_id_barcode_key" ON "items"("organization_id", "barcode");

