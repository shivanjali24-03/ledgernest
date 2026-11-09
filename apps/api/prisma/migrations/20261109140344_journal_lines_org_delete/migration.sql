-- Deleting an organisation may remove its journal lines before their entries;
-- like the entries themselves, lines may go when the whole organisation is being deleted.
CREATE OR REPLACE FUNCTION journal_lines_posted_are_final() RETURNS trigger AS $$
DECLARE
  entry uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."entry_id" ELSE NEW."entry_id" END;
  org uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."organization_id" ELSE NEW."organization_id" END;
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "organizations" WHERE "id" = org) THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM "journal_entries" WHERE "id" = entry AND "status" = 'posted') THEN
    RAISE EXCEPTION 'Lines of a posted entry can''t change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
