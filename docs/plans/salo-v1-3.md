# Salo v1.3: dining coordination (plan)

Owner's brief, kept in full: [`salo-v1-3-brief.md`](salo-v1-3-brief.md). Phase 0 audit: [`salo-v1-3-audit.md`](salo-v1-3-audit.md). Baseline screenshots: `.shots/before/` (git-ignored).

Status: **slices 0–6 and phase 7 are done.** Slice 8 is planned; its decisions are pending.

Each slice ships as its own branch and PR into `main`, per HANDOFF working rules (typecheck, lint, tests, build, CI, owner go).

## Ask ledger

| # | Owner's words (brief) | Planned change | Slice | Status |
|---|---|---|---|---|
| A1 | "Conduct a comprehensive interface and usability audit" (§4) | Code trace + browser baseline at 320–1280 + a11y/mobile audit → `salo-v1-3-audit.md`, with code-inspected vs browser-observed vs hypothesis kept apart | 0 | done (draft, `salo-v1-3-audit.md`) |
| A2 | "Make Add variant / Add instructions visibly accessible… Separate recipient selection from dish configuration" (F01) | Composer: visible "+ Size", "+ Note", "+ Price" chips under the dish field; *For* panel holds only recipients | 1 | done (slice 1, verified) |
| A3 | "Display entered details before submission" (F01) | Details appear as removable chips in the composer before Add | 1 | done (slice 1, verified) |
| A4 | "Suggest previously used variants within the same session" (F01) | Size field suggests variants already used for that dish (from `snapshot.entries`, no server change) | 1 | done (slice 1, verified) |
| A5 | "Support user-confirmed splitting of plausible comma-separated descriptions… Never automatically rewrite dish names" (F01) | When the dish name has a comma, offer a split showing exactly what goes where (rule in Pinned details); Split / Keep as typed. Never auto-applied | 1 | done (slice 1, verified) |
| A6 | "Apply consistent interactions to editing screens" (F01) | Edit dish sheet uses the same Size/Note/Price chip layout | 1 | done (slice 1, verified) |
| A7 | "Critical issues discovered during the initial UX audit should be addressed before or alongside" (§11) | Items vs KKB disagree on pending corrections: align (D5); plus audit Critical/High items in the slice that touches them | 1 | done (slice 1, verified) |
| A8 | "Introduce session-scoped default prices… Price Resolution: override → shared default → unknown" (F02) | `shared_prices` table keyed by dish + size (D2); KKB resolver falls back to it; host sets defaults | 2 | done (slice 2, verified) |
| A9 | "Give hosts control over shared defaults… Allow explicit entry-level overrides" (F02) | Host price edit sets the default for that preparation; "Only this line" makes an override; guest prices stay overrides on their own entries (D3) | 2 | done (slice 2, verified) |
| A10 | "Introduce a Mark unavailable workflow" (F03) | Host "Unavailable" on a dish: draft round → removes all matching entries in one change with Undo; confirmed round → cancellation corrections (D4) | 3 | done (slice 3, verified) |
| A11 | "Support partial cancellations… Distinguish pending and communicated corrections" (F03/F04) | One correction drawer: Cancel some (across all entries of a preparation, one batch) / Replace / Unavailable; pending vs told-the-waiter labels | 3 | done (slice 3, verified) |
| A12 | "Avoid introducing redundant correction records" (F04) | Batch mutation writes one correction per affected source entry in one change (needed for per-person billing), shown as one row | 3 | done (slice 3, verified) |
| A13 | "Add a notification center accessible from the session header" (F05) | Bell in header row 1 with unread count → drawer list, mark all read | 5 | done (slice 5, verified) |
| A14 | "Persist meaningful notifications… recipient eligibility and read state… reconnect and replay" (F05) | `notifications` + `notification_reads` tables written in the same transaction as the triggering change; delivered via the per-actor snapshot | 5 | done (slice 5, verified) |
| A15 | "Food Arrival Tracker… derive expected items from confirmed orders… partial deliveries" (F06) | `served_counts` per round × preparation (or replacement); "Served" section on the Order tab once a round is confirmed; host steppers; everyone views | 4 | done (slice 4, verified) |
| A16 | "If outstanding items remain, present an informative warning rather than a hard block" (F06) | End-order sheet adds "n dishes still waiting" line | 4 | done (slice 4, verified) |
| A17 | "Allow hosts to enter the final restaurant receipt total… calculate discrepancies" (F07) | `sessions.receipt_total_centavos` + revision; KKB "Check against receipt" block: food + service charge vs receipt, difference shown, never distributed | 6 | done (slice 6, verified) |
| A18 | "Show pricing completeness… quick access to unresolved prices" (F08) | KKB status line always shows "8 of 10 preparations priced" (unit = distinct preparation lines as in Items; priced only when every entry in it resolves) with a jump to the first unpriced line | 6 | done (slice 6, verified) |
| A19 | "Provide a Copy summary action… Messenger-friendly plain-text" (F09) | KKB tab gets Copy summary (`kkbText()` next to `buildKkb`); Items copy stays price-free (D6) | 6 | done (slice 6, verified) |
| A20 | "Broaden Salo's positioning… Expanded value proposition" (§2.2) | Landing hero/How it works copy updated **after** tracker and settle features ship (last slice), tagline kept | 6 | done (slice 6, verified) |
| A21 | "Final usability validation and regression audit" (Phase 7) | `/workflow:verify` per slice; final re-run of baseline capture + axe at all widths; real-phone and real-user checks stay owner tasks | 7 | done (phase 7; real phones and real users remain owner tasks) |
| A23 | "After confirmation surface Food Tracker… Near completion emphasize outstanding food, pricing completeness…" (§7) | Tracker above What's next; KKB link stays in What's next; End sheet gets the waiting-dishes line; nothing else moves | 4, 6 | done (slice 4, verified) |
| A24 | "Confirm corrections: host only" (§9) | Confirming a correction = confirming the round that carries it (`rounds.ts:111`); no separate action | 3 | done (slice 3, verified) |
| A22 | "Mobile usability audit… 320–430, tablet, desktop" (§4.2) | Mobile scope decision (D1) | all | partial: layouts verified 320–1280 with no overflow; the D1 native-feel fixes (interactive-widget, dark theme-color, long-press guard, WebKit project) were not built, moved to slice 8 |

## Today (from the code trace)

