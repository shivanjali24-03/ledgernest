-- CreateTable
CREATE TABLE "bills" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "number" INTEGER,
    "fiscal_year_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "vendor_reference" TEXT,
    "bill_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "currency" CHAR(3),
    "rate" DECIMAL(20,10),
    "place_of_supply" CHAR(2),
    "notes" TEXT,
    "payable_account_id" UUID,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "tax_total" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "amount_paid" BIGINT NOT NULL DEFAULT 0,
    "journal_entry_id" UUID,
    "void_entry_id" UUID,
    "created_by_id" UUID,
    "recorded_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
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

    CONSTRAINT "bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bills_organization_id_contact_id_idx" ON "bills"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "bills_organization_id_status_due_date_idx" ON "bills"("organization_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "bills_organization_id_id_key" ON "bills"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bills_organization_id_fiscal_year_id_number_key" ON "bills"("organization_id", "fiscal_year_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "bills_organization_id_journal_entry_id_key" ON "bills"("organization_id", "journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "bills_organization_id_void_entry_id_key" ON "bills"("organization_id", "void_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_lines_bill_id_line_no_key" ON "bill_lines"("bill_id", "line_no");

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_organization_id_fiscal_year_id_fkey" FOREIGN KEY ("organization_id", "fiscal_year_id") REFERENCES "fiscal_years"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_organization_id_payable_account_id_fkey" FOREIGN KEY ("organization_id", "payable_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_organization_id_void_entry_id_fkey" FOREIGN KEY ("organization_id", "void_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_organization_id_bill_id_fkey" FOREIGN KEY ("organization_id", "bill_id") REFERENCES "bills"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_organization_id_item_id_fkey" FOREIGN KEY ("organization_id", "item_id") REFERENCES "items"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_organization_id_tax_group_id_fkey" FOREIGN KEY ("organization_id", "tax_group_id") REFERENCES "tax_groups"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


ALTER TABLE "bills" ADD CONSTRAINT "bills_status" CHECK ("status" IN ('draft', 'open', 'void'));
ALTER TABLE "bills" ADD CONSTRAINT "bills_recorded_shape" CHECK (
  ("status" = 'draft' AND "number" IS NULL AND "journal_entry_id" IS NULL)
  OR ("status" IN ('open', 'void') AND "number" IS NOT NULL AND "fiscal_year_id" IS NOT NULL AND "journal_entry_id" IS NOT NULL)
);
ALTER TABLE "bills" ADD CONSTRAINT "bills_amounts" CHECK ("subtotal" >= 0 AND "tax_total" >= 0 AND "total" = "subtotal" + "tax_total" AND "amount_paid" >= 0 AND "amount_paid" <= "total");
ALTER TABLE "bills" ADD CONSTRAINT "bills_dates" CHECK ("due_date" >= "bill_date");
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_amounts" CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "discount_ppm" BETWEEN 0 AND 1000000 AND "amount" >= 0 AND "tax_amount" >= 0);
