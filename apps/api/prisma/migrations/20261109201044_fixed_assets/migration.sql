-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "description" TEXT,
    "cost_account_id" UUID NOT NULL,
    "accumulated_account_id" UUID NOT NULL,
    "expense_account_id" UUID NOT NULL,
    "cost" BIGINT NOT NULL,
    "residual" BIGINT NOT NULL DEFAULT 0,
    "in_service_date" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "useful_life_months" INTEGER,
    "wdv_rate_ppm" INTEGER,
    "opening_accumulated" BIGINT NOT NULL DEFAULT 0,
    "accumulated" BIGINT NOT NULL DEFAULT 0,
    "depreciated_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "disposed_on" DATE,
    "proceeds" BIGINT,
    "disposal_entry_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "up_to" DATE NOT NULL,
    "total" BIGINT NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depreciation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "previous_to" DATE,

    CONSTRAINT "depreciation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_organization_id_id_key" ON "fixed_assets"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_organization_id_tag_key" ON "fixed_assets"("organization_id", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_organization_id_disposal_entry_id_key" ON "fixed_assets"("organization_id", "disposal_entry_id");

-- CreateIndex
CREATE INDEX "depreciation_runs_organization_id_up_to_idx" ON "depreciation_runs"("organization_id", "up_to");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_runs_organization_id_id_key" ON "depreciation_runs"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_runs_organization_id_journal_entry_id_key" ON "depreciation_runs"("organization_id", "journal_entry_id");

-- CreateIndex
CREATE INDEX "depreciation_lines_organization_id_asset_id_idx" ON "depreciation_lines"("organization_id", "asset_id");

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_cost_account_id_fkey" FOREIGN KEY ("organization_id", "cost_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_accumulated_account_id_fkey" FOREIGN KEY ("organization_id", "accumulated_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_expense_account_id_fkey" FOREIGN KEY ("organization_id", "expense_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organization_id_disposal_entry_id_fkey" FOREIGN KEY ("organization_id", "disposal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_organization_id_run_id_fkey" FOREIGN KEY ("organization_id", "run_id") REFERENCES "depreciation_runs"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "fixed_assets"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_method_check" CHECK ("method" IN ('straight_line', 'wdv'));
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_status_check" CHECK ("status" IN ('active', 'disposed'));
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_amounts_check" CHECK ("cost" > 0 AND "residual" >= 0 AND "residual" < "cost" AND "accumulated" >= 0 AND "accumulated" <= "cost" - "residual");
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_life_check" CHECK (("method" = 'straight_line' AND "useful_life_months" > 0) OR ("method" = 'wdv' AND "wdv_rate_ppm" > 0));
