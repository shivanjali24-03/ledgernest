-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "added" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "first_date" DATE,
    "last_date" DATE,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" BIGINT NOT NULL,
    "balance" BIGINT,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unmatched',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_layouts" (
    "organization_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "mapping" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_statement_layouts_pkey" PRIMARY KEY ("organization_id","bank_account_id")
);

-- CreateIndex
CREATE INDEX "bank_statement_imports_organization_id_bank_account_id_crea_idx" ON "bank_statement_imports"("organization_id", "bank_account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_imports_organization_id_id_key" ON "bank_statement_imports"("organization_id", "id");

-- CreateIndex
CREATE INDEX "bank_statement_lines_organization_id_bank_account_id_status_idx" ON "bank_statement_lines"("organization_id", "bank_account_id", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_organization_id_id_key" ON "bank_statement_lines"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_organization_id_bank_account_id_finger_key" ON "bank_statement_lines"("organization_id", "bank_account_id", "fingerprint");

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_organization_id_bank_account_id_fkey" FOREIGN KEY ("organization_id", "bank_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_organization_id_bank_account_id_fkey" FOREIGN KEY ("organization_id", "bank_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_organization_id_import_id_fkey" FOREIGN KEY ("organization_id", "import_id") REFERENCES "bank_statement_imports"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_layouts" ADD CONSTRAINT "bank_statement_layouts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_layouts" ADD CONSTRAINT "bank_statement_layouts_organization_id_bank_account_id_fkey" FOREIGN KEY ("organization_id", "bank_account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_status_check" CHECK ("status" IN ('unmatched', 'matched', 'ignored'));
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_amount_check" CHECK ("amount" <> 0);
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_format_check" CHECK ("format" IN ('csv', 'ofx'));
