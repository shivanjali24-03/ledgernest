-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "bank_account_id" UUID NOT NULL,
    "to_account_id" UUID,
    "date" DATE NOT NULL,
    "contact_id" UUID,
    "reference" TEXT,
    "description" TEXT,
    "currency" CHAR(3),
    "amount" BIGINT NOT NULL,
    "to_currency" CHAR(3),
    "to_amount" BIGINT,
    "rate" DECIMAL(20,10),
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "lines" JSONB,
    "journal_entry_id" UUID NOT NULL,
    "void_entry_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_transactions_organization_id_bank_account_id_date_idx" ON "bank_transactions"("organization_id", "bank_account_id", "date");

-- CreateIndex
CREATE INDEX "bank_transactions_organization_id_to_account_id_date_idx" ON "bank_transactions"("organization_id", "to_account_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_organization_id_id_key" ON "bank_transactions"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_organization_id_journal_entry_id_key" ON "bank_transactions"("organization_id", "journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_organization_id_void_entry_id_key" ON "bank_transactions"("organization_id", "void_entry_id");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_bank_account_id_fkey" FOREIGN KEY ("organization_id", "bank_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_to_account_id_fkey" FOREIGN KEY ("organization_id", "to_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_contact_id_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_journal_entry_id_fkey" FOREIGN KEY ("organization_id", "journal_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_void_entry_id_fkey" FOREIGN KEY ("organization_id", "void_entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;



ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_kind_check" CHECK ("kind" IN ('spend', 'receive', 'transfer'));
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_status_check" CHECK ("status" IN ('posted', 'void'));
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_amount_check" CHECK ("amount" > 0);
-- A transfer has the account it goes to, and nothing else does
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_transfer_check" CHECK (("kind" = 'transfer') = ("to_account_id" IS NOT NULL));
