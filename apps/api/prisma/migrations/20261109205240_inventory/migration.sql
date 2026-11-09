-- AlterTable
ALTER TABLE "items" ADD COLUMN     "cogs_account_id" UUID,
ADD COLUMN     "inventory_account_id" UUID,
ADD COLUMN     "track_stock" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "source_id" UUID,
    "quantity" DECIMAL(13,4) NOT NULL,
    "value" BIGINT NOT NULL,
    "reason" TEXT,
    "journal_entry_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_item_id_date_idx" ON "stock_movements"("organization_id", "item_id", "date");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_source_id_idx" ON "stock_movements"("organization_id", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_organization_id_id_key" ON "stock_movements"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_inventory_account_id_fkey" FOREIGN KEY ("organization_id", "inventory_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_cogs_account_id_fkey" FOREIGN KEY ("organization_id", "cogs_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_item_id_fkey" FOREIGN KEY ("organization_id", "item_id") REFERENCES "items"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

