# Backups and restore

Backups protect against losing the database (disk failure, a bad migration, a deleted volume). They are separate from retention: the live database deletes closed orders 7 days after closing and quiet orders after 30 days (brief 12.1–12.2), while backups keep whatever existed when they were taken, for as long as the backup retention below says.

## Schedule (Coolify)

On the **Salo PostgreSQL** resource (not `coolify-db`):

1. **Backups → Scheduled backup**: daily (e.g. `0 3 * * *`, 03:00 Asia/Manila), database `salo`.
2. **Off-VPS destination**: add an S3-compatible storage (Backblaze B2, Cloudflare R2, AWS S3, Wasabi…) under *Settings → S3 storages*, then tick it on the scheduled backup. A copy on the same VPS alone is not a backup (brief 12.3).
3. **Retention**: keep 14 daily backups locally and 30 on S3 (Coolify "number of backups to keep"). Backups older than that are deleted by Coolify; that is the only place order data outlives the live retention.
4. **Failure alerts**: *Notifications* → enable email (or Telegram/Discord) for "Backup failed". Coolify also shows the last run on the resource.

## Restore (production)

When the live database is lost or must be rolled back:

1. In Coolify, stop the **Salo app** resource (so nothing writes during the restore).
2. On the PostgreSQL resource, *Backups* → pick the backup → **Restore**. Coolify runs `pg_restore` into the `salo` database.
   Manual alternative from a downloaded dump:
   ```bash
   docker exec -i <salo-postgres-container> psql -U <user> -d postgres -c 'DROP DATABASE salo WITH (FORCE)' -c 'CREATE DATABASE salo'
   docker exec -i <salo-postgres-container> pg_restore -U <user> -d salo --no-owner --exit-on-error < salo-YYYYMMDD.dump
   ```
3. Start the app. It applies any newer migrations at startup and logs `salo started`; `/api/health` returns 200.
4. Expect: orders created after the backup are gone; people with those links see "Wala dito." Orders past their deletion date are removed again within the hour by the cleanup job.

## Restore drill (periodic test)

`scripts/backup-restore-drill.sh` dumps the database, restores the dump into a scratch database on the same server, compares row counts for **every table** (all 15 in `schema.ts`), then checks that the restored schema still enforces its rules, and drops the scratch database. It never changes the source database.

The rule checks build their own fixture inside a transaction that is rolled back, so they work even on an empty backup. Each probe must be refused with its rule, or the drill fails:
- a zero quantity;
- removing the host;
- changing a confirmed snapshot;
- reopening a confirmed round;
- changing a confirmed dish's attribution.

- Locally: `pnpm db:up && scripts/backup-restore-drill.sh`. Last run 2026-11-07: PASS, with all 15 tables identical (855 sessions, 4,963 entries, 7,143 events), and all five probes refused. The first attempt that day correctly failed on a database that hadn't applied migration 0006 yet.
- Production: run it monthly against a **downloaded Coolify backup** restored into a throwaway PostgreSQL (e.g. `docker run --rm -e POSTGRES_HOST_AUTH_METHOD=trust -p 5499:5432 postgres:17-alpine`, then `PGHOST=localhost PGPORT=5499 PGUSER=postgres SALO_DB=salo scripts/backup-restore-drill.sh` after `pg_restore`). Record the date in HANDOFF.md.

Not yet done (owner): configure the schedule, S3 destination and alerts in Coolify, and run the first production restore test.
