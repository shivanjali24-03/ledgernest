-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "currency" CHAR(3);

-- AlterTable
ALTER TABLE "journal_lines" ADD COLUMN     "currency" CHAR(3),
ADD COLUMN     "foreign_credit" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "foreign_debit" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "fx_source_line" INTEGER,
ADD COLUMN     "rate" DECIMAL(20,10);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organization_id_id_currency_key" ON "accounts"("organization_id", "id", "currency");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_currency_fkey" FOREIGN KEY ("organization_id", "currency") REFERENCES "organization_currencies"("organization_id", "code") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organization_id_account_id_currency_fkey" FOREIGN KEY ("organization_id", "account_id", "currency") REFERENCES "accounts"("organization_id", "id", "currency") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Foreign amounts are never negative, a line is a foreign debit or a foreign credit, and base lines have none
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_foreign_shape" CHECK (
  "foreign_debit" >= 0 AND "foreign_credit" >= 0 AND NOT ("foreign_debit" > 0 AND "foreign_credit" > 0)
  AND ("currency" IS NOT NULL OR ("foreign_debit" = 0 AND "foreign_credit" = 0 AND "rate" IS NULL))
  AND ("rate" IS NULL OR "rate" > 0)
  AND ("fx_source_line" IS NULL OR ("foreign_debit" = 0 AND "foreign_credit" = 0))
);
-- Only assets and liabilities can be held in a foreign currency
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_type" CHECK ("currency" IS NULL OR "type" IN ('asset', 'liability'));
