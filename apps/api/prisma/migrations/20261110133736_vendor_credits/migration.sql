-- CreateTable
CREATE TABLE "vendor_credits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "fiscal_year_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "vendor_reference" TEXT,
    "reason" TEXT,
    "payable_account_id" UUID NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "tax_total" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "applied" BIGINT NOT NULL DEFAULT 0,
    "journal_entry_id" UUID NOT NULL,
    "void_entry_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "vendor_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_credit_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_credit_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bill_line_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(13,4) NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "discount_ppm" INTEGER NOT NULL DEFAULT 0,
    "tax_group_id" UUID,
    "account_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "tax_amount" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "vendor_credit_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_credit_applications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_credit_id" UUID NOT NULL,
    "bill_id" UUID,
    "journal_entry_id" UUID,
    "bank_account_id" UUID,
    "date" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "reference" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_credit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_credits_organization_id_contact_id_idx" ON "vendor_credits"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "vendor_credits_organization_id_bill_id_idx" ON "vendor_credits"("organization_id", "bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_credits_organization_id_id_key" ON "vendor_credits"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_credits_organization_id_fiscal_year_id_number_key" ON "vendor_credits"("organization_id", "fiscal_year_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_credits_organization_id_journal_entry_id_key" ON "vendor_credits"("organization_id", "journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_credits_organization_id_void_entry_id_key" ON "vendor_credits"("organization_id", "void_entry_id");

-- CreateIndex
CREATE INDEX "vendor_credit_lines_organization_id_bill_line_id_idx" ON "vendor_credit_lines"("organization_id", "bill_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_credit_lines_vendor_credit_id_line_no_key" ON "vendor_credit_lines"("vendor_credit_id", "line_no");

-- CreateIndex
CREATE INDEX "vendor_credit_applications_organization_id_vendor_credit_id_idx" ON "vendor_credit_applications"("organization_id", "vendor_credit_id");

-- CreateIndex
CREATE INDEX "vendor_credit_applications_organization_id_bill_id_idx" ON "vendor_credit_applications"("organization_id", "bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_credit_applications_organization_id_journal_entry_id_key" ON "vendor_credit_applications"("organization_id", "journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_lines_organization_id_id_key" ON "bill_lines"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "vendor_credits" ADD CONSTRAINT "vendor_credits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credits" ADD CONSTRAINT "vendor_credits_organization_id_fiscal_year_id_fkey" FOREIGN KEY ("organization_id", "fiscal_year_id") REFERENCES "fiscal_years"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credits" ADD CONSTRAINT "vendor_credits_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credits" ADD CONSTRAINT "vendor_credits_organization_id_bill_id_fkey" FOREIGN KEY ("organization_id", "bill_id") REFERENCES "bills"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credits" ADD CONSTRAINT "vendor_credits_organization_id_payable_account_id_fkey" FOREIGN KEY ("organization_id", "payable_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credits" ADD CONSTRAINT "vendor_credits_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credits" ADD CONSTRAINT "vendor_credits_organization_id_void_entry_id_fkey" FOREIGN KEY ("organization_id", "void_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credit_lines" ADD CONSTRAINT "vendor_credit_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credit_lines" ADD CONSTRAINT "vendor_credit_lines_organization_id_vendor_credit_id_fkey" FOREIGN KEY ("organization_id", "vendor_credit_id") REFERENCES "vendor_credits"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credit_lines" ADD CONSTRAINT "vendor_credit_lines_organization_id_bill_line_id_fkey" FOREIGN KEY ("organization_id", "bill_line_id") REFERENCES "bill_lines"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credit_lines" ADD CONSTRAINT "vendor_credit_lines_organization_id_tax_group_id_fkey" FOREIGN KEY ("organization_id", "tax_group_id") REFERENCES "tax_groups"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credit_lines" ADD CONSTRAINT "vendor_credit_lines_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credit_applications" ADD CONSTRAINT "vendor_credit_applications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credit_applications" ADD CONSTRAINT "vendor_credit_applications_organization_id_vendor_credit_i_fkey" FOREIGN KEY ("organization_id", "vendor_credit_id") REFERENCES "vendor_credits"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credit_applications" ADD CONSTRAINT "vendor_credit_applications_organization_id_bill_id_fkey" FOREIGN KEY ("organization_id", "bill_id") REFERENCES "bills"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credit_applications" ADD CONSTRAINT "vendor_credit_applications_organization_id_journal_entry_i_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credit_applications" ADD CONSTRAINT "vendor_credit_applications_organization_id_bank_account_id_fkey" FOREIGN KEY ("organization_id", "bank_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

