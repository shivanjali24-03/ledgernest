-- AlterTable
ALTER TABLE "bill_lines" ADD COLUMN     "serials" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "credit_note_lines" ADD COLUMN     "serials" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "serials" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "track_serials" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "serials" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "stock_serials" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "serial_no" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_serials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_serials_organization_id_serial_no_idx" ON "stock_serials"("organization_id", "serial_no");

-- CreateIndex
CREATE UNIQUE INDEX "stock_serials_organization_id_id_key" ON "stock_serials"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_serials_organization_id_item_id_serial_no_key" ON "stock_serials"("organization_id", "item_id", "serial_no");

-- CreateIndex
CREATE INDEX "stock_movements_serials_idx" ON "stock_movements" USING GIN ("serials");

-- AddForeignKey
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_organization_id_item_id_fkey" FOREIGN KEY ("organization_id", "item_id") REFERENCES "items"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

