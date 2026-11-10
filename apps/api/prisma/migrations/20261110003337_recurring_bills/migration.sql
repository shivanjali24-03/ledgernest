-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "recurring_bill_id" UUID;

-- CreateTable
CREATE TABLE "recurring_bills" (
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
    "auto_record" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "template" JSONB NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_bills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_bills_status_next_date_idx" ON "recurring_bills"("status", "next_date");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_bills_organization_id_id_key" ON "recurring_bills"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_organization_id_recurring_bill_id_fkey" FOREIGN KEY ("organization_id", "recurring_bill_id") REFERENCES "recurring_bills"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_bills" ADD CONSTRAINT "recurring_bills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_bills" ADD CONSTRAINT "recurring_bills_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

