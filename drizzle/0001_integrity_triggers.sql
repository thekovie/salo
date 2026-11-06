-- Integrity rules the application must not be able to break (brief 8.11, 8.15).
-- 1. A confirmed snapshot is immutable: no UPDATE, ever.
CREATE FUNCTION salo_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'confirmed_round_snapshots are immutable';
END $$;
--> statement-breakpoint
CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON confirmed_round_snapshots
  FOR EACH ROW EXECUTE FUNCTION salo_snapshot_immutable();
--> statement-breakpoint
-- 2. A session's revision only ever moves forward.
CREATE FUNCTION salo_revision_monotonic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision < OLD.revision THEN
    RAISE EXCEPTION 'session revision cannot go backwards (% -> %)', OLD.revision, NEW.revision;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sessions_revision_forward BEFORE UPDATE OF revision ON sessions
  FOR EACH ROW EXECUTE FUNCTION salo_revision_monotonic();
--> statement-breakpoint
-- 3. Entries of a confirmed round cannot be changed directly; corrections go through order_corrections.
CREATE FUNCTION salo_entry_round_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM rounds WHERE id = COALESCE(NEW.round_id, OLD.round_id)) = 'CONFIRMED' THEN
    RAISE EXCEPTION 'entries of a confirmed round cannot be modified';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER entries_draft_only BEFORE INSERT OR UPDATE ON order_entries
  FOR EACH ROW EXECUTE FUNCTION salo_entry_round_draft();
