-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "system_key" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_organization_id_parent_id_idx" ON "accounts"("organization_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organization_id_id_key" ON "accounts"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organization_id_code_key" ON "accounts"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organization_id_system_key_key" ON "accounts"("organization_id", "system_key");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_parent_id_fkey" FOREIGN KEY ("organization_id", "parent_id") REFERENCES "accounts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Names are unique per organisation ignoring case, so "Bank" and "bank" can't both exist
CREATE UNIQUE INDEX "accounts_organization_id_name_ci_key" ON "accounts" ("organization_id", lower("name"));

-- The same rules as the application, so no code path can store a malformed account
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_type_check" CHECK ("type" IN ('asset', 'liability', 'equity', 'income', 'expense')),
  ADD CONSTRAINT "accounts_code_check" CHECK ("code" ~ '^[0-9A-Z][0-9A-Z.-]{0,11}$'),
  ADD CONSTRAINT "accounts_system_key_check" CHECK ("system_key" IS NULL OR "system_key" IN ('retained_earnings', 'opening_balance_equity')),
  ADD CONSTRAINT "accounts_not_own_parent_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

-- A sub-account has the same type as its parent, and a parent's type can't drift away from its children
CREATE FUNCTION accounts_same_type_as_parent() RETURNS trigger AS $$
BEGIN
  IF NEW."parent_id" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "accounts" p WHERE p."id" = NEW."parent_id" AND p."type" <> NEW."type"
  ) THEN
    RAISE EXCEPTION 'A sub-account must have the same type as its parent' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."type" <> OLD."type" AND EXISTS (
    SELECT 1 FROM "accounts" c WHERE c."parent_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'An account with sub-accounts can''t change type' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_same_type_as_parent
  BEFORE INSERT OR UPDATE OF "type", "parent_id" ON "accounts"
  FOR EACH ROW EXECUTE FUNCTION accounts_same_type_as_parent();
