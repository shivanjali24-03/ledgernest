-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actor_email" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- Keep "who did it" on existing entries
UPDATE "audit_logs" a SET "actor_email" = u."email" FROM "users" u WHERE a."actor_id" = u."id" AND a."actor_email" IS NULL;

-- Every new entry records the actor's email at the moment it is written
CREATE FUNCTION audit_logs_fill_actor_email() RETURNS trigger AS $$
BEGIN
  IF NEW."actor_id" IS NOT NULL AND NEW."actor_email" IS NULL THEN
    SELECT "email" INTO NEW."actor_email" FROM "users" WHERE "id" = NEW."actor_id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_fill_actor_email
  BEFORE INSERT ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_fill_actor_email();

-- Append-only: entries can never be edited, deleted or truncated.
-- The single exception is the database itself clearing actor_id / organization_id
-- when that user or organisation is deleted (ON DELETE SET NULL); nothing else may change.
CREATE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW."id", NEW."action", NEW."actor_email", NEW."entity_type", NEW."entity_id", NEW."before", NEW."after", NEW."ip", NEW."user_agent", NEW."created_at")
         IS NOT DISTINCT FROM
         (OLD."id", OLD."action", OLD."actor_email", OLD."entity_type", OLD."entity_id", OLD."before", OLD."after", OLD."ip", OLD."user_agent", OLD."created_at")
     AND (NEW."actor_id" IS NOT DISTINCT FROM OLD."actor_id" OR NEW."actor_id" IS NULL)
     AND (NEW."organization_id" IS NOT DISTINCT FROM OLD."organization_id" OR NEW."organization_id" IS NULL)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only_rows
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

CREATE TRIGGER audit_logs_append_only_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
