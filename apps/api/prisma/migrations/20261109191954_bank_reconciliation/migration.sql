-- CreateTable
CREATE TABLE "bank_matches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "statement_line_id" UUID NOT NULL,
    "journal_line_id" UUID NOT NULL,
    "reconciliation_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "statement_date" DATE NOT NULL,
    "statement_balance" BIGINT NOT NULL,
    "book_balance" BIGINT NOT NULL,
    "outstanding_in" BIGINT NOT NULL,
    "outstanding_out" BIGINT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_matches_organization_id_statement_line_id_idx" ON "bank_matches"("organization_id", "statement_line_id");

-- CreateIndex
CREATE INDEX "bank_matches_organization_id_reconciliation_id_idx" ON "bank_matches"("organization_id", "reconciliation_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_matches_organization_id_journal_line_id_key" ON "bank_matches"("organization_id", "journal_line_id");

-- CreateIndex
CREATE INDEX "bank_reconciliations_organization_id_bank_account_id_statem_idx" ON "bank_reconciliations"("organization_id", "bank_account_id", "statement_date");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliations_organization_id_id_key" ON "bank_reconciliations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_organization_id_id_key" ON "journal_lines"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_organization_id_statement_line_id_fkey" FOREIGN KEY ("organization_id", "statement_line_id") REFERENCES "bank_statement_lines"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_organization_id_journal_line_id_fkey" FOREIGN KEY ("organization_id", "journal_line_id") REFERENCES "journal_lines"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_organization_id_reconciliation_id_fkey" FOREIGN KEY ("organization_id", "reconciliation_id") REFERENCES "bank_reconciliations"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_organization_id_bank_account_id_fkey" FOREIGN KEY ("organization_id", "bank_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

