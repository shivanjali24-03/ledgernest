-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "fiscal_year_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closed_at" TIMESTAMP(3),
    "closed_by_id" UUID,
    "close_reason" TEXT,

    CONSTRAINT "periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_organization_id_id_key" ON "fiscal_years"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_organization_id_start_date_key" ON "fiscal_years"("organization_id", "start_date");

-- CreateIndex
CREATE INDEX "periods_organization_id_start_date_idx" ON "periods"("organization_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "periods_fiscal_year_id_number_key" ON "periods"("fiscal_year_id", "number");

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_organization_id_fiscal_year_id_fkey" FOREIGN KEY ("organization_id", "fiscal_year_id") REFERENCES "fiscal_years"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sanity rules the application also follows
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_dates_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "periods"
  ADD CONSTRAINT "periods_dates_check" CHECK ("end_date" >= "start_date"),
  ADD CONSTRAINT "periods_number_check" CHECK ("number" BETWEEN 1 AND 12),
  ADD CONSTRAINT "periods_status_check" CHECK ("status" IN ('open', 'closed')),
  ADD CONSTRAINT "periods_closed_check" CHECK (("status" = 'closed') = ("closed_at" IS NOT NULL));

-- Two financial years (or two periods) of one organisation can never overlap, whatever the application does
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_no_overlap" EXCLUDE USING gist ("organization_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&);
ALTER TABLE "periods" ADD CONSTRAINT "periods_no_overlap" EXCLUDE USING gist ("organization_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&);
