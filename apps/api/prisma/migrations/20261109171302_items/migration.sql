-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "unit" TEXT,
    "sale_price" BIGINT,
    "purchase_price" BIGINT,
    "tax_group_id" UUID,
    "hsn_sac" TEXT,
    "income_account_id" UUID,
    "expense_account_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "items_organization_id_archived_at_idx" ON "items"("organization_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "items_organization_id_id_key" ON "items"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "items_organization_id_sku_key" ON "items"("organization_id", "sku");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_tax_group_id_fkey" FOREIGN KEY ("organization_id", "tax_group_id") REFERENCES "tax_groups"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_income_account_id_fkey" FOREIGN KEY ("organization_id", "income_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_expense_account_id_fkey" FOREIGN KEY ("organization_id", "expense_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


ALTER TABLE "items" ADD CONSTRAINT "items_kind" CHECK ("kind" IN ('goods', 'service'));
ALTER TABLE "items" ADD CONSTRAINT "items_prices" CHECK (coalesce("sale_price", 0) >= 0 AND coalesce("purchase_price", 0) >= 0);
ALTER TABLE "items" ADD CONSTRAINT "items_hsn_sac" CHECK ("hsn_sac" IS NULL OR "hsn_sac" ~ '^[0-9]{4}([0-9]{2}){0,2}$');
CREATE UNIQUE INDEX "items_org_name_key" ON "items" ("organization_id", lower("name"));
