-- Allocations settle an invoice (receipts) or a bill (payments): give them their own id, existing rows included
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_pkey",
ADD COLUMN "bill_id" UUID,
ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ALTER COLUMN "invoice_id" DROP NOT NULL,
ADD CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id");
ALTER TABLE "payment_allocations" ALTER COLUMN "id" DROP DEFAULT;

CREATE INDEX "payment_allocations_organization_id_bill_id_idx" ON "payment_allocations"("organization_id", "bill_id");
CREATE UNIQUE INDEX "payment_allocations_payment_id_invoice_id_key" ON "payment_allocations"("payment_id", "invoice_id");
CREATE UNIQUE INDEX "payment_allocations_payment_id_bill_id_key" ON "payment_allocations"("payment_id", "bill_id");
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_bill_id_fkey" FOREIGN KEY ("organization_id", "bill_id") REFERENCES "bills"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Exactly one document per allocation
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_one_document" CHECK (("invoice_id" IS NULL) <> ("bill_id" IS NULL));
