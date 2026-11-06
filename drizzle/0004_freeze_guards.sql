-- More guards so confirmed data stays as confirmed even if application code is wrong (brief 8.11, 8.15).
-- Deleting a whole session (retention cleanup) still works: cascaded deletes run inside referential-action triggers,
-- so pg_trigger_depth() > 1 there.

CREATE FUNCTION salo_snapshot_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'confirmed_round_snapshots cannot be deleted';
END $$;
--> statement-breakpoint
CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON confirmed_round_snapshots
  FOR EACH ROW EXECUTE FUNCTION salo_snapshot_no_delete();
--> statement-breakpoint
CREATE FUNCTION salo_round_stays_confirmed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CONFIRMED' AND (NEW.status <> 'CONFIRMED' OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
    RAISE EXCEPTION 'a confirmed round cannot be reopened';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rounds_stay_confirmed BEFORE UPDATE ON rounds
  FOR EACH ROW EXECUTE FUNCTION salo_round_stays_confirmed();
--> statement-breakpoint
CREATE FUNCTION salo_entry_no_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF (SELECT status FROM rounds WHERE id = OLD.round_id) = 'CONFIRMED' THEN
    RAISE EXCEPTION 'entries of a confirmed round cannot be deleted';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER entries_no_hard_delete BEFORE DELETE ON order_entries
  FOR EACH ROW EXECUTE FUNCTION salo_entry_no_hard_delete();
--> statement-breakpoint
CREATE FUNCTION salo_correction_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  IF (SELECT status FROM rounds WHERE id = OLD.target_round_id) = 'CONFIRMED' THEN
    RAISE EXCEPTION 'corrections already given to the waiter cannot change';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER corrections_frozen BEFORE UPDATE OR DELETE ON order_corrections
  FOR EACH ROW EXECUTE FUNCTION salo_correction_frozen();
--> statement-breakpoint
-- Deleting a session cascades to its participants, which sets confirmed_by to NULL on snapshots; that automatic
-- change must pass, or retention cleanup could never delete a confirmed order. Direct updates stay refused.
CREATE OR REPLACE FUNCTION salo_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'confirmed_round_snapshots are immutable';
END $$;
