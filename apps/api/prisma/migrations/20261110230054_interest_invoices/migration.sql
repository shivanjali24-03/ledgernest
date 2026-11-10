-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "interest_on_invoice_id" UUID;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "interest_auto_raise" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "interest_raised_for" TEXT;

-- CreateTable
CREATE TABLE "interest_waivers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_waivers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interest_waivers_organization_id_invoice_id_idx" ON "interest_waivers"("organization_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "interest_waivers_organization_id_id_key" ON "interest_waivers"("organization_id", "id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_interest_on_invoice_id_idx" ON "invoices"("organization_id", "interest_on_invoice_id");

-- AddForeignKey
ALTER TABLE "interest_waivers" ADD CONSTRAINT "interest_waivers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_waivers" ADD CONSTRAINT "interest_waivers_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

