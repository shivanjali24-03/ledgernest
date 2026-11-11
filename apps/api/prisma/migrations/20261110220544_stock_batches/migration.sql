-- AlterTable
ALTER TABLE "bill_lines" ADD COLUMN     "batch_no" TEXT,
ADD COLUMN     "expiry_date" DATE,
ADD COLUMN     "mfg_date" DATE;

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "batch_id" UUID;

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "track_batches" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "batch_id" UUID,
ADD COLUMN     "source_line_id" UUID;

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "batch_no" TEXT NOT NULL,
    "mfg_date" DATE,
    "expiry_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_batches_organization_id_expiry_date_idx" ON "stock_batches"("organization_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_organization_id_id_key" ON "stock_batches"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_organization_id_item_id_batch_no_key" ON "stock_batches"("organization_id", "item_id", "batch_no");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_batch_id_idx" ON "stock_movements"("organization_id", "batch_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_batch_id_fkey" FOREIGN KEY ("organization_id", "batch_id") REFERENCES "stock_batches"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_organization_id_item_id_fkey" FOREIGN KEY ("organization_id", "item_id") REFERENCES "items"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

