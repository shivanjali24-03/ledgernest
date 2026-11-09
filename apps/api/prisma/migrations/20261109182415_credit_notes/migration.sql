-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "fiscal_year_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "currency" CHAR(3),
    "rate" DECIMAL(20,10),
    "reason" TEXT,
    "receivable_account_id" UUID NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "tax_total" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "applied" BIGINT NOT NULL DEFAULT 0,
    "journal_entry_id" UUID NOT NULL,
    "void_entry_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(13,4) NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "discount_ppm" INTEGER NOT NULL DEFAULT 0,
    "tax_group_id" UUID,
    "account_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "tax_amount" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_applications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "invoice_id" UUID,
    "journal_entry_id" UUID,
    "bank_account_id" UUID,
    "date" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "rate" DECIMAL(20,10),
    "reference" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_notes_organization_id_contact_id_idx" ON "credit_notes"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "credit_notes_organization_id_invoice_id_idx" ON "credit_notes"("organization_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_organization_id_id_key" ON "credit_notes"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_organization_id_fiscal_year_id_number_key" ON "credit_notes"("organization_id", "fiscal_year_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_organization_id_journal_entry_id_key" ON "credit_notes"("organization_id", "journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_organization_id_void_entry_id_key" ON "credit_notes"("organization_id", "void_entry_id");

-- CreateIndex
CREATE INDEX "credit_note_lines_organization_id_invoice_line_id_idx" ON "credit_note_lines"("organization_id", "invoice_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_lines_credit_note_id_line_no_key" ON "credit_note_lines"("credit_note_id", "line_no");

-- CreateIndex
CREATE INDEX "credit_applications_organization_id_credit_note_id_idx" ON "credit_applications"("organization_id", "credit_note_id");

-- CreateIndex
CREATE INDEX "credit_applications_organization_id_invoice_id_idx" ON "credit_applications"("organization_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_applications_organization_id_journal_entry_id_key" ON "credit_applications"("organization_id", "journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_organization_id_id_key" ON "invoice_lines"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_fiscal_year_id_fkey" FOREIGN KEY ("organization_id", "fiscal_year_id") REFERENCES "fiscal_years"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_receivable_account_id_fkey" FOREIGN KEY ("organization_id", "receivable_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_void_entry_id_fkey" FOREIGN KEY ("organization_id", "void_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_organization_id_credit_note_id_fkey" FOREIGN KEY ("organization_id", "credit_note_id") REFERENCES "credit_notes"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_organization_id_invoice_line_id_fkey" FOREIGN KEY ("organization_id", "invoice_line_id") REFERENCES "invoice_lines"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_organization_id_tax_group_id_fkey" FOREIGN KEY ("organization_id", "tax_group_id") REFERENCES "tax_groups"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_organization_id_credit_note_id_fkey" FOREIGN KEY ("organization_id", "credit_note_id") REFERENCES "credit_notes"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_organization_id_bank_account_id_fkey" FOREIGN KEY ("organization_id", "bank_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- An application goes onto an invoice or is a refund, never both or neither
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_target_check" CHECK (("invoice_id" IS NULL) <> ("journal_entry_id" IS NULL));
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_amount_check" CHECK ("amount" > 0);
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_status_check" CHECK ("status" IN ('issued', 'void'));
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_applied_check" CHECK ("applied" >= 0 AND "applied" <= "total");