- **Composer** nests size, notes and price two taps deep inside the recipient panel: `composer.tsx:166-176` (toggle "Size, notes or price" inside the *For* panel opened at `:137`). The *For* button's name is "Change who it's for, size, notes or price" (`:269`); the "has notes" dot is colour-only (`:175`). This is the likeliest reason variants get typed into the dish name. Data model already stores `variant` (≤40) and `special_instructions` (≤140) separately (`schema.ts:216`, `entries.ts:82-92`), so F01 is UI plus suggestion logic.
- **Edit dish sheet** shows flat size/notes inputs and no price (`edit-dish-sheet.tsx:83-96`).
- **Preparation identity** = `preparationKey` [dishId, normalized variant, normalized instructions] (`consolidate.ts:39`); name normalisation in `src/lib/dish-name.ts`.
- **Prices** are per entry (`entry_settlements`, PK `entry_id`, `schema.ts:343`); KKB reads them at `kkb.ts:157` and `:171`; no inheritance. Integer centavos; blank is null, never 0 (`money.ts:15`).
- **Corrections** need an open draft round (`rounds.ts:142`) and attach to one source entry ("up to N at a time", `rounds-view.tsx:138`). Pending = target round still draft; communicated = target confirmed (`rounds.ts:111`), frozen by trigger (`drizzle/0004:37-47`, UPDATE/DELETE only).
- **Bug, High: Items and KKB disagree on pending corrections.** KKB applies a correction only once its target round is confirmed (`kkb.ts:162-166`); Items/summary/copy text applies every correction at once (`summary.ts:28-40`, no target-round filter). A dish cancelled but not yet told to the waiter disappears from "Who ordered what → Items" while KKB still bills it.
- **Notifications**: none persisted. Toasts (one at a time, 6 s, `toasts.tsx`), "added" pills (`arrival-pills.tsx`), claims banner (`workspace.tsx:484`). SSE stream is session-wide, unfiltered (`stream.ts:56`); events are id-only signals and the client refetches the per-actor snapshot (`use-session.ts:280`), so per-recipient data must ride in `getSnapshot(db, actor)` (`snapshot.ts:17`).
- **Food tracking**: nothing exists. Confirmed snapshots hold labels only (`ticket.ts:29-36`), so expected quantities come from frozen confirmed entries minus confirmed corrections (logic at `kkb.ts:162-176`).
- **KKB status**: completeness only appears once a service charge is entered (`kkb.ts:206-218`, `kkb-view.tsx:105-129`). No receipt total. Copy text exists only in Items and says "no prices included" (`summary.ts:91-100`).
- **Navigation**: four tabs Order | People | Groups | Rounds (`view-tabs.tsx:6-13`); header row 1 has spare width right of the title (`session-header.tsx:32-52`); confirmed-round Order tab shows the stamped ticket + host "What's next?" (`workspace.tsx:527-559`).
- **Mutations**: all go through `runMutation` (`mutations.ts:42-104`: session row lock, idempotency, revision bump, `session_events`, `pg_notify`). New non-ticket events must join `NON_TICKET_EVENTS` (`settlement.ts:14`) or they make the host's confirm stale (`rounds.ts:82-88`).

## Approach

Build in the brief's order with one change: **tracker (F06) before notifications (F05)**, so the notification slice wires every event source once instead of retrofitting served events (D7).

