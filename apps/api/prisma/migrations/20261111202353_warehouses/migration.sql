-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "warehouse_id" UUID;

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" JSONB,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organization_id_id_key" ON "warehouses"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organization_id_code_key" ON "warehouses"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_organization_id_id_key" ON "stock_transfers"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_organization_id_number_key" ON "stock_transfers"("organization_id", "number");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_warehouse_id_item_id_idx" ON "stock_movements"("organization_id", "warehouse_id", "item_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_warehouse_id_fkey" FOREIGN KEY ("organization_id", "warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_organization_id_from_warehouse_id_fkey" FOREIGN KEY ("organization_id", "from_warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_organization_id_to_warehouse_id_fkey" FOREIGN KEY ("organization_id", "to_warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- One main warehouse at most, and goods move between two different ones
CREATE UNIQUE INDEX "warehouses_one_default" ON "warehouses"("organization_id") WHERE "is_default";
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_two_places_check" CHECK ("from_warehouse_id" <> "to_warehouse_id");
