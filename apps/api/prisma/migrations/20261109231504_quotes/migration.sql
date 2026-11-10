-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "quote_date" DATE NOT NULL,
    "expiry_date" DATE NOT NULL,
    "currency" CHAR(3),
    "place_of_supply" CHAR(2),
    "reference" TEXT,
    "notes" TEXT,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "tax_total" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "invoice_id" UUID,
    "created_by_id" UUID,
    "sent_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(13,4) NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "discount_ppm" INTEGER NOT NULL DEFAULT 0,
    "tax_group_id" UUID,
    "account_id" UUID,
    "cost_centre_id" UUID,
    "amount" BIGINT NOT NULL,
    "tax_amount" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotes_organization_id_status_idx" ON "quotes"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_organization_id_id_key" ON "quotes"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_organization_id_number_key" ON "quotes"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "quote_lines_organization_id_id_key" ON "quote_lines"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_lines_quote_id_line_no_key" ON "quote_lines"("quote_id", "line_no");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_organization_id_quote_id_fkey" FOREIGN KEY ("organization_id", "quote_id") REFERENCES "quotes"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_organization_id_item_id_fkey" FOREIGN KEY ("organization_id", "item_id") REFERENCES "items"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_organization_id_tax_group_id_fkey" FOREIGN KEY ("organization_id", "tax_group_id") REFERENCES "tax_groups"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_organization_id_cost_centre_id_fkey" FOREIGN KEY ("organization_id", "cost_centre_id") REFERENCES "cost_centres"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

