-- Integrity rules, part 2 (PRD review). Whole-session deletion (retention cleanup) still works: cascaded actions
-- run inside referential-action triggers, so pg_trigger_depth() > 1 there.

-- 1. Entries: a confirmed round's entries can't change, including moving one OUT of a confirmed round (the old
--    check only looked at the new round). An entry also lives in its batch's round, inside the same session.
CREATE OR REPLACE FUNCTION salo_entry_round_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  batch_round uuid;
  batch_session uuid;
  round_session uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' AND (SELECT status FROM rounds WHERE id = OLD.round_id) = 'CONFIRMED' THEN
    RAISE EXCEPTION 'entries of a confirmed round cannot be modified';
  END IF;
  IF (SELECT status FROM rounds WHERE id = NEW.round_id) = 'CONFIRMED' THEN
    RAISE EXCEPTION 'entries of a confirmed round cannot be modified';
  END IF;
  SELECT round_id, session_id INTO batch_round, batch_session FROM order_batches WHERE id = NEW.batch_id;
  SELECT session_id INTO round_session FROM rounds WHERE id = NEW.round_id;
  IF batch_round IS DISTINCT FROM NEW.round_id OR batch_session IS DISTINCT FROM round_session THEN
    RAISE EXCEPTION 'an entry must belong to its batch''s round, in the same session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 2. Batches: who a dish is for and who submitted it are frozen once its round is confirmed (the "who ordered what"
--    summary reads them). A batch's round must be in the batch's session.
CREATE FUNCTION salo_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF (SELECT session_id FROM rounds WHERE id = NEW.round_id) IS DISTINCT FROM NEW.session_id THEN
    RAISE EXCEPTION 'a batch''s round must belong to the same session';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF (SELECT status FROM rounds WHERE id = NEW.round_id) = 'CONFIRMED' THEN
      RAISE EXCEPTION 'cannot add a batch to a confirmed round';
    END IF;
    RETURN NEW;
  END IF;
  IF (SELECT status FROM rounds WHERE id = OLD.round_id) = 'CONFIRMED' AND (
       NEW.round_id IS DISTINCT FROM OLD.round_id
    OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
    OR NEW.attribution_type IS DISTINCT FROM OLD.attribution_type
    OR NEW.attributed_participant_id IS DISTINCT FROM OLD.attributed_participant_id
    OR NEW.group_id IS DISTINCT FROM OLD.group_id
    OR NEW.collective_label IS DISTINCT FROM OLD.collective_label) THEN
    RAISE EXCEPTION 'attribution of a confirmed round cannot be changed';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER batches_guard BEFORE INSERT OR UPDATE ON order_batches
  FOR EACH ROW EXECUTE FUNCTION salo_batch_guard();
--> statement-breakpoint
-- 3. Claims and group members stay inside one session.
CREATE FUNCTION salo_claim_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT session_id FROM order_batches WHERE id = NEW.batch_id) IS DISTINCT FROM NEW.session_id
     OR (SELECT session_id FROM participants WHERE id = NEW.requested_by) IS DISTINCT FROM NEW.session_id THEN
    RAISE EXCEPTION 'a claim must stay inside one session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER claims_same_session BEFORE INSERT OR UPDATE OF batch_id, requested_by, session_id ON entry_claims
  FOR EACH ROW EXECUTE FUNCTION salo_claim_same_session();
--> statement-breakpoint
CREATE FUNCTION salo_member_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT session_id FROM order_groups WHERE id = NEW.group_id) IS DISTINCT FROM (SELECT session_id FROM participants WHERE id = NEW.participant_id) THEN
    RAISE EXCEPTION 'a group member must be in the group''s session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER members_same_session BEFORE INSERT OR UPDATE ON order_group_members
  FOR EACH ROW EXECUTE FUNCTION salo_member_same_session();
