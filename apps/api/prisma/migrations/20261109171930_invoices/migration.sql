-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "number" INTEGER,
    "fiscal_year_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "currency" CHAR(3),
    "rate" DECIMAL(20,10),
    "place_of_supply" CHAR(2),
    "reference" TEXT,
    "notes" TEXT,
    "receivable_account_id" UUID,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "tax_total" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "amount_paid" BIGINT NOT NULL DEFAULT 0,
    "journal_entry_id" UUID,
    "void_entry_id" UUID,
    "created_by_id" UUID,
    "issued_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(13,4) NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "discount_ppm" INTEGER NOT NULL DEFAULT 0,
    "tax_group_id" UUID,
    "account_id" UUID,
    "amount" BIGINT NOT NULL,
    "tax_amount" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_organization_id_contact_id_idx" ON "invoices"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_status_due_date_idx" ON "invoices"("organization_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_id_key" ON "invoices"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_fiscal_year_id_number_key" ON "invoices"("organization_id", "fiscal_year_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_journal_entry_id_key" ON "invoices"("organization_id", "journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_void_entry_id_key" ON "invoices"("organization_id", "void_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoice_id_line_no_key" ON "invoice_lines"("invoice_id", "line_no");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fiscal_year_id_fkey" FOREIGN KEY ("organization_id", "fiscal_year_id") REFERENCES "fiscal_years"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_receivable_account_id_fkey" FOREIGN KEY ("organization_id", "receivable_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_void_entry_id_fkey" FOREIGN KEY ("organization_id", "void_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_item_id_fkey" FOREIGN KEY ("organization_id", "item_id") REFERENCES "items"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_tax_group_id_fkey" FOREIGN KEY ("organization_id", "tax_group_id") REFERENCES "tax_groups"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- An invoice's shape: issued ones have a number, a year and their entry; drafts have none; voided ones keep them and add the reversal
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status" CHECK ("status" IN ('draft', 'issued', 'void'));
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_shape" CHECK (
  ("status" = 'draft' AND "number" IS NULL AND "journal_entry_id" IS NULL)
  OR ("status" IN ('issued', 'void') AND "number" IS NOT NULL AND "fiscal_year_id" IS NOT NULL AND "journal_entry_id" IS NOT NULL)
);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts" CHECK ("subtotal" >= 0 AND "tax_total" >= 0 AND "total" = "subtotal" + "tax_total" AND "amount_paid" >= 0 AND "amount_paid" <= "total");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dates" CHECK ("due_date" >= "issue_date");
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_amounts" CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "discount_ppm" BETWEEN 0 AND 1000000 AND "amount" >= 0 AND "tax_amount" >= 0);
