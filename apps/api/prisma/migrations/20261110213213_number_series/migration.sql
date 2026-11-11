-- DropIndex
DROP INDEX "credit_notes_organization_id_fiscal_year_id_number_key";

-- DropIndex
DROP INDEX "invoices_organization_id_fiscal_year_id_number_key";

-- DropIndex
DROP INDEX "vendor_credits_organization_id_fiscal_year_id_number_key";

-- AlterTable
ALTER TABLE "credit_notes" ADD COLUMN     "full_number" TEXT,
ADD COLUMN     "series_id" UUID;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "full_number" TEXT,
ADD COLUMN     "series_id" UUID;

-- AlterTable
ALTER TABLE "vendor_credits" ADD COLUMN     "full_number" TEXT,
ADD COLUMN     "series_id" UUID;

-- CreateTable
CREATE TABLE "number_series" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "suffix" TEXT NOT NULL DEFAULT '',
    "digits" INTEGER NOT NULL DEFAULT 4,
    "start_number" INTEGER NOT NULL DEFAULT 1,
    "reset_yearly" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "number_series_organization_id_id_key" ON "number_series"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "number_series_organization_id_type_name_key" ON "number_series"("organization_id", "type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_organization_id_fiscal_year_id_full_number_key" ON "credit_notes"("organization_id", "fiscal_year_id", "full_number");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_series_id_fiscal_year_id_number_key" ON "credit_notes"("series_id", "fiscal_year_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_fiscal_year_id_full_number_key" ON "invoices"("organization_id", "fiscal_year_id", "full_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_series_id_fiscal_year_id_number_key" ON "invoices"("series_id", "fiscal_year_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_credits_organization_id_fiscal_year_id_full_number_key" ON "vendor_credits"("organization_id", "fiscal_year_id", "full_number");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_credits_series_id_fiscal_year_id_number_key" ON "vendor_credits"("series_id", "fiscal_year_id", "number");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_series_id_fkey" FOREIGN KEY ("organization_id", "series_id") REFERENCES "number_series"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_credits" ADD CONSTRAINT "vendor_credits_organization_id_series_id_fkey" FOREIGN KEY ("organization_id", "series_id") REFERENCES "number_series"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_series_id_fkey" FOREIGN KEY ("organization_id", "series_id") REFERENCES "number_series"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every organisation starts with the series that give the numbers LedgerNest always gave
INSERT INTO "number_series" ("id", "organization_id", "type", "name", "prefix", "digits", "is_default", "updated_at")
SELECT gen_random_uuid(), o."id", t."type", t."name", t."prefix", 4, true, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES ('invoice', 'Tax invoices', 'INV/{FY}/'), ('credit_note', 'Credit notes', 'CN/{FY}/'), ('debit_note', 'Debit notes', 'DN/{FY}/')) AS t("type", "name", "prefix");

-- Documents already numbered keep their numbers, now written down
UPDATE "invoices" d SET
  "series_id" = s."id",
  "full_number" = 'INV/' || replace(regexp_replace(y."name", '^FY\s*', ''), '–', '-') || '/' || CASE WHEN length(d."number"::text) >= 4 THEN d."number"::text ELSE lpad(d."number"::text, 4, '0') END
FROM "number_series" s, "fiscal_years" y
WHERE d."number" IS NOT NULL AND s."organization_id" = d."organization_id" AND s."type" = 'invoice' AND y."id" = d."fiscal_year_id";

UPDATE "credit_notes" d SET
  "series_id" = s."id",
  "full_number" = 'CN/' || replace(regexp_replace(y."name", '^FY\s*', ''), '–', '-') || '/' || CASE WHEN length(d."number"::text) >= 4 THEN d."number"::text ELSE lpad(d."number"::text, 4, '0') END
FROM "number_series" s, "fiscal_years" y
WHERE s."organization_id" = d."organization_id" AND s."type" = 'credit_note' AND y."id" = d."fiscal_year_id";

UPDATE "vendor_credits" d SET
  "series_id" = s."id",
  "full_number" = 'DN/' || replace(regexp_replace(y."name", '^FY\s*', ''), '–', '-') || '/' || CASE WHEN length(d."number"::text) >= 4 THEN d."number"::text ELSE lpad(d."number"::text, 4, '0') END
FROM "number_series" s, "fiscal_years" y
WHERE s."organization_id" = d."organization_id" AND s."type" = 'debit_note' AND y."id" = d."fiscal_year_id";
