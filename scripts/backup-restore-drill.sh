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
  [[ -n "${PGUSER:-}" ]] && run_env+=(-U "$PGUSER")
  [[ -n "${PGPORT:-}" ]] && run_env+=(-p "$PGPORT")
fi

# Every base table in the public schema, read from the source (drizzle's migrations table lives in schema "drizzle").
TABLES=()
while IFS= read -r t; do [[ -n "$t" ]] && TABLES+=("$t"); done < <(run psql "${run_env[@]}" -d "$SALO_DB" -Atc "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1" | tr -d '\r')
[[ ${#TABLES[@]} -gt 0 ]] || { echo "FAIL: no tables found in $SALO_DB"; exit 1; }

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

echo "4/4 checking the restored schema still enforces its rules (each probe must be refused by the named rule)"
# A self-contained fixture inside a transaction that is rolled back: it doesn't depend on the backup having rows,
# and leaves the scratch database as restored. Each probe must fail with its named constraint; anything else fails the drill.
run psql "${run_env[@]}" -d "$SCRATCH" -v ON_ERROR_STOP=1 -q <<'SQL'
BEGIN;
-- Runs stmt and requires a CHECK violation of exactly the constraint named want.
CREATE FUNCTION pg_temp.expect_check(want text, stmt text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE c text;
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'DRILL FAILED: % was not enforced', want;
EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS c = CONSTRAINT_NAME;
  IF c IS DISTINCT FROM want THEN RAISE EXCEPTION 'DRILL FAILED: expected %, got %', want, c; END IF;
END $f$;
DO $$
DECLARE s uuid; host uuid; r uuid; d uuid; b uuid; e uuid; adj uuid; corr uuid;
BEGIN
  INSERT INTO sessions (join_code, expires_at) VALUES ('DRILL1', now() + interval '1 day') RETURNING id INTO s;
  INSERT INTO participants (session_id, display_name, role) VALUES (s, 'Drill host', 'HOST') RETURNING id INTO host;
  INSERT INTO rounds (session_id, round_number) VALUES (s, 1) RETURNING id INTO r;
  INSERT INTO dishes (session_id, canonical_name, normalized_name) VALUES (s, 'Drill', 'drill') RETURNING id INTO d;
  INSERT INTO order_batches (session_id, round_id, submitted_by, attribution_type) VALUES (s, r, host, 'TABLE') RETURNING id INTO b;
  INSERT INTO order_entries (batch_id, round_id, dish_id, quantity) VALUES (b, r, d, 1) RETURNING id INTO e;
  INSERT INTO adjustments (id, session_id, direction, category, method, amount_centavos)
    VALUES (gen_random_uuid(), s, 'discount', 'promo', 'manual', 100) RETURNING id INTO adj;
  INSERT INTO order_corrections (session_id, source_round_id, target_round_id, correction_type)
    VALUES (s, r, r, 'CANCEL') RETURNING id INTO corr;

  PERFORM pg_temp.expect_check('order_entries_quantity_ck', format('INSERT INTO order_entries (batch_id, round_id, dish_id, quantity) VALUES (%L, %L, %L, 0)', b, r, d));
  PERFORM pg_temp.expect_check('participants_removed_ck', format('UPDATE participants SET removed_at = now() WHERE id = %L', host));
  PERFORM pg_temp.expect_check('entry_settlements_price_ck', format('INSERT INTO entry_settlements (entry_id, session_id, unit_price_centavos) VALUES (%L, %L, -1)', e, s));
  PERFORM pg_temp.expect_check('entry_settlements_price_ck', format('INSERT INTO entry_settlements (entry_id, session_id, unit_price_centavos) VALUES (%L, %L, 10000000)', e, s));
  PERFORM pg_temp.expect_check('correction_settlements_price_ck', format('INSERT INTO correction_settlements (correction_id, session_id, unit_price_centavos) VALUES (%L, %L, -1)', corr, s));
  PERFORM pg_temp.expect_check('shared_prices_price_ck', format('INSERT INTO shared_prices (session_id, dish_id, variant_key, unit_centavos) VALUES (%L, %L, '''', -1)', s, d));
  PERFORM pg_temp.expect_check('served_counts_served_ck', format('INSERT INTO served_counts (session_id, round_id, line_key, served) VALUES (%L, %L, ''k'', -1)', s, r));
  PERFORM pg_temp.expect_check('payments_amount_ck', format('INSERT INTO payments (id, session_id, participant_id, amount_centavos) VALUES (gen_random_uuid(), %L, %L, 0)', s, host));
  PERFORM pg_temp.expect_check('payments_amount_ck', format('INSERT INTO payments (id, session_id, participant_id, amount_centavos) VALUES (gen_random_uuid(), %L, %L, -1)', s, host));
  PERFORM pg_temp.expect_check('adjustments_amount_ck', format('INSERT INTO adjustments (id, session_id, direction, category, method, amount_centavos) VALUES (gen_random_uuid(), %L, ''discount'', ''promo'', ''manual'', 0)', s));
  PERFORM pg_temp.expect_check('adjustments_percent_ck', format('INSERT INTO adjustments (id, session_id, direction, category, method, percent_bps) VALUES (gen_random_uuid(), %L, ''discount'', ''promo'', ''proportional'', 10001)', s));
  PERFORM pg_temp.expect_check('adjustments_one_amount_ck', format('INSERT INTO adjustments (id, session_id, direction, category, method) VALUES (gen_random_uuid(), %L, ''discount'', ''promo'', ''manual'')', s));
  PERFORM pg_temp.expect_check('adjustment_shares_amount_ck', format('INSERT INTO adjustment_shares (adjustment_id, session_id, participant_id, amount_centavos) VALUES (%L, %L, %L, -1)', adj, s, host));
  PERFORM pg_temp.expect_check('receipts_total_ck', format('INSERT INTO receipts (id, session_id, total_centavos) VALUES (gen_random_uuid(), %L, -1)', s));
  PERFORM pg_temp.expect_check('sessions_service_charge_ck', format('UPDATE sessions SET service_charge_centavos = 100000000 WHERE id = %L', s));
  PERFORM pg_temp.expect_check('sessions_receipt_total_ck', format('UPDATE sessions SET receipt_total_centavos = 100000000 WHERE id = %L', s));

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
echo "PASS: backup $DUMP restores with identical row counts for ${#TABLES[@]} tables, every probe named its constraint"
