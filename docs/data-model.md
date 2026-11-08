# Data model

PostgreSQL, defined in `src/server/db/schema.ts`; migrations in `drizzle/` (applied automatically at startup). Every table hangs off `sessions` with `ON DELETE CASCADE`, so deleting a session removes everything that belongs to it.

## Tables

| Table | Purpose |
|---|---|
| `sessions` | One table's ordering session. `status` OPEN/CLOSED, `revision` (+1 per committed change), `join_code` (6-character typed code), `last_activity_at`, `closed_at`, `expires_at` (when cleanup deletes it). |
| `participants` | Host or guest identity. Display names may repeat; identity is the id. Exactly one HOST per session. `removed_at`/`removed_reason` (≤140) when the host removes a guest; CHECK: only guests can be removed (`0005`). |
| `participant_credentials` | SHA-256 hash of each participant's cookie token (raw tokens are never stored). Type HOST or GUEST. |
| `rounds` | Ordering rounds, numbered from 1. DRAFT or CONFIRMED. At most one DRAFT per session. |
| `participant_round_readiness` | "I'm ready" per participant per round, with the revision they acknowledged. |
| `dishes` | Session-scoped dish names: `canonical_name` as first typed, `normalized_name` unique per session. |
| `order_groups`, `order_group_members` | Optional members for a collective group, keyed by `normalized_label` (unique per session). Group orders are matched to a group by label; membership never assigns dishes. |
| `order_batches` | Who an entry is for (`attribution_type` INDIVIDUAL/GROUP/TABLE/UNASSIGNED) and who submitted it (owner). |
| `order_entries` | Source entries: dish, quantity 1–99, variant, instructions, own revision, soft delete (`deleted_at`) for Undo. |
| `confirmed_round_snapshots` | Immutable JSON snapshot taken when the host confirms a round. |
| `order_corrections` | Changes to confirmed rounds, carried on the next round's waiter ticket. |
| `entry_claims` | A guest asking the host to hand over an entry recorded for them. |
| `mutation_records` | Idempotency: (session, actor, key) unique; retries return the stored result. |
| `session_events` | Durable, ordered event log (unique per session + revision) used for real-time replay. |
| `entry_settlements` | KKB, per source entry: `unit_price_centavos` (null = unknown, 0–9,999,999), optional host-chosen payer for a shared or unassigned dish (`bill_to_participant_id` or `bill_to_label`, at most one), own `revision`. Separate from `order_entries` so prices can change after a round is confirmed without touching frozen order data. |
| `correction_settlements` | KKB: price each for a replacement correction ("Change it to …"), host only, own `revision`. |

`sessions` also holds the receipt's service charge: `service_charge_centavos` (null = not entered, 0 = none on the receipt, max 99,999,999) and `service_charge_revision`. Existing sessions and entries load with no prices (`0007_settlement`).

## Integrity rules enforced by the database

- CHECK constraints on every status/role/type enum, `quantity BETWEEN 1 AND 99`, `revision >= 0`, and status/timestamp agreement (CLOSED ⇔ `closed_at`, CONFIRMED ⇔ `confirmed_at`).
- Partial unique indexes: one DRAFT round per session, one HOST per session, one pending claim per batch and requester.
- Triggers (`drizzle/0001_integrity_triggers.sql`): a confirmed snapshot can never be updated; a session revision can never go backwards; entries of a confirmed round cannot be inserted or updated.
- `drizzle/0006_integrity_v2.sql`:
  - an entry can't move out of a confirmed round;
  - an entry must sit in its batch's round, in the same session;
  - a batch's round is in its session, and a confirmed round's batches keep their attribution and submitter frozen;
  - claims and group members stay inside one session.
- An order past `expires_at` is treated as gone at once (credentials, invite, join, changes), and the hourly cleanup deletes it.
- More triggers (`drizzle/0004_freeze_guards.sql`): a confirmed round cannot be reopened; snapshots, entries of confirmed rounds and corrections already given to the waiter cannot be deleted or changed, except when a whole session is deleted (cascade).
- `drizzle/0007_settlement.sql`: settlement rows stay in their session (entry via its batch, correction, bill-to person); CHECKs on amounts and revisions.
- Covered by `tests/db-integrity.test.ts`, `tests/rounds.test.ts` and `tests/settlement.test.ts`.

## Deviations from brief section 8

- `sessions.active_round_id` is not stored: the active round is the session's DRAFT round (or its latest round when none is draft), which avoids a circular foreign key.
- `order_entries.variant_data` is a plain `variant` text column (size or variant as typed).
- `entry_claims` is added: section 10 lists claim endpoints but section 8 has no table for them.
- `order_corrections.target_round_id` is added: the draft round whose waiter ticket carries the correction.
- `order_batches.group_id` links a batch to an optional `order_groups` row; `collective_label` still works without one.

## KKB calculation

`src/lib/kkb.ts`, pure, integer centavos, the one calculation for the view (and any future export):

- Confirmed entries only, per source entry: confirmed quantity cancellations lower the count; a confirmed replacement becomes "A → B" priced by its correction's price. Pending corrections are flagged, not applied.
- Payer = the entry's individual attribution (joined person by id, or a typed name); otherwise the host's Bill to; otherwise it stays in a shared section (group, Whole table, Not assigned). Group membership never picks a payer.
- Labels: Food subtotal (all priced, nothing pending), Priced subtotal (+ items without a price), No prices entered. Drafts are listed as Not yet confirmed and never counted.
- Service charge: allocated only when nothing confirmed is unpriced, unbilled-shared or pending and the eligible food is above zero. Largest remainder in BigInt: floor shares, leftover centavos to the largest remainders, ties by payer key; shares add up exactly to the charge.

## Consolidation

`src/lib/consolidate.ts`, pure and derived from source entries (never stored):

- **Dish identity**: `dishes.normalized_name` = NFKC, trimmed, repeated spaces collapsed, lower-cased (`src/lib/dish-name.ts`). "Chicken Katsu" and "chicken  katsu" are one dish; "Chicken Cutlet" never matches. The displayed name is the first one typed.
- **Preparation key**: dish id + normalized variant + normalized instructions. Entries with the same key add up; different sizes or instructions stay separate lines under the dish heading ("Regular ×2", "No sauce ×1").
- **Consolidated quantity** = sum of active (not removed) entry quantities per preparation; the dish total is the sum of its preparations.
- **Order**: dishes in the order first added; within a dish the plain preparation first, then others as they first appeared.
- Editing never happens on a consolidated line: steppers act on one source entry, so nobody's entry changes because of someone else's (brief 6.4).
