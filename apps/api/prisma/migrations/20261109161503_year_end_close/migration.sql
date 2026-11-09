-- The entry that moved a year's profit to retained earnings when its last month closed
ALTER TABLE "fiscal_years" ADD COLUMN "closing_entry_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_organization_id_closing_entry_id_key" ON "fiscal_years"("organization_id", "closing_entry_id");

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_organization_id_closing_entry_id_fkey" FOREIGN KEY ("organization_id", "closing_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
