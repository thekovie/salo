#!/usr/bin/env bash
# Backup and restore drill (brief 12.3: "periodic restoration testing").
# Takes a custom-format dump of the Salo database, restores it into a scratch database on the same server, compares
# row counts table by table, then drops the scratch database. Nothing in the source database is changed.
#
# Local (docker compose):  scripts/backup-restore-drill.sh
# Elsewhere:               PGHOST=... PGUSER=... PGPASSWORD=... SALO_DB=salo scripts/backup-restore-drill.sh
# Restoring a real backup: see docs/backups.md.
set -euo pipefail

SALO_DB="${SALO_DB:-salo}"
SCRATCH="salo_restore_drill_$(date +%s)"
OUT_DIR="${OUT_DIR:-backups}"
mkdir -p "$OUT_DIR"
DUMP="$OUT_DIR/${SALO_DB}-$(date -u +%Y%m%dT%H%M%SZ).dump"

if [[ -z "${PGHOST:-}" ]]; then
  # Default: the compose database, through its container (no client tools needed on the host).
  run() { docker compose exec -T db "$@"; }
  export PGUSER="${PGUSER:-salo}"
  run_env=(-U "$PGUSER")
else
  run() { "$@"; }
  run_env=()
fi

# Every table in the schema (src/server/db/schema.ts).
TABLES=(sessions participants participant_credentials rounds participant_round_readiness dishes order_batches order_groups order_group_members order_entries entry_claims confirmed_round_snapshots order_corrections mutation_records session_events)

counts() {
  local db=$1 out=""
  for t in "${TABLES[@]}"; do
    out+="$t=$(run psql "${run_env[@]}" -d "$db" -Atc "SELECT count(*) FROM $t") "
  done
  echo "$out"
}

echo "1/4 dumping $SALO_DB -> $DUMP"
run pg_dump "${run_env[@]}" -d "$SALO_DB" -Fc > "$DUMP"
[[ -s "$DUMP" ]] || { echo "FAIL: empty dump"; exit 1; }

echo "2/4 restoring into scratch database $SCRATCH"
run psql "${run_env[@]}" -d postgres -qc "CREATE DATABASE \"$SCRATCH\""
trap 'run psql "${run_env[@]}" -d postgres -qc "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null' EXIT
run pg_restore "${run_env[@]}" -d "$SCRATCH" --no-owner --exit-on-error < "$DUMP"

echo "3/4 comparing row counts"
before=$(counts "$SALO_DB")
after=$(counts "$SCRATCH")
echo "    source:   $before"
echo "    restored: $after"
[[ "$before" == "$after" ]] || { echo "FAIL: row counts differ"; exit 1; }

echo "4/4 checking the restored schema still enforces its rules (each probe must be refused)"
# A self-contained fixture inside a transaction that is rolled back: it doesn't depend on the backup having rows,
# and leaves the scratch database as restored. Every probe must fail with its rule; anything else fails the drill.
run psql "${run_env[@]}" -d "$SCRATCH" -v ON_ERROR_STOP=1 -q <<'SQL'
BEGIN;
DO $$
DECLARE s uuid; host uuid; r uuid; d uuid; b uuid;
BEGIN
  INSERT INTO sessions (join_code, expires_at) VALUES ('DRILL1', now() + interval '1 day') RETURNING id INTO s;
  INSERT INTO participants (session_id, display_name, role) VALUES (s, 'Drill host', 'HOST') RETURNING id INTO host;
  INSERT INTO rounds (session_id, round_number) VALUES (s, 1) RETURNING id INTO r;
  INSERT INTO dishes (session_id, canonical_name, normalized_name) VALUES (s, 'Drill', 'drill') RETURNING id INTO d;
  INSERT INTO order_batches (session_id, round_id, submitted_by, attribution_type) VALUES (s, r, host, 'TABLE') RETURNING id INTO b;
  INSERT INTO order_entries (batch_id, round_id, dish_id, quantity) VALUES (b, r, d, 1);

  BEGIN INSERT INTO order_entries (batch_id, round_id, dish_id, quantity) VALUES (b, r, d, 0);
    RAISE EXCEPTION 'DRILL FAILED: a zero quantity was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN UPDATE participants SET removed_at = now() WHERE id = host;
    RAISE EXCEPTION 'DRILL FAILED: the host could be removed';
  EXCEPTION WHEN check_violation THEN NULL; END;

  UPDATE rounds SET status = 'CONFIRMED', confirmed_at = now() WHERE id = r;
  INSERT INTO confirmed_round_snapshots (round_id, snapshot_revision, snapshot_data) VALUES (r, 1, '{}');

  BEGIN UPDATE confirmed_round_snapshots SET snapshot_data = '{"x":1}' WHERE round_id = r;
    RAISE EXCEPTION 'DRILL FAILED: a confirmed snapshot could be changed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'DRILL FAILED%' THEN RAISE; END IF; END;

  BEGIN UPDATE rounds SET status = 'DRAFT', confirmed_at = NULL WHERE id = r;
    RAISE EXCEPTION 'DRILL FAILED: a confirmed round could be reopened';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'DRILL FAILED%' THEN RAISE; END IF; END;

  BEGIN UPDATE order_batches SET attribution_type = 'UNASSIGNED' WHERE id = b;
    RAISE EXCEPTION 'DRILL FAILED: a confirmed dish''s attribution could be changed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'DRILL FAILED%' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
SQL
echo "PASS: backup $DUMP restores with identical row counts"
