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

TABLES=(sessions participants rounds dishes order_batches order_entries confirmed_round_snapshots order_corrections session_events)

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

echo "4/4 checking the restored schema enforces its rules (a zero quantity must be refused)"
if run psql "${run_env[@]}" -d "$SCRATCH" -qc "INSERT INTO order_entries (batch_id, round_id, dish_id, quantity) SELECT batch_id, round_id, dish_id, 0 FROM order_entries LIMIT 1" 2>/dev/null; then
  rows=$(run psql "${run_env[@]}" -d "$SCRATCH" -Atc "SELECT count(*) FROM order_entries WHERE quantity = 0")
  [[ "$rows" == "0" ]] || { echo "FAIL: constraints missing after restore"; exit 1; }
fi
echo "PASS: backup $DUMP restores with identical row counts"
