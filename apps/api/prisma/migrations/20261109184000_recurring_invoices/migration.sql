-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "recurring_invoice_id" UUID;

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_id" UUID NOT NULL,
    "frequency" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "max_count" INTEGER,
    "count" INTEGER NOT NULL DEFAULT 0,
    "next_date" DATE,
    "auto_issue" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "template" JSONB NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_invoices_status_next_date_idx" ON "recurring_invoices"("status", "next_date");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_invoices_organization_id_id_key" ON "recurring_invoices"("organization_id", "id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_recurring_invoice_id_idx" ON "invoices"("organization_id", "recurring_invoice_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_recurring_invoice_id_fkey" FOREIGN KEY ("organization_id", "recurring_invoice_id") REFERENCES "recurring_invoices"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_frequency_check" CHECK ("frequency" IN ('weekly', 'monthly', 'quarterly', 'yearly'));
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_status_check" CHECK ("status" IN ('active', 'paused', 'ended'));
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_interval_check" CHECK ("interval" BETWEEN 1 AND 12);
