# Salo v1.3: dining coordination (plan)

Owner's brief, kept in full: [`salo-v1-3-brief.md`](salo-v1-3-brief.md). Phase 0 audit: [`salo-v1-3-audit.md`](salo-v1-3-audit.md). Baseline screenshots: `.shots/before/` (git-ignored).

Status: **decisions answered; awaiting go.** No source edited.

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
| A8 | "Introduce session-scoped default prices… Price Resolution: override → shared default → unknown" (F02) | `shared_prices` table keyed by dish + size (D2); KKB resolver falls back to it; host sets defaults | 2 | planned |
| A9 | "Give hosts control over shared defaults… Allow explicit entry-level overrides" (F02) | Host price edit sets the default for that preparation; "Only this line" makes an override; guest prices stay overrides on their own entries (D3) | 2 | planned |
| A10 | "Introduce a Mark unavailable workflow" (F03) | Host "Unavailable" on a dish: draft round → removes all matching entries in one change with Undo; confirmed round → cancellation corrections (D4) | 3 | planned |
| A11 | "Support partial cancellations… Distinguish pending and communicated corrections" (F03/F04) | One correction drawer: Cancel some (across all entries of a preparation, one batch) / Replace / Unavailable; pending vs told-the-waiter labels | 3 | planned |
| A12 | "Avoid introducing redundant correction records" (F04) | Batch mutation writes one correction per affected source entry in one change (needed for per-person billing), shown as one row | 3 | planned |
| A13 | "Add a notification center accessible from the session header" (F05) | Bell in header row 1 with unread count → drawer list, mark all read | 5 | planned |
| A14 | "Persist meaningful notifications… recipient eligibility and read state… reconnect and replay" (F05) | `notifications` + `notification_reads` tables written in the same transaction as the triggering change; delivered via the per-actor snapshot | 5 | planned |
| A15 | "Food Arrival Tracker… derive expected items from confirmed orders… partial deliveries" (F06) | `served_counts` per round × preparation (or replacement); "Served" section on the Order tab once a round is confirmed; host steppers; everyone views | 4 | planned |
| A16 | "If outstanding items remain, present an informative warning rather than a hard block" (F06) | End-order sheet adds "n dishes still waiting" line | 4 | planned |
| A17 | "Allow hosts to enter the final restaurant receipt total… calculate discrepancies" (F07) | `sessions.receipt_total_centavos` + revision; KKB "Check against receipt" block: food + service charge vs receipt, difference shown, never distributed | 6 | planned |
| A18 | "Show pricing completeness… quick access to unresolved prices" (F08) | KKB status line always shows "8 of 10 preparations priced" (unit = distinct preparation lines as in Items; priced only when every entry in it resolves) with a jump to the first unpriced line | 6 | planned |
| A19 | "Provide a Copy summary action… Messenger-friendly plain-text" (F09) | KKB tab gets Copy summary (`kkbText()` next to `buildKkb`); Items copy stays price-free (D6) | 6 | planned |
| A20 | "Broaden Salo's positioning… Expanded value proposition" (§2.2) | Landing hero/How it works copy updated **after** tracker and settle features ship (last slice), tagline kept | 6 | planned |
| A21 | "Final usability validation and regression audit" (Phase 7) | `/workflow:verify` per slice; final re-run of baseline capture + axe at all widths; real-phone and real-user checks stay owner tasks | 7 | planned |
| A23 | "After confirmation surface Food Tracker… Near completion emphasize outstanding food, pricing completeness…" (§7) | Tracker above What's next; KKB link stays in What's next; End sheet gets the waiting-dishes line; nothing else moves | 4, 6 | planned |
| A24 | "Confirm corrections: host only" (§9) | Confirming a correction = confirming the round that carries it (`rounds.ts:111`); no separate action | 3 | planned |
| A22 | "Mobile usability audit… 320–430, tablet, desktop" (§4.2) | Mobile scope decision (D1) | all | planned |

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
