-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "warehouse_id" UUID;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_warehouse_id_fkey" FOREIGN KEY ("organization_id", "warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_organization_id_warehouse_id_fkey" FOREIGN KEY ("organization_id", "warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_warehouse_id_fkey" FOREIGN KEY ("organization_id", "warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_warehouse_id_fkey" FOREIGN KEY ("organization_id", "warehouse_id") REFERENCES "warehouses"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

