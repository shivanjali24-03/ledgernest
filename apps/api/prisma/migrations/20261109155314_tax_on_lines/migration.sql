-- AlterTable
ALTER TABLE "journal_lines" ADD COLUMN     "tax_group_id" UUID,
ADD COLUMN     "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tax_rate_id" UUID,
ADD COLUMN     "tax_source_line" INTEGER;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organization_id_tax_group_id_fkey" FOREIGN KEY ("organization_id", "tax_group_id") REFERENCES "tax_groups"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organization_id_tax_rate_id_fkey" FOREIGN KEY ("organization_id", "tax_rate_id") REFERENCES "tax_rates"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- A generated tax line names both its rate and the line it was charged on; a line is never both a taxed line and a tax line
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tax_shape" CHECK (
  ("tax_rate_id" IS NULL) = ("tax_source_line" IS NULL)
  AND NOT ("tax_rate_id" IS NOT NULL AND "tax_group_id" IS NOT NULL)
  AND ("tax_group_id" IS NOT NULL OR "tax_inclusive" = false)
);
CREATE INDEX "journal_lines_org_tax_rate_idx" ON "journal_lines" ("organization_id", "tax_rate_id") WHERE "tax_rate_id" IS NOT NULL;
CREATE INDEX "journal_lines_org_tax_group_idx" ON "journal_lines" ("organization_id", "tax_group_id") WHERE "tax_group_id" IS NOT NULL;