| Slice | Content | Main files |
|---|---|---|
| 0 | Audit report | `docs/plans/salo-v1-3-audit.md` |
| 0.5 | Next.js 16.4.2 → 16.4.5 (D11), own PR | `package.json`, `pnpm-lock.yaml` |
| 1 | F01 composer + edit sheet; Items/KKB pending-correction alignment via one shared "effective order" function; colour-only notes dot goes away with the chips | `composer.tsx`, `edit-dish-sheet.tsx`, new `src/lib/dish-details.ts` (variant suggestions, comma split, pure), new `src/lib/effective-order.ts`, `summary.ts`, `kkb.ts`, `onboarding/guide-steps.ts`, `e2e/support/helpers.ts` (`openNotes`, `orderFor`) |
| 2 | F02 shared prices | `schema.ts` + `drizzle/0009`, `settlement.ts`, new route `api/sessions/[id]/prices/route.ts`, `validation.ts`, `permissions.ts` (new `price.default` action), `snapshot.ts` (both), `kkb.ts` resolver, `price-editor.tsx`, `kkb-view.tsx` |
| 3 | F03/F04 unavailable + corrections | `schema.ts` + `drizzle/0008` (`order_corrections.reason`, `group_id`; lands before slice 2's 0009 if built first, numbers follow merge order), `rounds.ts` (batch correction, unavailable), `entries.ts` (draft bulk remove), `validation.ts`, `use-session.ts` (Op union, `request`, `describeOp`, `OP_KINDS`), `rounds-view.tsx` → shared `correction-sheet.tsx`, dish row action in `order-ticket.tsx` |
| 4 | F06 tracker | `schema.ts` + `drizzle/0010`, `effective-order.ts`, new `src/server/orders/serving.ts`, route, new `served-section.tsx`, `workspace.tsx`, `order-options-sheet.tsx` |
| 5 | F05 notifications | `schema.ts` + `drizzle/0011`, new `src/server/notifications.ts` (write helper called inside existing mutations), `snapshot.ts`, read-marker route, new `notifications-drawer.tsx`, `session-header.tsx` |
| 6 | F07 receipt, F08 completeness, F09 copy summary, landing narrative | `schema.ts` + `drizzle/0012` (`sessions.receipt_total_*`), `settlement.ts`, `kkb.ts` (`kkbText`, completeness counts), `kkb-view.tsx`, `service-charge-block.tsx`, landing scenes copy |
| 7 | Final verify + baseline re-capture + docs (`docs/ux-specification.md`, `data-model.md`, `api.md`, `realtime.md`, `HANDOFF.md`, `PROJECT_LOG.md`) | docs |

Rejected: a new permanent "Served" or "Alerts" tab (brief §7 says avoid; header and Order tab already have room). Rejected: notifications derived on the client from events (lost on resync, and the stream is unfiltered so it can't carry per-recipient data).

## Reuse

- **Mutations**: `handle` / `requireActor` / `idempotencyKey` / `readJson` / `runMutation` (`src/server/http.ts`, `mutations.ts`); `can()` + `HOST_ONLY` (`permissions.ts:10-41`); `conflict()` + `expectedRevision` (`settlement.ts:23`).
- **Client saves**: optimistic queue (`use-session.ts`) for ordering-style changes (unavailable, corrections); `useDirectSave` (`use-direct-save.ts`) for host settlement-style edits (shared price, served counts, receipt total), with the existing Use theirs / Keep mine conflict UI from `price-editor.tsx:77-92`.
- **Effective order**: KKB's `confirmedLine` (`kkb.ts:162-176`) and summary's `settledEntries` (`summary.ts:28`) become one function in `src/lib/effective-order.ts`, used by KKB, Items and the tracker. This also fixes the High divergence.
- **Identity**: `preparationKey` (`consolidate.ts:39`), `normalizeText` (`dish-name.ts`).
- **UI**: `Drawer` (`ui/drawer.tsx`), `Stepper`, `RecipientPicker`, `ConfirmDialog`, `FullScreenSheet`, toast Undo pattern (`workspace.tsx:239-266`), money helpers (`money.ts`), `allocate` (`kkb.ts:236`).
- **DB patterns**: same-session triggers from `0007_settlement`; DB-integrity tests in `tests/db-integrity.test.ts`; test helpers `tests/helpers/session.ts`; e2e `joinAsGuest` for two-phone specs.

## Not doing

Browser/PWA push; shared-dish cost splitting (stays one payer, PROJECT_LOG:423); activity history; menus, inventory, payments; editing the dish name of an entry (stays remove-and-add, PROJECT_LOG:336); prices on the waiter ticket, invite or Items export; a new navigation tab; real-device and real-user testing (owner tasks, HANDOFF 4, 6, 9, 10; the audit says so instead of claiming them).

## States

| Surface | States |
|---|---|
| Composer | empty; typing with suggestions; size open with variant suggestions; note open; price open with "₱120 × 2"; all three set (chips shown before Add); invalid price; comma split offer; For panel open (recipients only); 320 / 375 / 430; dark |
| Edit dish sheet | same chip layout; guest (own entry) vs host |
| Shared price | line inheriting the default ("₱120 · table price"); override ("₱100 · this line only"); unknown; conflict; guest view (read-only default) |
| Unavailable / corrections | draft dish (direct remove + Undo); confirmed dish, no open round; confirmed, round open; partial cancel across 3 people; pending vs told the waiter; replacement priced |
| Tracker | hidden before first confirm; round 1 confirmed, nothing served; partial (3 of 5); all served; two rounds; a confirmed cancellation lowering expected below served (clamped, notice); guest read-only; long list (30 lines) at 320 |
| Notifications | no notifications; unread badge (1, 9+); drawer list mixed read/unread; mark all read; closed order (still readable); guest vs host |
| KKB | completeness "8 of 10 priced" with no service charge; all priced; receipt matches; receipt differs (+/−); receipt entered with unpriced lines (incomplete, says so); Copy summary output |
| Every new surface | light + dark, reduced motion, 44 px targets, screen-reader announcement |

## Decisions (owner answers, 2026-11-19)

| # | Decision | Answer |
|---|---|---|
| D1 | Mobile scope | **Responsive + native feel**: new screens fit 320–1280; fix `interactive-widget=resizes-content` (`layout.tsx:46`), dark theme-color vs header band (`layout.tsx:49`, `globals.css:74`), long-press selection on buttons; add a WebKit/iPhone Playwright project |
| D2 | Shared price key | **Dish + size** (notes ignored) |
| D3 | Who sets table prices | **Host, in KKB only** ("Every … here" choice). Composer prices (host or guest) show "₱120 · table price" when one exists; a different typed price is a "this line only" override; the composer never creates a default |
| D4 | Unavailable on a confirmed dish | **Counts at once, asks first** ("This can't be undone"); plain Cancel/Replace still wait for the next round's confirm |
| D4b | Unavailable scope | **Whole dish, all sizes, all rounds** in one change: draft entries removed (Undo), confirmed ones get cancellations |
| D5 | Items vs KKB on pending corrections | **Items follows KKB**: pending changes shown as "waiting for the waiter", not applied |
| D6 | Copy summary | **KKB tab**; Items Copy text / Save image stay price-free |
| D7 | Slice order | **Tracker (4) before notifications (5)** |
| D8 | Composer layout | **M1a chips row** |
| D9 | Served unit | **Per round × dish+size+notes preparation**, names shown under each line; "served" notification to everyone in a line when it is fully served |
| D10 | Tracker placement | **M2a section on the Order tab** |
| D12 | Undo when Mark unavailable touches both rounds (asked 2026-11-20) | **Undo the open-round part only**: the toast's Undo restores the removed draft entries; the confirmed (told) part stays |
| D13 | "Replace with…" when the dish has pending cancels (asked 2026-11-20) | **Replace what remains after pending cancels**: in the same change the pending cancels become told cancels and the replacement covers only the rest (e.g. 2 ordered, 1 pending cancel → 1 cancelled + 1 replaced) |
| D14 | Cancel some default (asked 2026-11-20) | **Every person starts at 0**; Save stays disabled until ≥ 1 portion is chosen; a summary line above Save names the affected people and quantities ("Cancels: Rafa ×2, Kovie ×1"); each person's count maps to that person's own source entries (newest first within the person), never to arbitrary entries of the consolidated dish |
| D15 | Rounds tab layout (asked 2026-11-20) | **One "Change a dish…" button per confirmed round** (replaces per-dish Change… rows) opening a searchable list of that round's dish lines; picking one opens the Cancel some / Replace / Unavailable sheet. **Confirmed round tickets collapse by default** to a compact summary (round number, confirmed status and time, dish count, total portions) and expand to the full stamped ticket |
| D16 | Replaced dishes in "Change a dish…" (asked 2026-11-20) | **Keep them, shown truthfully.** After a told replacement the original line reads "Chicken Katsu ×1 → Replaced" (not actionable, history kept) and the replacement is its own actionable line "Pork Katsu ×1" (Cancel some / Replace; cancelling or re-replacing it never cancels the original again). A pending replacement leaves the original as the active line with "change pending (→ Pork Katsu)". Effective quantities, tracking and KKB all keep reading `effectiveEntry`; no duplicate corrections |
| D17 | Focus after the last dish goes (asked 2026-11-20) | **Never lose focus.** Next remaining dish/action, else the previous one; an emptied round → its empty-state action (Order tab: the Dish field); an emptied correction list → close it and return to "Change a dish…", or the round's summary button if that button is gone; never a hidden, disabled or unmounted element; same when the change arrives by live update |
| D18 | "Portions" vs "items" (asked 2026-11-20) | **"items" for total quantities everywhere** ("3 dishes · 4 items", "Total: 4 items"); **"dishes"** means distinct lines/preparations. Applied across the app's copy |
| D19 | Where a replacement line sits (asked 2026-11-20) | **Directly under its original**: "Chicken Katsu ×1 — Replaced" then "↳ Pork Katsu ×1 — Replacement". Corrections on the same source dish grouped together in chronological order; same ordering in the Rounds picker and the Corrections list (waiter tickets and KKB/Items already show one "A → B" line per entry) |
| D20 | Round on correction rows (asked 2026-11-20) | **Backlog** (follow-up 14): show source round and, where different, the round it was communicated in ("From Round 1, corrected in Round 2"), alongside future correction-history work |
| D21 | Tracker: dish replaced after some was served (asked 2026-11-20) | **Keep served as history**: the original stays as a read-only row ("Chicken Katsu · 2 served · rest replaced"); the replacement line's expected is the replaced quantity minus what was already served of the original (Pork Katsu 0 of 3), so only what's missing waits. Tracker only; KKB keeps billing from `effectiveEntry` |
| D22 | When a correction notifies (asked 2026-11-20) | **Only when told to the waiter**: one notice per correction, sent when the round carrying it is confirmed (billing changes then, D5); no notice when merely recorded. Unavailable stays immediate (it is told at once) |
| D11 | Next.js advisories (outside brief) | **Separate PR first**: 16.4.2 → 16.4.5 (GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8) |

Ledger statuses for A2, A7, A8, A9, A10, A15, A19, A22 are now `planned`.

## Pinned details (from plan-critic, verified facts)

- **Tracker placement:** the Served section renders on the Order tab whenever any round is confirmed: above What's next? while no round is open, and above the draft ticket while the next round is open (so round 1 food stays trackable during round 2, `workspace.tsx:527`). Read-only after the order ends.
- **Correction entry points:** each Served row and each confirmed round card in Rounds gets a host-only **Change…** button that opens the correction sheet (today `CorrectionDialog` mounts only on the draft round card, `rounds-view.tsx:224`).
- **Unavailable-as-told is permanent:** no trigger blocks inserting a correction that targets a confirmed round (`0004:46` is UPDATE/DELETE only; 0006/0007 add nothing on `order_corrections`), but such a row can never be removed. So "Mark unavailable" on a confirmed dish asks once ("This can't be undone"); no Undo toast. "Told" is derived from the target round's status; `communicated_at` is not newly relied on. Confirmed round tickets keep rendering their immutable snapshot (`rounds-view.tsx:202`); told corrections show in a separate "Told the waiter" list under them.
- **Migration for slice 3:** `order_corrections.reason` (`UNAVAILABLE` | null) and `group_id` (rows written by one batch, shown as one row). Billing keeps reading type `QUANTITY` (`kkb.ts:163-170`, `summary.ts:28`, cap `rounds.ts:~153`); `CANCEL` stays unused. A batch is all-or-nothing against the 100-correction cap (`rounds.ts:144`, counts rows).
- **Shared prices vs overrides:** setting a default never overwrites a line that has its own price; "Every … (n lines)" counts lines without an override. Clearing a line's price returns it to the default. Replacement lines (`correction_settlements`, `kkb.ts:174`) never inherit a default (free-text, no dish identity).
- **NON_TICKET_EVENTS** (`settlement.ts:14`, read at `rounds.ts:74`, stale check `rounds.ts:87`) gains: shared price set, served set, receipt total set, unavailable-as-told. Draft bulk-remove stays a ticket event. Notification reads emit no event.
- **Copy honesty across slices:** slice 3 omits "…get an update" until slice 5 ships notifications.
- **Served counts:** stored raw; shown as `min(served, expected)`. If a confirmed cancellation drops expected below served: "Now 3 of 3 · 2 were cancelled". A replacement line starts at 0 served. Writes send a **delta** clamped on the server (one host per order, `participants_one_host_uq` `schema.ts:84`, so there's no rival editor); taps coalesce client-side (~300 ms) to stay well under the 120/min limiter (`limits.ts:7`). A failed save shows on the row with Try again.
- **Permissions** (`permissions.ts`): new host-only actions `price.default`, `serving.update`, `receipt.set`, `dish.unavailable`. Receipt check and Copy summary are visible to everyone (all prices are already in every snapshot); only setting the receipt total is host-only.
- **Notifications:** rows written per recipient at write time (late joiners start empty); snapshot returns the actor's latest 50. Undo or removal of the triggering change deletes the notifications it created in the same transaction (so dedup never swallows a later legitimate one).
- **Comma split rule:** offered when the name contains a comma. Text before the first comma = dish; the next part = size if it matches a size already used for that dish or a short size word (small, medium, large, regular, solo, sharing, family, hot, iced), otherwise note; any further parts join the note. The offer shows the exact result ("Split into Katsu · size large · note no sauce?"). Never on a name already in this order's dish list.
- **Cancel some:** per-person steppers drive; the total is their sum (billing is per person).
- **Tests:** a cascade/cleanup test per new table (retention). E2E selectors that change with F01: `e2e/support/helpers.ts:21-33` (`openNotes`, `orderFor`), `density-review.spec.ts:28`, `standalone.spec.ts:57,62` ("Size or variant"), `editing.spec.ts:11`, `kkb.spec.ts:23-60` and `onboarding.spec.ts:56` ("Price each (₱)"), `guide-scenes.tsx`, `guide-steps.ts`. Field labels "Size or variant" and "Price each (₱)" are kept where possible.
- **Added states:** Items showing a pending change as "waiting for the waiter" (D5); End-order sheet with food waiting; receipt check and Copy summary with service charge unset or blocked; failed served save; edit sheet uses M1a rows; tracker clamped notice and 30-line list follow M2a rows.

## Assumptions

- Served updates are host-only (brief §9); guests see progress read-only.
- Notification events and recipients: round confirmed / new round opened → all guests; dish unavailable or corrected → the people that dish is for (everyone for whole-table/unassigned); price default changed → people with that dish, one per change; food served → everyone with an entry in a line when that line is fully served (not per plate); readiness → host when all guests are ready; order ended → everyone. Never to the actor. Dedup key = event type + subject + round.
- Marking notifications read uses a lightweight route that does **not** bump the session revision or emit an event (private state), so it can't wake every phone or stale a confirm; still idempotent and actor-scoped.
- Variant suggestions come from existing entries of the same dish only.
- Existing explicit entry prices migrate as overrides; no defaults are backfilled.
- Landing copy changes only describe shipped features (slice 6 lands after 2–5).
- Every slice updates the setup guide steps it changes (`onboarding/guide-steps.ts`) and gets a visible entry point where users first meet it (owner feedback: entry point at first use).

## Done when

- Automated per slice: `pnpm typecheck`, `pnpm lint`, `pnpm test` (new: composer split + suggestions, price resolution + overrides, batch cancellation caps, unavailable-as-told, served ≤ expected under concurrency, notification recipients + dedup, receipt difference, kkbText), `pnpm build`, `pnpm e2e` (updated helpers; new specs for brief scenarios A–F), CI drift check per migration.
- Manual per slice: the States table at 320 / 375 / 430 / 768 / 1280, light and dark, via `/workflow:verify` QA screenshots against `.shots/before/`.
- Not claimable from here: real phones, VoiceOver/TalkBack, real-table usability. Listed as owner tasks.

## Skills

- `impeccable` + `.impeccable/surfaces/src-app.md` direction contract and `DESIGN.md`: the order-pad visual system every new surface must match.
- `mobile-native`: D1 native-feel fixes.
- `accessibility` / `frontend-a11y`: WCAG 2.2 AA for drawers, badges, live regions.
- `database-migrations` + `ecc:postgres-patterns`: additive migrations 0008–0012 with triggers.
- `react-patterns`: client store changes in `use-session.ts`.

## Mockups

Text sketches (Frame0's tools weren't connected this session). Phone 390. Structure, order and copy are the contract; styling comes from `DESIGN.md`.

**M1a Composer: detail chips row (recommended)**
```
M1a-1 Default                         M1a-2 Size tapped
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ Dish                         │      │ Dish                         │
│ [Chicken Katsu_            ] │      │ [Chicken Katsu             ] │
│ (+ Size) (+ Note) (+ ₱ Price)│      │ Size [Large_____________] ✕  │
│ [For Me ▾]   − 1 +   [+ Add] │      │  used in this order:         │
└──────────────────────────────┘      │  (Large) (Regular)           │
                                      │ (+ Note) (+ ₱ Price)         │
                                      │ [For Me ▾]   − 1 +   [+ Add] │
                                      └──────────────────────────────┘
M1a-3 All set (shown before Add)      M1a-4 Comma split offer
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ [Chicken Katsu             ] │      │ [Gyoza, large              ] │
│ (Large ✕) (No sauce ✕)       │      │ Split into Gyoza + size      │
│ (₱120 × 2 = ₱240 ✕)          │      │ "large"?  [Split] [Keep as   │
│ [For Me ▾]   − 2 +   [+ Add] │      │                    typed]    │
└──────────────────────────────┘      │ (+ Size) (+ Note) (+ ₱ Price)│
  tap a tag to edit; ✕ clears it      │ [For Me ▾]   − 1 +   [+ Add] │
                                      └──────────────────────────────┘
M1a-5 For panel open: recipients only, no size/notes/price inside
┌──────────────────────────────┐
│ Who's it for?             ✕  │
│ (Me) (Rafa) (Miguel)         │
│ (Barkada) (Whole table)      │
│ (Anyone) (+ Someone else)    │
│ (+ New group)                │
├──────────────────────────────┤
│ [Chicken Katsu             ] │
│ (+ Size) (+ Note) (+ ₱ Price)│
│ [For Rafa ▴] − 1 +   [+ Add] │
└──────────────────────────────┘
```
One field open at a time; Add submits whatever is filled. Edit dish sheet uses the same rows (Size / Note / Price each as a labelled field, plus Who's it for).

**M1b Composer: buttons inside the dish row + one details sheet (alternative)**
```
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ Dish             [Size][Note]│      │ [Chicken Katsu  ][Size][Note]│
│ [Chicken Katsu_      ]  [₱]  │      │ Large · No sauce · ₱120 each │
│ [For Me ▾]   − 1 +   [+ Add] │      │ [For Me ▾]   − 2 +   [+ Add] │
└──────────────────────────────┘      └──────────────────────────────┘
 any button opens one sheet above the composer with all three fields
```

**M2a Food tracker: section on the Order tab (recommended)**
```
M2a-1 Host, partial                   M2a-2 Guest (read-only)
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ …stamped Round 1 ticket…     │      │ …stamped Round 1 ticket…     │
├──────────────────────────────┤      ├──────────────────────────────┤
│ Served                       │      │ Served                       │
│ 9 of 14 served · 5 waiting   │      │ 9 of 14 served · 5 waiting   │
│ ▓▓▓▓▓▓▓▓▓░░░░░               │      │ ▓▓▓▓▓▓▓▓▓░░░░░               │
│ (All) (Waiting 5) (Served)   │      │ (All) (Waiting 5) (Served)   │
│ ROUND 1                      │      │ Chicken Katsu  3 of 5 served │
│ Chicken Katsu        − 3 +   │      │ Kovie ×2 · Miguel ×3         │
│ 3 of 5 served · 2 waiting    │      │ Gyoza          ✓ Served 3    │
│ Kovie ×2 · Miguel ×3 [All ✓] │      └──────────────────────────────┘
│ Gyoza            ✓ Served 3  │
├──────────────────────────────┤      M2a-3 All served
│ What's next?                 │      │ All 14 served. Kain na!      │
│ [+ Add more (round 2)]       │
│ [End the order]              │
│ Enter receipt prices (KKB)   │
└──────────────────────────────┘
```
Section appears only once a round is confirmed; never before.

**M2b Food tracker: compact card + drawer (alternative)**
```
┌──────────────────────────────┐      drawer "Food tracker":
│ Food · 9 of 14 served        │      same chips and rows as M2a-1
│ 5 waiting            [Track] │
└──────────────────────────────┘
```

**Tracker: End order with food waiting (not a block)**
```
│ End the order?                         │
│ 5 dishes still waiting to be served.   │
│ You can still end the order.           │
│ [Yes, end the order]  [Not yet]        │
```

**M3 Notifications**
```
Header row 1                          Drawer "Updates"
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ ‹  Kovie's table      🔔(3)  │      │ Updates          Mark all read│
│    ROUND 1 · OPEN  ✓         │      │ • New  Round 2 is open  8:10 │
│ [Invite]      [Options ▾]    │      │ • New  Your dishes are all   │
└──────────────────────────────┘      │        served           8:05 │
                                      │ • New  Sisig is unavailable. │
Empty: "No updates yet. You'll see    │   1 cancelled from your order│
confirmations, changes and served     │                         7:50 │
food here."                           │   Round 1 confirmed with the │
                                      │   waiter                7:42 │
                                      └──────────────────────────────┘
```
Tapping a row closes the drawer and jumps to the place (Served section, Rounds, KKB).

**M4 KKB**
```
M4-1 Completeness + price source      M4-2 Price editor (host)
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ 8 of 10 dishes priced ·      │      │ Chicken Katsu (Large) ×1     │
│ Show the 2 without a price › │      │ Price each (₱) [120.00     ] │
│ Kovie · you          ₱360    │      │ = ₱120.00                    │
│ Chicken Katsu (Large) ×1     │      │ (•) Every Chicken Katsu      │
│ ₱120.00 each · table price   │      │     (Large) here (2 lines)   │
│ Chicken Katsu (No sauce) ×2  │      │ ( ) Only this line           │
│ ₱100.00 each · this line only│      │ [Save]                       │
└──────────────────────────────┘      └──────────────────────────────┘
M4-3 Check against the receipt         M4-4 Copy summary
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ Check against the receipt    │      │ KKB              [Copy summary]
│ Food in Salo       ₱1,240.00 │      │ Salo · Kovie's table · 19 Nov│
│ Service charge       ₱124.00 │      │ Kovie ₱480 + ₱48 = ₱528      │
│ Salo total         ₱1,364.00 │      │ Rafa  ₱300 + ₱30 = ₱330      │
│ Receipt total  [₱1,400.00  ] │      │ Not yet settled: Gyoza ×3    │
│ ₱36.00 more on the receipt.  │      │ (Whole table), no price      │
│ Not split. Check the receipt │      │ Total ₱1,364                 │
│ for items missing in Salo.   │      └──────────────────────────────┘
│ (if unpriced: "2 dishes have │        toast: "Summary copied"
│ no price yet, so this can't  │
│ match.")                     │
└──────────────────────────────┘
```

**M5 Corrections and Unavailable**
```
M5-1 Cancel some                      M5-2 Unavailable
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ Change Chicken Katsu (Large) │      │ Change Chicken Katsu (Large) │
│ Round 1 · 5 ordered          │      │ [Cancel some][Replace][Unavail]
│ [Cancel some][Replace][Unavail]     │ The waiter said it's out.    │
│ Cancel        − 2 + of 5     │      │ All 5 come off now. Kovie and│
│ Whose? Kovie − 0 +           │      │ Miguel get an update.        │
│        Miguel − 2 +          │      │ Replace with… [optional    ] │
│ Note [                     ] │      │ [Mark unavailable]           │
│ Goes to the waiter with      │      └──────────────────────────────┘
│ round 2                      │
│ [Save change]                │      M5-3 Rounds corrections list
└──────────────────────────────┘      │ Sisig ×1 cancelled ·         │
                                      │ Unavailable · Told the waiter│
                                      │ 7:50 PM                      │
                                      │ Chicken Katsu (Large) −2 ·   │
                                      │ Pending · goes with round 2  │
                                      │                     [Remove] │
```
On a draft (unconfirmed) dish, the host's dish menu has "Unavailable", which removes every entry of that preparation in one change with Undo.

## Slice 8 — Phase 7 feedback (owner, 2026-11-21)

Owner's words, verbatim:

> **17. Served section — Reduce vertical space.** Yes, let's make the post-confirmation serving interface more compact. For fully served dishes, replace the expanded serving controls with a compact "All ✓" indicator, similar to the mockup. Keep detailed controls available when tapped so the host can undo an accidental serving update. For partially served and outstanding dishes, retain visible quantities (e.g., "3/5 served") and appropriate controls. Prioritize outstanding food over fully served items. Consider collapsing fully served dishes into a separate section when the list becomes long. The goal is to reduce unnecessary scrolling without making it difficult to identify missing food or correct serving statuses.
>
> **18. Composer — Excessive height at 320px.** This is a high-priority mobile UX issue. The composer should not consume most of the available screen, especially when the primary task is reviewing and managing orders. Please optimize the composer for narrow screens (320px and above). Recommendations: Reduce unnecessary padding and vertical spacing. Keep the default composer as compact as possible. Avoid stacking controls into three permanent rows where feasible. Show optional fields only when needed, while keeping their entry points discoverable. Consider an expandable composer or a compact input dock, but avoid introducing extra taps for basic ordering. Account for the virtual keyboard, safe areas, and bottom navigation. Ensure the order list retains sufficient visible space. Do not simply reduce text sizes or touch targets to make everything fit. Preserve accessibility and usability. Please compare alternative layouts and choose the one that best balances compactness, discoverability, and interaction speed.
>
> **19. Round labels — Inconsistent typography.** Standardize the presentation of round labels throughout the application. "Round 1" should use the same terminology, typography hierarchy, and visual treatment when referring to the same type of information. However, distinguish between a primary round heading, a compact status label, and contextual references where appropriate. We don't need identical font sizes everywhere, but the design language should remain consistent. Review the relevant components and consolidate repeated styling into reusable patterns where practical.
>
> **20. Guest KKB access — Too many taps.** Agreed. Guests should have a direct and discoverable way to access their individual KKB share, just as the host already has a convenient entry point. Introduce a contextual "My KKB" or "My share" action where guests naturally encounter their orders, particularly after confirmation. Requirements: Reduce access to ideally one tap from the relevant screen. Directly open or scroll to the guest's own KKB breakdown. Show an appropriate state when prices are incomplete. Preserve access to the complete KKB view where permitted. Avoid adding another permanent navigation tab solely for this feature. Keep host and guest navigation consistent where possible. The goal is to make important functionality discoverable at the point where users need it, rather than forcing them to navigate through multiple views.

### Ask ledger (slice 8)

| # | Owner's words | Planned change | Status |
|---|---|---|---|
| A25 | "fully served dishes … compact "All ✓" … detailed controls available when tapped" (17) | per D23–D27 | done (slice 8, verified) |
| A26 | "Prioritize outstanding food … collapsing fully served dishes into a separate section when the list becomes long" (17) | per D23–D27 | done (slice 8, verified) |
| A27 | "optimize the composer for narrow screens … compare alternative layouts and choose" (18) | per D23 | done (slice 8, verified) |
| A28 | "Standardize the presentation of round labels … reusable patterns" (19) | per D23–D27 | done (slice 8, verified) |
| A29 | "contextual "My KKB" or "My share" action … ideally one tap … directly open or scroll to the guest's own KKB" (20) | per D23–D27 | done (slice 8, verified) |

### Research (2026-11-21, code trace)

- **Served (#17):** `served-section.tsx` rows: label, host `Stepper`, status, people, then "All served" (when not done) and "Change…" (when expected > 0); filters All/Waiting/Served at :43-70; per-round `<h3>`. Order comes from `serving.ts:87` (createdAt, id) pinned by `tests/served-edits.test.ts:27-43`. Outstanding-first needs **no sort change**: stable-partition the creation-ordered lines into waiting / done, bucketing on the *server* `shown >= expected` so rows move only after the snapshot lands (taps coalesce 300 ms). D17 focus fallback (`use-row-focus-fallback.ts`) needs all `[data-serve-row]` in one container; hidden rows are skipped by `canFocus`. Breaks: `e2e/food-tracker.spec.ts:43-54,79,121-124`, ux-spec :59.
- **Composer (#18):** at 320 the dock is ≈312 px (measured: chips top 598, Add 696, Review 758 on 812 high): dish 60 + chips 50 + For row wrapped to two lines 98 (`composer.tsx:269` `max-[359px]:basis-full`, kept so no label goes icon-only) + bar 44 + paddings. At ≥360 it is ≈264. On an SE (568) that is ≈55% before the keyboard. No virtual-keyboard handling exists (`layout.tsx:48-53`; D1's `interactive-widget` was never applied). `html { scroll-padding-bottom: 10rem }` (`globals.css:172`) is fixed and smaller than the 320 dock (WCAG 2.4.11 risk). Dependents: e2e helpers `addDish`/`orderFor`/`openDetail` (`e2e/support/helpers.ts:10-35`), many specs on textbox "Dish", `data-tour="dish"`, `data-focus-fallback`, guide "Try it" `details` (opens the price field), `guide-scenes.tsx:35` chip picture, `round-total` testid.
  - Options: **A** at <360 replace the three chips with one "+ Details" chip on the stepper row → rows Dish / [For ▾ · Add] / [+ Details · stepper], ≈264 px (−48), ≥360 unchanged; costs one tap for size/note at <360. **B** collapse to Dish + [For · Add] at rest, reveal stepper and chips on focus/typing → ≈214 at rest but full height while typing (the case that hurts), stepper hidden until typing. **C** scrolling chip row + stepper on For row: does not fit 280 px. Extra lever: guest bar wraps to 78 px under 360; folding the count into "Ticket · 4" saves ≈34 (breaks `round-total` specs).
- **Round labels (#19):** two recipes: mono tomato-ink uppercase letter-spaced (ticket headers `order-ticket.tsx:175`, `waiter-ticket.tsx:25` at 0.14/0.16em, header status `session-header.tsx:51` at 0.12em) vs sans eyebrow (`served-section.tsx:75`, `kkb-view.tsx:339` "Not yet confirmed"); plus sentence-case references (rounds summary, corrections, picker, notifications, dialogs). Expanded Rounds card shows both sans "Round 1" and mono "ROUND 1". No shared token; DESIGN.md says DM Mono + tomato-ink are for round labels. Proposal: `.round-label` utility (heading / compact status) + plain inline references.
- **Guest share (#20):** KKB lives in the Summary sheet (`summary-sheet.tsx`); `openSummary(source, tab)` (`workspace.tsx:122`). Guest after confirm sees ticket, Served, a note (:629) and the dock "Ticket" (:700-711) — no share affordance. Own card is already first in KKB (`kkb.ts:122`, ringed, `kkb-view.tsx:136-141`); scroll-to-own reuses `showFirstUnpriced` (`kkb-view.tsx:170-176`). Labels to reuse: "so far", "no prices yet", card amounts. Candidates: dock "My share" button (recommended), a "See your share" text button in the guest note, People banner opening KKB.

**Also in slice 8: the D1 native-feel fixes that were decided but never built**: `interactive-widget=resizes-content` (pairs with the composer height), dark `theme-color` matching the header band (`layout.tsx:49` vs `globals.css:74`), a long-press text-selection guard on buttons, `scroll-padding-bottom` following `--dock-h`, and a WebKit/iPhone Playwright project.

### Approach (slice 8)

One PR into `dev`, branch `feat/ux-polish`. Five parts, each small; no server or schema change.

| Part | Change | Main files |
|---|---|---|
| 8a Composer (#18) | Narrow-screen layout per D23; `scroll-padding-bottom` follows `--dock-h`; `interactive-widget=resizes-content` (D1) so the dock rides above the keyboard | `composer.tsx`, `detail-fields.tsx`, `workspace.tsx` (dock), `globals.css`, `src/app/layout.tsx` (viewport), `e2e/support/helpers.ts` (`openDetail`), guide scene/copy |
| 8b Served (#17) | Two groups per D24: Waiting (zero/partial, full controls) then Fully served (compact "All ✓" rows, tap to reveal −/+ and Change…); stable creation order inside each group, bucketed on the server count | `served-section.tsx`, `e2e/food-tracker.spec.ts`, ux-spec |
| 8c Round labels (#19) | One `.round-label` utility (mono, tomato-ink, uppercase via CSS, one tracking value) in `globals.css` `@layer components`; used for round headings and compact status labels; prose keeps plain "round 2" | `globals.css`, `order-ticket.tsx`, `waiter-ticket.tsx`, `served-section.tsx`, `session-header.tsx`, `rounds-view.tsx` (drop the duplicate sans "Round 1" inside an expanded card), `kkb-view.tsx` |
| 8d My share (#20) | Per D26: a "My share" button in the dock after a round is confirmed, labelled from `buildKkb` ("My share · ₱528.00" / "My share so far · ₱480.00" / "My share · no prices yet"); opens Who ordered what on KKB and scrolls to and focuses the viewer's own card | `workspace.tsx` (dock, `openSummary` gains a focus target), `summary-sheet.tsx`, `kkb-view.tsx`, `guide-steps.ts` |
| 8e D1 native feel | Dark `theme-color` = dark header band; `-webkit-touch-callout:none` + `user-select:none` on buttons; WebKit/iPhone Playwright project (mobile Safari) running the core specs | `layout.tsx`, `globals.css`, `playwright.config.ts` |

Rejected: a permanent KKB tab (owner: no new permanent tab); hiding the stepper until typing as the only composer change (full height returns while typing, the case that hurts).

### Mockups (text sketches, phone 320)

**M8-1a Composer at <360: "+ Details" chip on the stepper row (recommended)**
```
┌────────────────────────────┐   rows: 3 (was 4)
│ Dish                       │   dock ≈ 264 px (was ≈ 312)
│ [Chicken Katsu_          ] │
│ [For Me ▾]         [+ Add] │
│ (+ Details)        − 1 +   │
└────────────────────────────┘
 tap + Details → the Size / Note / ₱ Price chips appear inline (as today);
 filled details show as a tag line "Large · No sauce · ₱120" with a dot on the chip.
 ≥360: unchanged (three chips visible).
```
**M8-1b Composer at <360: compact until you type**
```
at rest (not focused, empty)        while typing
┌────────────────────────────┐     ┌────────────────────────────┐
│ [Add a dish…_    ] [+ Add] │     │ [Chicken Katsu_          ] │
│ For Me ▾                   │     │ (+ Size)(+ Note)(+ ₱ Price)│
└────────────────────────────┘     │ [For Me ▾]  − 1 +  [+ Add] │
 ≈ 214 px                          └────────────────────────────┘ ≈ 312 px
```
**M8-1c Both: 1a's layout, and at rest it shrinks to Dish + [For · Add] (≈ 214), expanding to 1a (≈ 264) on focus.**

**M8-2 Served, compact (both options share this row design)**
```
Served · 9 of 14 served · 5 waiting  ▓▓▓▓▓▓▓▓▓░░░░░
WAITING
 Chicken Katsu (Large)      − 3 +
 3 of 5 served · 2 waiting
 Kovie ×2 · Miguel ×3   [All served] [Change…]
 Iced Tea                   − 0 +
 0 of 2 served · 2 waiting
FULLY SERVED (4)                         ▸   ← collapsed when more than 5; open otherwise
 Gyoza ×3                   All ✓  ▾     ← tap → reveals − 3 + and Change… (undo)
 Sisig ×1                   All ✓  ▾
```
**M8-2a: the All / Waiting / Served filter chips are removed (the two groups replace them).**
**M8-2b: keep the chips above the groups.**

**M8-3 My share in the dock (after a round is confirmed)**
```
guest                                   host
│ 14 items   [My share · ₱330] [Ticket] │   │ 14 items  [My share · ₱528] [Review order] │
 prices missing → "My share · no prices yet"; partly priced or pending → "My share so far · ₱300"
 under 360 the buttons share a row in halves (as the guest bar does today), count on its own line.
 tap → Who ordered what opens on KKB, scrolled to and focused on your own card.
```

### Decisions (slice 8)

Owner answers (2026-11-21):

| # | Decision | Answer |
|---|---|---|
| D23 | Composer at 320 | **M8-1c**: at rest Dish + [For ▾ · Add] (≈214 px, 2 rows); focusing the dish field expands to Dish / [For · Add] / [+ Details · stepper] (≈264). Size/note/price behind "+ Details" at <360, three chips at ≥360 when expanded. No extra tap for a basic dish |
| D24 | Served grouping | **One Waiting group + one Fully served group across all rounds**, compact `.round-label` tag ("ROUND 1") on each row; Fully served collapses above 5 dishes; the All/Waiting/Served chips are removed |
| D26 | My share | **Guests and host**, in the dock after a round is confirmed; label per the recipe in Pinned details; ended orders use the existing "Who ordered what" button, opening on the viewer's card |
| D27 | Keyboard-up dock | **Hide the bottom bar (count / Review order / My share / I'm ready) while the composer has focus**; it returns when focus leaves |
| D28 | My share bar width at 320 (asked 2026-11-21) | **Shorter label under 360**: "Share ₱1,240" (full "My share so far · ₱1,240" in the accessible name and at ≥360), so the buttons stay on one row |

Ledger: A25–A29 → planned.

### Pinned details (slice 8, from plan-critic, verified)
- **Dock targets at 320:** host and guest stated separately. Guest with a round open keeps `I'm ready`, `Ticket` and gains `My share`; under 360 the count takes its own line and the buttons wrap (measure and state the guest height). Current guest bar alone ≈ 78 px.
- **My share label** (reuse `SummaryAmount`, whole pesos without ".00"): allocated → "My share · ₱528"; no charge yet and complete → "My share · ₱480"; partial or pending → "My share so far · ₱480"; nothing priced → "My share · no prices yet"; viewer has no confirmed entries (no section or only drafts) → no button.
- **My share target:** the own card gets an id, `tabIndex=-1` and a visible focus; focus moves after the drawer finishes opening (drawer open-autofocus), tab set to KKB. **Ended order:** the dock is hidden (`workspace.tsx:669`), so the existing "Who ordered what" button in the ended notice opens on KKB at the viewer's card.
- **`.round-label`** = DM Mono 500, uppercase (CSS only), tracking 0.14em; heading `text-sm` (waiter-ticket hero `text-lg`); compact status `text-xs`. On the red band the header uses the `on-band` colour, not tomato-ink. The waiter ticket's "Corrections" heading is not a round label.
- **Dark theme-color:** set only where the band exists (the session page's `generateViewport`), as a hex constant of `oklch(0.36 0.105 29)` in `site.ts`; other pages keep paper. The manual `.dark` toggle isn't seen by the media-query meta (gap stays, noted).
- **WebKit / keyboard:** CI installs only Chromium (`ci.yml:65`); the WebKit project needs `playwright install --with-deps webkit` and a named spec list. No emulator raises a virtual keyboard: keyboard-up is verified by measuring `--dock-h` against `visualViewport` and stays an owner real-phone check. `interactive-widget` helps Android Chrome; iOS Safari behaviour to be checked against MDN before claiming anything.
- **`resizes-content` side effects:** `dvh` shrinks with the keyboard, so the recipient panel (`max-h-[45dvh]`) and drawers (`max-h-[92dvh]`) are named checks; the guide's "Try it → details" must open the details first at <360.
- **Details stay editable:** filled size/note/price keep their removable tags with ✕ (A3, slice 1), wrapping on their own row; the "+ Details" chip's accessible name includes the count ("Details, 2 added"); no colour-only dot. State the dock height with details filled.
- **Served rows:** history rows (D21, expected 0) go in Fully served; guests see plain "All ✓" rows with no toggle; compact rows keep the people names; the D17 last resort becomes the "Served" heading when the filter chips go; after an undo moves a row back to Waiting, focus follows that dish's − control and scrolls it into view. The sketch's "FULLY SERVED (4)" example is open (collapse starts above 5).

### Assumptions (slice 8)
- Fully served group collapses by default when it holds more than 5 dishes; open otherwise; a dish moves between groups only after the server confirms (no jump under the finger).
- Round label pattern (owner #19 gave the direction): headings and compact status use `.round-label`; references in sentences stay plain "round 2"; DOM text stays "Round N" (uppercase is CSS), so accessible names don't change.
- The KKB "Not yet confirmed" eyebrow becomes "ROUND N · NOT YET CONFIRMED" when the number is known.
- D1 parts ship here as decided; the WebKit project runs a core subset (standalone, composer-details, kkb, food-tracker) to keep CI time sane.
- Guide scene and copy follow the composer change; the setup guide's "Try it" for prices opens the details first at <360.

### Done when
- Dock at 320 measured ≤ 270 px with nothing open (1a), keyboard-up behaviour checked in the WebKit and Chromium emulation, no horizontal overflow, 44 px targets.
- Served: fully served rows ≤ 60 px each, outstanding first, D17 focus never lost (e2e), undo from a compact row works.
- One round-label class used by every heading/status occurrence (grep), no duplicate label in an expanded Rounds card.
- My share opens KKB on the viewer's card in one tap (e2e, guest and host); labels match `buildKkb`.
- typecheck, lint, test, build, full e2e (+ WebKit subset), opt-in review specs with 0 axe violations.
