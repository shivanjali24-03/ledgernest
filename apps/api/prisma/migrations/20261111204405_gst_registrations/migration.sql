-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "gst_registration_id" UUID;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "gst_registration_id" UUID;

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "gst_registration_id" UUID;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "gst_registration_id" UUID;

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "gst_registration_id" UUID;

-- CreateTable
CREATE TABLE "gst_registrations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "gstin" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "trade_name" TEXT,
    "address" JSONB,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gst_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gst_registrations_organization_id_id_key" ON "gst_registrations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "gst_registrations_organization_id_gstin_key" ON "gst_registrations"("organization_id", "gstin");

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_gst_registration_id_fkey" FOREIGN KEY ("organization_id", "gst_registration_id") REFERENCES "gst_registrations"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_gst_registration_id_fkey" FOREIGN KEY ("organization_id", "gst_registration_id") REFERENCES "gst_registrations"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_organization_id_gst_registration_id_fkey" FOREIGN KEY ("organization_id", "gst_registration_id") REFERENCES "gst_registrations"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_gst_registration_id_fkey" FOREIGN KEY ("organization_id", "gst_registration_id") REFERENCES "gst_registrations"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_gst_registration_id_fkey" FOREIGN KEY ("organization_id", "gst_registration_id") REFERENCES "gst_registrations"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_registrations" ADD CONSTRAINT "gst_registrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

