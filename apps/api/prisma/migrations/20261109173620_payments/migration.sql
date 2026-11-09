-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "fiscal_year_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "contact_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "currency" CHAR(3),
    "rate" DECIMAL(20,10),
    "amount" BIGINT NOT NULL,
    "allocated" BIGINT NOT NULL DEFAULT 0,
    "reference" TEXT,
    "notes" TEXT,
    "journal_entry_id" UUID NOT NULL,
    "void_entry_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("payment_id","invoice_id")
);

-- CreateIndex
CREATE INDEX "payments_organization_id_contact_id_idx" ON "payments"("organization_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_id_key" ON "payments"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_kind_fiscal_year_id_number_key" ON "payments"("organization_id", "kind", "fiscal_year_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_journal_entry_id_key" ON "payments"("organization_id", "journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_void_entry_id_key" ON "payments"("organization_id", "void_entry_id");

-- CreateIndex
CREATE INDEX "payment_allocations_organization_id_invoice_id_idx" ON "payment_allocations"("organization_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fiscal_year_id_fkey" FOREIGN KEY ("organization_id", "fiscal_year_id") REFERENCES "fiscal_years"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_bank_account_id_fkey" FOREIGN KEY ("organization_id", "bank_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_void_entry_id_fkey" FOREIGN KEY ("organization_id", "void_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_payment_id_fkey" FOREIGN KEY ("organization_id", "payment_id") REFERENCES "payments"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


ALTER TABLE "payments" ADD CONSTRAINT "payments_kind" CHECK ("kind" IN ('receipt', 'payment'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_status" CHECK ("status" IN ('posted', 'void') AND (("status" = 'void') = ("void_entry_id" IS NOT NULL)));
ALTER TABLE "payments" ADD CONSTRAINT "payments_amounts" CHECK ("amount" > 0 AND "allocated" >= 0 AND "allocated" <= "amount");
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount" CHECK ("amount" > 0);
