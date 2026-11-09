-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" INTEGER,
    "fiscal_year_id" UUID,
    "date" DATE NOT NULL,
    "memo" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reversal_of_id" UUID,
    "created_by_id" UUID,
    "posted_by_id" UUID,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_id" UUID NOT NULL,
    "description" TEXT,
    "debit" BIGINT NOT NULL DEFAULT 0,
    "credit" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_date_idx" ON "journal_entries"("organization_id", "date");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_status_idx" ON "journal_entries"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organization_id_id_key" ON "journal_entries"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organization_id_fiscal_year_id_number_key" ON "journal_entries"("organization_id", "fiscal_year_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organization_id_reversal_of_id_key" ON "journal_entries"("organization_id", "reversal_of_id");

-- CreateIndex
CREATE INDEX "journal_lines_organization_id_account_id_idx" ON "journal_lines"("organization_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_entry_id_line_no_key" ON "journal_lines"("entry_id", "line_no");

-- CreateIndex
CREATE INDEX "journal_attachments_entry_id_idx" ON "journal_attachments"("entry_id");

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_fiscal_year_id_fkey" FOREIGN KEY ("organization_id", "fiscal_year_id") REFERENCES "fiscal_years"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_reversal_of_id_fkey" FOREIGN KEY ("organization_id", "reversal_of_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organization_id_entry_id_fkey" FOREIGN KEY ("organization_id", "entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organization_id_account_id_fkey" FOREIGN KEY ("organization_id", "account_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_attachments" ADD CONSTRAINT "journal_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_attachments" ADD CONSTRAINT "journal_attachments_organization_id_entry_id_fkey" FOREIGN KEY ("organization_id", "entry_id") REFERENCES "journal_entries"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lines are either a debit or a credit, never both, never negative
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_amounts_check" CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0) <> ("credit" > 0)));
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_status_check" CHECK ("status" IN ('draft', 'posted')),
  ADD CONSTRAINT "journal_entries_posted_check" CHECK ("status" = 'draft' OR ("number" IS NOT NULL AND "fiscal_year_id" IS NOT NULL AND "posted_at" IS NOT NULL));
ALTER TABLE "journal_attachments"
  ADD CONSTRAINT "journal_attachments_type_check" CHECK ("content_type" IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  ADD CONSTRAINT "journal_attachments_size_check" CHECK (octet_length("data") BETWEEN 1 AND 2097152 AND "size" = octet_length("data"));

-- Posting: at least two lines, debits equal credits, and the date in an open period
CREATE FUNCTION journal_entries_check_posting() RETURNS trigger AS $$
DECLARE
  n int; dr numeric; cr numeric;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" = 'posted' THEN
    RAISE EXCEPTION 'Entries are created as drafts and then posted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'posted' AND OLD."status" = 'draft' THEN
    SELECT count(*), coalesce(sum("debit"), 0), coalesce(sum("credit"), 0) INTO n, dr, cr FROM "journal_lines" WHERE "entry_id" = NEW."id";
    IF n < 2 OR dr <> cr OR dr = 0 THEN
      RAISE EXCEPTION 'A posted entry needs at least two lines and equal debits and credits' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "periods" p WHERE p."organization_id" = NEW."organization_id" AND NEW."date" BETWEEN p."start_date" AND p."end_date" AND p."status" = 'open') THEN
      RAISE EXCEPTION 'Entries can only be posted into an open period' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER journal_entries_check_posting BEFORE INSERT OR UPDATE ON "journal_entries" FOR EACH ROW EXECUTE FUNCTION journal_entries_check_posting();

-- Posted entries are final: no edits, no deletion (a reversal corrects them). Deleting the whole
-- organisation is the only exception; clearing a deleted user's reference is allowed.
CREATE FUNCTION journal_entries_posted_are_final() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'posted' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organization_id") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Posted journal entries can''t be deleted. Reverse them instead.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW."id", NEW."organization_id", NEW."number", NEW."fiscal_year_id", NEW."date", NEW."memo", NEW."reference", NEW."status", NEW."reversal_of_id", NEW."posted_at", NEW."created_at")
     IS NOT DISTINCT FROM
     (OLD."id", OLD."organization_id", OLD."number", OLD."fiscal_year_id", OLD."date", OLD."memo", OLD."reference", OLD."status", OLD."reversal_of_id", OLD."posted_at", OLD."created_at")
     AND (NEW."created_by_id" IS NOT DISTINCT FROM OLD."created_by_id" OR NEW."created_by_id" IS NULL)
     AND (NEW."posted_by_id" IS NOT DISTINCT FROM OLD."posted_by_id" OR NEW."posted_by_id" IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Posted journal entries can''t be changed. Reverse them instead.' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER journal_entries_posted_are_final BEFORE UPDATE OR DELETE ON "journal_entries" FOR EACH ROW EXECUTE FUNCTION journal_entries_posted_are_final();

CREATE FUNCTION journal_lines_posted_are_final() RETURNS trigger AS $$
DECLARE
  entry uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."entry_id" ELSE NEW."entry_id" END;
BEGIN
  IF EXISTS (SELECT 1 FROM "journal_entries" WHERE "id" = entry AND "status" = 'posted') THEN
    RAISE EXCEPTION 'Lines of a posted entry can''t change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER journal_lines_posted_are_final BEFORE INSERT OR UPDATE OR DELETE ON "journal_lines" FOR EACH ROW EXECUTE FUNCTION journal_lines_posted_are_final();
