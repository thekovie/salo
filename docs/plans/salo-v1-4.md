# Salo v1.4: billing, co-hosts, continuity (plan)

Owner's brief, kept in full: [`salo-v1-4-brief.md`](salo-v1-4-brief.md). Phase 0 audit: [`salo-v1-4-audit.md`](salo-v1-4-audit.md). Baseline screenshots: `.shots/before/` (git-ignored; v1.3 shots archived in `.shots/v1-3/`).

Each slice ships as its own branch and squash PR into `dev` (HANDOFF working rules). One slice per session: `/clear`, then `/workflow:kickoff slice N of docs/plans/salo-v1-4.md`. Later slices get their own research, decisions and text sketch when they start; the cross-cutting decisions below are settled now because they shape migrations.

## Slices

| Slice | Brief | Content | Migration | Status |
|---|---|---|---|---|
| 0 | Phase 0 | Audit (`salo-v1-4-audit.md`) + this plan | — | done (decisions answered 2026-11-23) |
| 1 | F01 + F11 (pricing part) | Price status in What's next, quick-entry Prices sheet, draft persistence, guest "so far" label | none | landed (PR #51) |
| 2 | F02, F03 | Receipt adjustments, allocation methods A–E, adjusted vs actual totals | 0013 | landed (PR pending) |
| 3 | F04 (+F12 lock fix) | Co-hosts, `can()` capability map, role re-check under lock, serving precondition | 0014 | not started |
| 4 | F05, F06 | Multiple receipts, shared-dish splits | 0015 | not started |
| 5 | F07 | Payment ledger, derived balances | 0016 | not started |
| 6 | F08, F09 | My order sheet, host transfer | 0017 | not started |
| 7 | F10, F12 | Manifest `id`/`scope`, invite continuity copy, reliability fixes + tests | — | not started |
| 8 | F11, F13, F14, F16, F17 | Billing flow polish, export options, large-order search/collapse, menu link, creation animation (tail-less table: current mark has a speech-bubble tail, `brand/logo.tsx:3-6`; aligned to the final logo in slice 10) | 0018 | not started |
| 9 | Phase 9 | Full regression, money property tests, a11y sweep; real phones and pilot stay owner tasks | — | not started |
| 10 | F15 | Shared Table logo and icon set (last, alone) | — | not started |

## Ask ledger

| # | Owner's words | Planned change | Slice | Status |
|---|---|---|---|---|
| L1 | "Begin with Phase 0. Do not implement the entire v1.4 brief as one unreviewed change." | Audit + plan only this session; slice 1 waits for the gate | 0 | done |
| L2 | "Before coding, produce: A technical gap assessment. A UI/UX audit report. A feature-to-existing-component mapping. A proposed database and API change plan. A prioritized implementation sequence. A regression-risk assessment." (§3.3) | Audit §1–§6 | 0 | done (browser part §2a from capture) |
| L3 | "Clearly distinguish observations verified through code inspection, browser testing, and real-device testing." (§3.3) | `[code]` / `[node]` / `[browser]` / `[unverified]` labels; no device claims | 0 | done |
| L4 | "Review at minimum: 320px 360px 375px 390px 430px Tablet Desktop" (§3.2) | Baseline at 320/375/430/768/1280 with geometry; 360 and 390 added in slice 1's verify (before and after) | 0, 1 | partial |
| L5 | "Include an assessment of menu URL security and the existing Turnstile creation flow." (addendum) | Audit F16 + F17 sections | 0 | done |
| L6 | "The host should see: Pricing completeness. Number of unpriced preparations. A clearly labeled **Enter prices** action. Direct access to unresolved prices. A clear indication when pricing is complete." (F01) | Entry point per D7 ("Enter prices · 3 left"), What's next row, KKB tab button; complete: "All prices in" | 1 | done |
| L7 | "Implement a compact quick-entry interface… Prioritize unpriced preparations. Display dish names and variants. Display quantities. Allow inline price entry." (F01) | Prices sheet: one row per dish + size, unpriced first, quantity, inline ₱ field | 1 | done |
| L8 | "Reuse existing shared-price defaults. Respect per-entry overrides. Show inherited prices clearly." (F01) | Row saves the table price (`setSharedPrice`); lines with their own price keep it and show "2 have their own price" | 1 | done |
| L9 | "Preserve incomplete values when connectivity fails. Show save and conflict states." (F01) | Typed values kept per row (and across closing the sheet, D9), Saving / Saved / Not saved · Try again / "Changed on another phone" | 1 | done |
| L10 | "Do not require prices before confirming orders." / "Pricing reminders do not interrupt ordering." (F01) | Nothing before confirm; no toasts or banners; row only inside What's next and KKB | 1 | done |
| L11 | "Guests can identify whether their KKB is incomplete." (F01) | Short dock label shows incompleteness (D11); today it drops "so far" (`kkb.ts:363`) | 1 | done |
| L12 | "Treat pricing and settlement as one connected workflow… not a mandatory wizard." (F11) | Slice 1: price step; full sequence in slice 8 | 1, 8 | partial (price step done; rest slice 8) |
| L13 | F02 "Receipt Discounts and Adjustments" incl. "The restaurant's final receipt is authoritative… must not subtract that discount again" | Adjusted total and receipt total shown separately; discrepancy never forced to zero | 2 | planned (slice 2 section) |
| L14 | F03 "Proportional / Equal / Individual / Manual / Unallocated" | Allocation methods over `allocate` | 2 | planned (slice 2 section) |
| L15 | F04 "Introduce an optional **Co-host** role" | Co-host flag (D2), serving capability, lock re-check | 3 | not started |
| L16 | F05 "Allow one dining session to record multiple restaurant receipts." | `receipts` | 4 | not started |
| L17 | F06 "Allow the host to allocate a shared item's cost among selected participants." | Split payers | 4 | not started |
| L18 | F07 "Introduce optional settlement tracking" | Payments ledger | 5 | not started |
| L19 | F08 "Provide a convenient **My order** review" | My order sheet | 6 | not started |
| L20 | F09 "Introduce an explicit host-transfer workflow." | Atomic transfer | 6 | not started |
| L21 | F10 "PWA Deep Linking and Invite Continuity" | Manifest + guidance, accurate platform docs | 7 | not started |
| L22 | F12 "Offline and Realtime Reliability Improvements" | Scenario tests + targeted fixes | 3, 7 | not started |
| L23 | F13 "Completed-Session Export" | Optional export sections | 8 | not started |
| L24 | F14 "Large-Order Navigation and Usability" | Order search, People collapse | 8 | not started |
| L25 | F16 "Restaurant Menu Link Sharing & URL Safety" | Menu link (D4) | 8 | not started |
| L26 | F17 "Animated Room Creation and Bot-Verification Experience" | Table animation in `BotCheck` | 8 | not started |
| L27 | F15 "This feature must be implemented **last**" | Slice 10, alone | 10 | not started |
| L28 | §8.5 "Conduct a real dining pilot… Do not fabricate usability results." | Owner task; never reported as done by the workflow | 9 | owner |

## Today (slice 1)

- Post-confirm What's next card (host, open order): "Add more (round n)" and "End the order" outline buttons, then a ghost "Enter receipt prices (KKB)" (`workspace.tsx:619-640`). It opens the Summary drawer on the KKB tab.
- KKB tab completeness line: "5 of 8 dishes priced · Show the 3 without a price" scrolls to the first unpriced row (`kkb-view.tsx:184-197`, `showFirstUnpriced` `:173`). Counting unit: distinct dishes, priced only when every line resolves (`kkb.ts:282-295`).
- Pricing is one line at a time through `PriceEditor` (`price-editor.tsx`, 243 lines): "Every Chicken Katsu (Large) here" sets the table price (`TablePrice`, `:19-28`), "Only this line" sets an override. Saves via `useDirectSave` + `useRetryOnReconnect` (`use-direct-save.ts:21-66`); conflict = 409 with keep/adopt (`price-editor.tsx:60-75`).
- Table prices: `shared_prices` keyed session + dish + size (`schema.ts:405`), endpoint used by `setSharedPrice` (`settlement.ts:89`, host only, `price.default`).
- Guest dock: `myShareLabel` → `shortShareLabel` under 430 px drops "so far" (`kkb.ts:353-363`).

## Approach (slice 1)

A **Prices sheet** (bottom drawer, host only) listing one row per dish + size that appears in **confirmed** rounds, unpriced rows first, each with an inline ₱ field that sets the table price. Opened from the entry point chosen in D7 and from the KKB tab completeness line. No schema or API change.

Pinned details (plan-critic, verified):
- **Endpoint.** `PUT /api/sessions/[id]/prices` (`prices/route.ts:11` → `setSharedPrice`, `settlement.ts:88`) with `{dishId, variant, unitCentavos, expectedRevision}`; `expectedRevision = snapshot.settlement.defaults[tableKey]?.revision ?? 0` (`kkb.ts:153`; a cleared price keeps its row, `schema.ts:402`). `clearEntryId` omitted, so own prices are never touched. Idempotency type `price.default:<dishId>|<variant>` → one `useDirectSave` per row (`PriceRow` component). After a save the row re-bases to the returned revision, otherwise its next save reads as a conflict (`PriceEditor` avoids this by closing; rows stay mounted).
- **Replacement lines** (D10): per the owner's answer, either their own rows via `PUT /api/sessions/[id]/corrections/[id]/price`, or a link to them in KKB.
- **Counts.** `priceCompleteness` counts preparations (dish + size + notes, plus one per replacement, `consolidate.ts:39`, `kkb.ts:200`), the KKB tab's existing unit (v1.3 A18, unchanged). The sheet and the new entry points count **sheet rows still needing a price** ("3 prices left"), computed by the same pure helper that builds the rows, so the dock, What's next and the sheet header always agree.
- **Blank.** Blank on a priced row removes the table price (as `PriceEditor`: "Blank removes the table price"); blank on an unpriced row does nothing.
- **Copy** reuses `PriceEditor` (`price-editor.tsx:196-231`): conflict "Someone changed this just now to ₱X. Your amount is still here." + Use theirs / Keep mine; error "Not saved. {message}" + Try again; plus "Saving…" / "Saved".
- **No layout shift.** Row order is frozen while the sheet is open (as `startOpen`, `kkb-view.tsx:44`); re-sorted on reopen. Order: unpriced first, then by first confirmed appearance (round, then ticket order). `inputMode="decimal"`, `enterKeyHint="next"` moves to the next unpriced row, last row "done".
- **Focus.** From KKB the sheet stacks over the Summary drawer (`summary-sheet.tsx:110`); closing returns focus to the opener. If the opener became text (pricing complete), focus goes to the nearest heading (`#what-next`, or the KKB completeness line). One close control (✕), as the Summary drawer (`summary-sheet.tsx:128`).
- **Drafts (D9a).** `sessionStorage` key `salo:prices:<sessionId>` = `{[tableKey]: {text, baseRevision}}`; cleared per row on save; a restored value whose `baseRevision` is stale opens in the conflict state. Listed on `/cookies` (`src/app/cookies/page.tsx:15-19`).
- **Files.** New `src/components/workspace/prices-sheet.tsx` (sheet + `PriceRow`) and `price-status.tsx` (entry row/label); pure `tablePriceRows()` in `src/lib/kkb.ts` shared with `kkb-view.tsx`'s `tableFor`; `workspace.tsx` (781/800 lines) gets only one `useState` and the openers.
- **Specs to update.** Five specs click "Enter receipt prices (KKB)": `e2e/shared-prices.spec.ts:34,82`, `kkb.spec.ts:49`, `reconnect-retry.spec.ts:19`, `receipt-check.spec.ts:25`, `density-review.spec.ts:88`. The host KKB tab keeps "Show the n without a price" beside the new "Enter prices" (v1.3 A18 jump stays), so `receipt-check.spec.ts:27-38` assertions hold.

Rejected: inline price fields directly on the stamped ticket (crowds the waiter view and the ticket stays price-free by design, D6 v1.3).

## Reuse
- `priceCompleteness` (counts) and `buildKkb` lines (quantities, own-price detection) from `kkb.ts`.
- `TablePrice` building logic in `kkb-view.tsx` (dish + size, lines that follow it, live revision): move to a pure helper in `src/lib/kkb.ts` (e.g. `tablePriceRows(kkb, snapshot)`) shared by `KkbView` and the new sheet, not copied.
- `useDirectSave`, `useRetryOnReconnect`, `parsePeso`/`toPesoInput`/`formatPeso`, existing `Drawer` component, `Button`.
- Conflict copy from `PriceEditor`.

## Not doing (slice 1)
- No price prompts before confirm, no toasts, no banners outside What's next / KKB.
- Guests don't get the Prices sheet (they price their own lines in KKB as today).
- Per-line overrides stay in the KKB tab's `PriceEditor`; the sheet only sets table prices.
- No service charge or receipt fields in the sheet (they stay in KKB; slice 8 joins the flow).

## States (slice 1)
| State | After |
|---|---|
| No confirmed round | No price row anywhere (unchanged) |
| Confirmed, nothing priced | Entry point (D7): "Enter prices · 8 left"; What's next row "8 prices left" + **Enter prices** |
| Partly priced | "Enter prices · 3 left" / "3 prices left" + **Enter prices** |
| All priced | Dock back to "My share · ₱X"; What's next row "All prices in ✓" (text, no button) |
| Later round in draft | Dock entry point still shows (it renders whenever a round is confirmed, `workspace.tsx:139`); What's next is hidden as today |
| Order ended | Unchanged today (What's next hidden, KKB read-only); D1 decides whether pricing stays editable after End, built in slice 2 |
| Sheet: row saving / saved / failed offline / conflict | "Saving…" / "Saved" / "Not saved. {message}" + Try again (auto-retries on reconnect) / "Someone changed this just now to ₱X. Your amount is still here." + Use theirs / Keep mine |
| Sheet: restored unsaved value on reopen | Field holds the typed value, "Not saved" + Try again |
| Sheet: row where some lines have their own price | "2 of 5 have their own price" under the name; field sets the price for the rest |
| Sheet: row where every line has its own price | In the priced part, "Own prices" instead of a field |
| Sheet: all priced | Header "All prices in"; every row shows its amount, editable |
| Sheet: long dish names, 30 rows, 320 | Names wrap under the field-free column; field keeps its width; sheet scrolls |
| Guest and host dock < 430 px, incomplete | D11 wording; must stay one row at 320 and 360 (`e2e/slice8-measure.spec.ts`) |
| Widths | 320, 360, 375, 390, 430, 768, 1280; light and dark |

## Decisions

Owner answers 2026-11-23: D1, D2, D3, D4, D7, D9, D10, D11 = recommended option. D5 is asked at slice 5's kickoff. D6 and D8 are carried as assumptions (responsive + native feel; rows per dish + size).

- **D1 [decided: (a) billing editable after End via `allowClosed`] Billing after End the order** (cross-cutting, affects slices 2, 4, 5). Options: (a) allow billing changes (prices, service charge, receipt, adjustments, payments) on ended orders via the existing `allowClosed` path (`mutations.ts:77`), order content stays frozen, retention unchanged at 7 days; (b) keep billing before End only. Recommend (a): discounts and separate receipts arrive with the bill, after the meal (brief F05 "usually happens after ordering, when the waiter prepares the final bill").
- **D2 [decided: (a) `participants.cohost_at` flag] Co-host model** (slice 3). (a) nullable `participants.cohost_at` mapped to capabilities in `permissions.ts`, role column untouched; (b) new `COHOST` role value (rewrites three CHECKs and the one-host index logic); (c) capabilities table. Recommend (a): only `serving.update` is ever grantable (brief §6 "host should remain the only participant with full administrative authority"), and the one-host invariant stays DB-enforced (`schema.ts:90`).
- **D3 [decided: (a) count precondition, second tap refreshes] Concurrent serving** (slice 3). (a) client sends the count it saw with the delta; the server applies only if it still matches, else returns the current count and the stepper updates; (b) keep plain deltas clamped. Recommend (a): (b) double-counts when two co-hosts tap for the same plate (`serving.ts:34-37`).
- **D4 [decided: (a) no reputation service in v1] Menu link reputation check** (slice 8). (a) none in v1: strict URL validation, show the domain, report link via the existing policy mailto, never say "safe"; (b) Google Safe Browsing lookup, fail-open with an "unchecked" state. Recommend (a): no outbound dependency, no URL sharing with a third party; the brief allows "evaluate optional".
- **D5 Payment status visibility** (slice 5, open). (a) everyone sees everyone's paid / partly paid / unpaid (matches today: every member sees every price); (b) guests see only their own. Recommend (a) for consistency with `sessions/snapshot.ts:59-95`; (b) needs a per-viewer snapshot pattern.
- **D6 Mobile scope.** Responsive + native feel (carry v1.3): all baseline items are present (audit, Mobile baseline); new UI matches them. Add `overscroll-behavior-y: contain` on `body` only if the owner wants pull-to-refresh suppressed (assumption: no).
- **D7 [decided: M2c dock + What's next + KKB] Price entry point placement** (slice 1). M2c: host's dock button reads "Enter prices · 3 left" while dishes are unpriced (opens the Prices sheet), back to "My share ₱X" when complete; plus the row in What's next and KKB. M2a: What's next row + KKB only. M2b: M2a + a slim row at the top of the Order tab. Recommend M2c: What's next sits ~1,345 px down at 375 with only 6 dishes (audit B2), while the dock is always visible after confirm and already hosts the share button (`workspace.tsx:139,706`); it never interrupts ordering (no banner, no toast).
- **D8 Prices sheet unit** (slice 1). (a) one row per dish + size (table price, same unit as completeness and v1.3 D2); (b) one row per line incl. notes. Recommend (a): matches `shared_prices` and "A shared preparation price correctly propagates to eligible entries".
- **D9 [decided: (a) sessionStorage drafts per order] Unsaved typed prices** (slice 1). (a) keep typed-but-unsaved values per row in `sessionStorage` for the order, restored with "Not saved" when the sheet reopens; (b) keep them only while the sheet is open. Recommend (a): the brief asks to "Preserve incomplete values when connectivity fails", and closing the sheet is common at a table.

- **D10 [decided: (a) replacements get their own rows] Replacement lines in the sheet** (slice 1). (a) unpriced replacements get their own rows with a ₱ field (corrections price endpoint), so the sheet can reach "All prices in"; (b) the sheet sets table prices only and shows "1 replacement — price it in KKB →". Recommend (a): completeness counts them (`kkb.ts:200`) and the brief asks for "Direct access to unresolved prices".
- **D11 [decided: (a) "Share so far ₱X", fallback "So far ₱X"] Dock label under 430 px when incomplete** (slice 1). (a) "Share so far ₱1,240", measured not to wrap at 320; fallback "So far ₱1,240" if it does; (b) keep "Share ₱1,240" plus a "~". Recommend (a): brief "Guests can identify whether their KKB is incomplete"; #47 shortened the label only to keep one row.

- **D12 [decided 2026-11-23 after build: add "Edit prices"]** Once all priced, "All prices in · Edit prices" (What's next) and "All n dishes priced · Edit prices" (KKB, host) reopen the sheet. Also kept, owner-approved: Keep mine saves at once; untouched rows follow other devices; all-own-price rows show "Own prices" with no field.

## Assumptions
- KKB tab's "x of y dishes priced" stays as is (v1.3 unit); new entry points count sheet rows ("prices left").
- Sheet rows come from confirmed rounds only; draft-round dishes are priced in KKB as today.
- Save on Enter / next or on leaving the field; no Save button per row.
- 360 and 390 px weren't in the Phase 0 capture; slice 1's verify shoots before/after at 360 and 390 too (before = `dev` as is).
- Later slices' file-level plans are written at each slice's kickoff (audit §3–§4 give the map).
- Owner tasks from v1.3 (real phones, pilot, backups) stay open in HANDOFF and are not repeated here.

## Done when (slice 1)
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e` pass.
- Unit: `tablePriceRows` ordering (unpriced first), own-price counts, quantities; `shortShareLabel` keeps "so far" / "no prices yet".
- E2E (new `e2e/quick-prices.spec.ts`): host confirms, What's next shows "0 of n", enters three prices in the sheet without closing it, guest's share updates live, an override line keeps its price; offline save shows Not saved and retries on reconnect; reopening the sheet restores an unsaved value; conflict from a second host tab; axe light/dark on the sheet.
- Manual: shots of every state above at 320/375/430/768/1280.

## Skills
- `impeccable` + `.impeccable/surfaces/src-app.md`: the Operate surface and ticket world.
- `frontend-a11y` / `accessibility`: sheet focus, labelled inputs, live save status.
- `mobile-native`: decimal keypad, field above the keyboard in a drawer.
- `react-testing` is not applicable (no component test setup); tests are unit (pure helpers) + Playwright.

## You need to do
- [x] Review the Phase 0 audit (`docs/plans/salo-v1-4-audit.md`) and the slice table.
- [x] (carried from v1.3) Real-phone checks: done during v1.3.
- [ ] (carried from v1.3) KKB pilot: after all v1.4 slices land.
- Backups: deferred by owner (2026-11-23).

## Mockups (slice 1, text sketch)

Labels: M1 = What's next row, M2 = Prices sheet, M3 = row states, M4 = KKB tab line, M5 = dock (D7 option M2c).

M1a What's next, partly priced (host, 375):
```
┌ What's next? ───────────────────────────────┐
│ [ + Add more (round 2) ] [ ✓ End the order ] │
│ ──────────────────────────────────────────── │
│ ₱ 3 prices left          [ Enter prices ]    │
└──────────────────────────────────────────────┘
```
M1b Nothing priced: `│ ₱ 8 prices left          [ Enter prices ]    │`
M1c All priced: `│ ✓ All prices in                  Edit prices │` (D12)

M2a Prices sheet, partly priced (drawer, 375):
```
┌ Enter prices ─────────────────────────── ✕ ┐
│ 3 prices left · a price covers every order │
│ of that dish and size                      │
│ NEEDS A PRICE                              │
│ Chicken Katsu (Large)    ×3   ₱[______]    │
│ Iced tea                 ×5   ₱[______]    │
│ Sinigang                 ×2   ₱[______]    │
│   1 of 2 has its own price                 │
│ Pork (replaces Beef)     ×1   ₱[______]    │  ← D10 (a)
│ PRICED                                     │
│ Garlic rice              ×6   ₱[ 45.00]    │
│ Pancit (Small)           ×2   Own prices   │
└────────────────────────────────────────────┘
```
M2b All priced: header `All prices in`; rows as PRICED above, all editable.
M2c 320, long name:
```
│ Crispy pata with extra   ×1   ₱[______] │
│ garlic and atchara                      │
```

M3 Row states (copy from `PriceEditor`):
```
│ Iced tea  ×5  ₱[ 60.00]  Saving…                         │
│ Iced tea  ×5  ₱[ 60.00]  Saved                           │
│ Iced tea  ×5  ₱[ 60.00]  Not saved. No connection.       │
│                          [ Try again ]                   │
│ Iced tea  ×5  ₱[ 60.00]  Not saved   [ Try again ]       │  ← restored on reopen
│ Iced tea  ×5  ₱[ 60.00]  Someone changed this just now   │
│                          to ₱65.00. Your amount is still │
│                          here. [ Use theirs ] [ Keep mine ]│
```

M4 KKB tab (host): `5 of 8 dishes priced · Show the 3 without a price · Enter prices`; all priced: `All 8 dishes priced · Edit prices` (D12); guests unchanged.

M5 Dock after confirm (D7 M2c), host:
```
│ [ ₱ Enter prices · 3 left ] [ Review order ] │  ← unpriced (replaces the share button)
│ [ My share · ₱1,240 ]       [ Review order ] │  ← all priced
```
M5 guest under 430 (D11 a), 320:
```
│ [ Share so far ₱325 ] │   │ [ Share · no prices yet ] │
```

---

## Slice 2: receipt adjustments and allocation (F02, F03)

Status: landed (PR pending)

Research brief (2026-11-23, researcher) cited below; baseline in `.shots/before/` (seed: `.shots/before/seed.mjs`, index `README.md`; slice 1 shots moved to `.shots/v1-4-slice1/`). Pre-existing, seen in baseline: "Show the 2 without a price" overflows the right edge in `kkb-long-names-320` (not this slice's scope unless verify flags it).

### Ask ledger (slice 2)

Brief F02 and F03 quoted from `salo-v1-4-brief.md:249-381`.

| # | Owner's words | Planned change | Status |
|---|---|---|---|
| S2.1 | "Support: Fixed-amount discounts. Percentage-based discounts where the applicable basis is known. Additional charges. Credits and other adjustments. Optional adjustment descriptions." | Adjustment = discount or extra charge; amount in ₱ or %; credits are discounts with category Other; optional note (`LIMITS.label`) | done |
| S2.2 | "Suggested categories: Senior citizen, PWD, Privilege card, Promotion, Other. Categories are descriptive labels, not automatic eligibility determinations." | Category picker, label only, no rules attached | done |
| S2.3 | "The restaurant's final receipt is authoritative. If the host enters a final receipt total that already includes a discount, Salo must not subtract that discount again." | Receipt total is never reduced; it is compared with the adjusted total | done |
| S2.4 | "Separate: 1. Original calculated subtotal. 2. Recorded adjustments. 3. Calculated adjusted total. 4. Actual restaurant receipt total. 5. Reconciliation discrepancy." / "Calculated and actual totals remain independently visible." | Receipt check shows five rows (M2) | done |
| S2.5 | "Never silently force a discrepancy to zero." | Difference chip unchanged in kind; no auto-balancing adjustment | done |
| S2.6 | "Do not store senior/PWD identification numbers, images, or supporting documents." | Note field is free text ≤ label limit; hint says not to type ID numbers; no uploads | done |
| S2.7 | "Host can record and edit adjustments." | Host-only add / edit / remove, also after End (D1) | done |
| S2.8 | "Adjustments affect final KKB only when explicitly allocated." | "Decide later" (E) changes no one's share; shares read "so far" | done |
| S2.9 | "All calculations use integer centavos." / "Distribute rounding remainders deterministically." | Percent stored as basis points; shares via existing `allocate` (largest remainder, ties by key) | done |
| S2.10 | "Historical orders and original prices remain intact." / "Preserve original per-person subtotals." | Adjustments are separate rows; food subtotal and service share stay on each card, adjustment is its own line | done |
| S2.11 | F03 A–E: "Proportional… Equal… Individual… Manual… Unallocated" | Five "Who gets it" options (M3) | done |
| S2.12 | "Never allocate a larger discount than the eligible amount without explicit handling." / "Do not create negative payable balances by accident." | D15a: flagged, card unchanged, counts in adjusted total, shares "so far" | done |
| S2.13 | "Display how each discount affects each participant." / "Participants can see the adjustments affecting their share." | Line on each affected card (M4) + preview in the sheet; guests see the block read-only | done |
| S2.14 | "Distinguish discount beneficiaries from the people paying the final bill." | Card line reads "Senior citizen discount for Lola"; who actually paid the restaurant is slice 5 (F07) | done |
| S2.15 | "Final allocations reconcile with the applicable restaurant total." / "Changing allocation methods does not duplicate the discount." / "No hidden discount redistribution occurs." | Shares always sum to the adjustment (unit tests); one row per adjustment, method is a field, so switching replaces, never adds | done |
| S2.16 | "An unresolved adjustment is visibly marked incomplete." | Block row "Not assigned yet", dock + Copy summary say "so far" | done |
| S2.17 | D1 (decided): billing editable after End via `allowClosed` | Prices, Bill to, service charge, receipt total, adjustments editable by the host on an ended order; order content stays frozen | done |

### Today

- Per-person card (`KkbSection`, `kkb.ts:46-65`): `pricedCentavos` (food), `serviceCentavos`, `totalCentavos` (null until a service charge is allocated, `kkb.ts:203-227,229-254`). Footer rows "Food subtotal / Service charge / Total with service charge" (`kkb-view.tsx:302-340`).
- Service charge: allocated by food with exact largest remainder `allocate` (`kkb.ts:261-271`, returns zeros on zero weight); blocked by unpriced / unbilled shared / pending / zero food (`kkb.ts:234-243`).
- Receipt: `saloTotal = food + charge` (`kkb.ts:304`), `reconcile` compares only (`kkb.ts:310-317`); `ReceiptCheckBlock` rows Food in Salo / Service charge / Salo total / Receipt total (`receipt-check-block.tsx:70-83`; host edits the receipt via `AmountEditor`) + difference chip (`:29-60`).
- Storage: `sessions.service_charge_*`, `sessions.receipt_total_*` (`schema.ts:52-56`); PUT routes `service-charge`, `receipt-total` via `runMutation` + revision CAS (`settlement.ts:138-153`); 409 conflict copy (`settlement.ts:24`). Latest migration `0012_receipt_total`; `*_same_session` trigger pattern `drizzle/0007_settlement.sql:43-64`.
- Closed orders: `runMutation` refuses unless `allowClosed` (`mutations.ts:77`); no route passes it. UI edits only while open (`kkb-view.tsx:40,75,77,163-165`, `workspace.tsx:143`). Banner "This order has ended. Nothing can be changed." (`workspace.tsx:566`).
- Exports: `kkbText` prints `food + service = total` per person (`kkb.ts:322-351`); Items text/PNG and waiter ticket are price-free and stay so.
- No adjustments, no percent helper, no property tests (`package.json` has no fast-check).

### Approach

Store only what the host typed; compute every share in a pure module, like prices and the service charge.

- **Migration 0013** (`drizzle/0013_adjustments.sql`):
  - `adjustments`: `id uuid` (client-generated, so create is idempotent), `session_id` (cascade), `direction` (`discount` | `charge`), `category` (`senior` | `pwd` | `privilege` | `promo` | `other`), `note` text nullable, `amount_centavos` int nullable, `percent_bps` int nullable (`num_nonnulls = 1`; 1–10000 bps; amount 1–99,999,999), `method` (`proportional` | `equal` | `individual` | `manual` | `unallocated`), `revision ≥ 1`, `created_at`, `updated_by` (set null), `updated_at`, `session_idx`.
  - `adjustment_shares`: `adjustment_id` (cascade), `session_id`, `participant_id` nullable, `bill_to_label` nullable (`num_nonnulls = 1`, same keys as Bill to, `schema.ts:376`), `amount_centavos` nullable (manual only). Rows = the selected people; `*_same_session` trigger on adjustment + participant.
  - Percent is allowed only with `proportional` / `equal` / `individual` (basis known, D14); CHECK enforces.
- **API** (host only, new `adjustment.set` action in `permissions.ts` HOST_ONLY, `allowClosed: true`):
  - `PUT /api/sessions/[id]/adjustments/[adjustmentId]` body `{expectedRevision, direction, category, note, amountCentavos | percentBps, method, shares: [{participantId | billToLabel, amountCentavos?}]}`; `expectedRevision 0` creates. Replaces share rows in the same transaction. zod schema in `validation.ts`; shares bounded by `LIMITS.participantsPerSession`; manual shares must sum to the amount (server-checked, it is pure input).
  - `DELETE /api/sessions/[id]/adjustments/[adjustmentId]` body `{expectedRevision}`.
  - Events `adjustment.set`, `adjustment.removed`, both added to `NON_TICKET_EVENTS` (`settlement.ts:15`) with a test like `tests/serving.test.ts:99`.
  - Idempotency types `adjustment.set:<id>` / `adjustment.remove:<id>`.
- **Snapshot**: `settlement.adjustments: SnapshotAdjustment[]` (with shares) in `getSnapshot` (`sessions/snapshot.ts:36`) and `EMPTY_SETTLEMENT` (`lib/snapshot.ts:70`).
- **Math** (`src/lib/adjustments.ts`, pure, called at the end of `buildKkb`):
  - Order: food → service charge on original food (unchanged) → adjustments. Each card gains `adjustments: {id, label, centavos}[]` (signed: discount negative) and its `totalCentavos` becomes food + service + adjustments.
  - Gate: an adjustment applies only when the table has no unpriced, unbilled or pending lines (the service charge's blockers, extracted into one shared `billBlockers()` so both use it). While blocked it shows "Waiting for prices" and changes no share. When the service charge is unset or ₱0, totals are food + adjustments.
  - Amount: fixed, or `round(percent × basis)` where basis = the selected people's food (D14), half-up on centavos.
  - Shares: proportional = `allocate(amount, selected food)`; equal = `allocate(amount, equal weights)`; individual = all to one; manual = stored amounts; unallocated = none (table-level only).
  - Over-limit (D15) and zero-food beneficiaries flagged per adjustment; never clamped silently.
  - Kkb gains `adjustedTotal` (= `saloTotal` + all adjustments incl. unallocated) and `unresolved` (any adjustment unallocated, waiting or flagged).
- **Reconcile**: `reconcile` compares the receipt with `adjustedTotal` when adjustments exist, else `saloTotal` (unchanged behaviour). The receipt itself is never changed. This is the double-discount guard: a receipt that already includes the discount matches the adjusted total.
- **UI** (new files; `workspace.tsx` is 787/800 lines):
  - `adjustments-block.tsx`: "Discounts and extras" block in the KKB tab between Service charge and Receipt check (M1). Host: rows with Edit + "Add discount or charge". Guests: same rows, read-only. Empty + guest: hidden.
  - `adjustment-sheet.tsx`: Drawer form (M3) with Save / Remove, conflict state as `AmountEditor` (`amount-editor.tsx:56-70`), `useDirectSave` + `useRetryOnReconnect`.
  - Card footer line per adjustment (M4); "Total with service charge" becomes "Total" when the card has an adjustment.
  - `ReceiptCheckBlock` rows (M2).
  - `myShareLabel`: "so far" while `unresolved`. `kkbText`: adjustment terms per person and an "Not assigned" line.
- **D1 build**: `allowClosed: true` on prices, line price, correction price, Bill to (`entries/[id]/settlement`), service charge, receipt total and adjustment routes; the KKB edit gates and `hostPricing` drop `isOpen` for the host; ended banner copy becomes "This order has ended. The host can still fix prices and the bill until {date}." (date from `expiresAt`; retention is `CLOSED_RETENTION_DAYS`, `env.ts:13`) Ordering, serving and readiness stay refused on closed orders.

Rejected: storing computed shares (stale when a price changes, audit §4); recomputing the service charge on discounted food (changes everyone's service share when one person gets a discount; the receipt's service amount is what the host types).

### Pinned details (plan-critic, verified)

**Math**
- Adjustments apply after `withCharge` on every charge state. Unset or ₱0 service (`kkb.ts:231-232` return early, totals null): `totalCentavos = food + adjustments` once an adjustment touches the card, `serviceCentavos` stays null; footer shows Food subtotal, adjustment lines, "Total" (no Service row). "Total with service charge" only when a service share exists and the card has no adjustment.
- Cap (D15) = the person's food + service share when the charge is allocated, else food. Checked per person against the running total in creation order, so two discounts on one person are capped together; editing an earlier one can flag a later one.
- Percent: `bps × basis / 10000` in BigInt, half-up to the centavo; basis = sum of the selected people's food. Proportional / equal then split the rounded amount with `allocate`, so a share isn't exactly p% of that person's food; row text "10% of selected food" (individual: "20% of Lola's food").
- Zero weight: proportional where every selected person has ₱0 food is flagged "has no food" before `allocate` (which returns zeros, `kkb.ts:264`). A ticked ₱0-food person on any method is flagged.
- `adjustedTotal` = `saloTotal` + every applied or flagged adjustment (flagged per D15) + unallocated; waiting adjustments are not counted (chip already "incomplete"). `unresolved` = any unallocated, waiting or flagged → dock and Copy summary "so far"; `myShareLabel`'s `totalCentavos != null` branch (`kkb.ts:358`) adds "so far" when `unresolved`.
- Waiting gate applies to every adjustment, fixed ₱ individual included: deliberate, same rule as the service charge.
- Typed-name beneficiaries: `bill_to_label` stored tidied; matched to cards with `normalizeText` (`kkb.ts:133`), never `toLowerCase` (the `payers` list's `n:${title.toLowerCase()}` key, `kkb-view.tsx:49`, is fixed to match). On claim approval (`people.ts:151`) shares with that label become `participant_id` in the same transaction; until then a label with no card is flagged "has no food".

**Storage / API**
- `LIMITS.adjustmentsPerSession = 20` (new, `validation.ts:4-19`); 21st create → 400.
- `adjustment_shares.participant_id` FK without cascade (participants are soft-removed); a removed person's share stays and is flagged.
- Audit §4's nullable `receipt_id` is left to slice 4 (0015). 0013 is additive; rollback = drop both tables.
- DELETE of a missing id → 404 `ADJUSTMENT_NOT_FOUND`; stale `expectedRevision` → 409; PUT `expectedRevision 0` on an existing id → 409; an id from another session → 404.
- After End, `setEntrySettlement` refuses a non-host price edit with 403 (guests can price their own lines while open, `settlement.ts:35`).
- `price.defaultSet` notifications (`settlement.ts:126`) keep firing after End, unchanged.
- Cancelled orders are also `CLOSED` (`workspace.tsx:82`): billing routes with `allowClosed` require at least one confirmed round, else 409; cancelled banner unchanged.

**D1 siblings** (same copy, date from `expiresAt`)
- `workspace.tsx:566` banner uses `{date}`. `order-options-sheet.tsx:89,179` and `guide-steps.ts:100` are shown before End (no deletion date yet), so they keep "for 7 days" / "for a week" and add "The host can still fix prices and the bill." (built 2026-11-23). `guide-scenes.tsx:147` sample card and `privacy/page.tsx:74` unchanged.
- Host entry after End: KKB StatusStrip and dock "Enter prices · n left" (`hostPricing` drops `sessionOpen`, `workspace.tsx:143`); `kkb-view.tsx:118,165` gates drop `isOpen` for the host. `needsName` (`:114`) unchanged. What's next stays open-only.
- New refusal tests: guest price after End 403; billing on a cancelled order 409.

**Copy**
- Row title: `{category} {discount|charge}` + ` for {names}` / ` for everyone`; note is the second line. Other with a note: the note is the title ("Corkage charge for everyone"); Other without note: "Other charge". Card line uses the same title minus " for {me}" (M4: "Senior citizen discount").
- `kkbText` per person: `Lola  ₱920.00 + ₱92.00 service − ₱184.00 senior citizen discount = ₱828.00`; final "Total ₱X" = `adjustedTotal`; "Total not final" list (`kkb.ts:342-347`) gains "an adjustment isn't assigned". No adjustments → output byte-identical to today (`e2e/kkb.spec.ts:77`, `e2e/receipt-check.spec.ts:59-62`, `.shots/before/kkb-export.txt`).
- Credits: hint under category Other: "Credit? Choose Discount, Other."
- Remove: hidden on a new adjustment; inline "Remove this? [Yes, remove] [Keep]" (no undo).

### Reuse
- `allocate` (`kkb.ts:261`) for proportional and equal; service-charge blockers extracted, not copied.
- Route + mutation pattern from `service-charge` / `setEntrySettlement` (`settlement.ts:47-60,138-144`); trigger pattern from `0007_settlement.sql`.
- `Drawer`, `Button`, `useDirectSave`, `useRetryOnReconnect`, `parsePeso` / `formatPeso`, conflict copy from `AmountEditor`, payer list `payers` (`kkb-view.tsx:47-53`) for "Who gets it" (filtered to people with food).
- `PricesSheet` (`prices-sheet.tsx`) as the drawer layout template.

### Not doing
- Statutory senior/PWD math (VAT exemption etc.): the host types the receipt's amount or a %.
- Who actually paid the restaurant (slice 5, F07); multiple receipts (slice 4).
- Extending retention for post-close edits (stays 7 days after End).
- Notifications for adjustments.
- Adjustments on Items text / PNG, waiter ticket, invite (stay price-free).
- Property-based tests (slice 9); slice 2 adds targeted sum-conservation unit tests.

### States

| State | After |
|---|---|
| No adjustments | Block shows only "Add discount or charge" (host); hidden for guests; receipt check unchanged (4 rows) |
| One allocated discount | Block row; affected cards show the line and new Total; receipt check 6 rows: Food, Service charge, Salo total, Discounts and extras, Adjusted total, Receipt total + chip |
| Extra charge | Same, "+₱" and "Corkage" note |
| Percent, basis known | Row shows "20% of Lola's food · ₱184.00" |
| Waiting (unpriced / unbilled / pending) | Row "Waiting for prices"; no card changes; chip uses existing incomplete copy |
| Decide later (E) | Row "Not assigned yet"; adjusted total includes it; cards unchanged; dock and Copy summary "so far" |
| Over the limit (D15) | Row flagged with the reason; behaviour per D15 |
| Manual shares don't add up | Save disabled, "₱20.00 left to assign" in the sheet |
| Selected person later removed / has no food | Flagged like over-limit ("Ana has no food on the bill") |
| Sheet: saving / saved / failed offline / conflict | As `AmountEditor`: Saving… / closes on save / "Not saved. {message}" + Try again / "Changed just now…" + Use theirs / Keep mine |
| Ended order, host | KKB fully editable for billing (prices, Bill to, service, receipt, adjustments); banner copy changed |
| Ended order, guest | Read-only as today, sees adjustments |
| Guest, open order | Read-only rows and card lines |
| Widths | 320, 360, 375, 390, 430, 768, 1280; light and dark; sheet at 320 with keyboard |

### Decisions

Owner answers 2026-11-23: D13–D16 = recommended option.

- **D13 [decided: (a) own block + drawer] Where adjustments are entered.** (a) "Discounts and extras" block in the KKB tab between Service charge and Receipt check, editing in a drawer (M1 + M3); (b) rows inside the Receipt check block itself. Recommend (a): the receipt block is a comparison everyone reads (`receipt-check-block.tsx:70-83`); a separate block keeps it five clean rows (S2.4) and follows the Service charge block pattern (`service-charge-block.tsx`).
- **D14 [decided: (a) selected people's food] Percentage basis.** (a) % of the selected people's food subtotal (service excluded); (b) % of the whole table's food + service. Recommend (a): a senior/PWD discount covers that person's consumption, a privilege card selects the whole table, and food is the unit `allocate` already weights by.
- **D15 [decided: (a) flag, keep in adjusted total] Share bigger than a person's total.** (a) flag it; it changes no card until fixed but still counts in the adjusted total (the receipt already includes it), shares read "so far"; (b) flag it and leave it out of the adjusted total too (chip then reads "less on the receipt"); (c) cap at the person's total and move the rest to "Not assigned". Recommend (a): brief "without explicit handling" and "Never silently force a discrepancy to zero"; (c) moves money silently ("No hidden discount redistribution").
- **D16 [decided: (a) category visible to all] Category visible to the whole table.** (a) everyone sees "Senior citizen discount for Lola" (the snapshot is shared; brief "Participants can see the adjustments affecting their share"); (b) guests see "Discount for Lola" without the category. Recommend (a) with the sheet hint "Everyone at the table sees this"; (b) needs a per-viewer snapshot (audit §1, `sessions/snapshot.ts:59-95`).

### Assumptions
- Mobile scope: responsive + native feel (D6 carried). New inputs `text-base`, `inputMode="decimal"`.
- Service charge stays allocated on original food; adjustments apply after it.
- Credits = discount with category Other and a note.
- Equal / proportional pick from people with food (active participants + typed names, `kkb-view.tsx:47-53`); groups and the table aren't beneficiaries.
- Remainders: `allocate`'s ties by key; percent rounds half-up to the centavo.
- Adjustments ordered by creation time.
- D1 scope covers prices (D1's wording: "prices, service charge, receipt, adjustments, payments") and Bill to (not named in D1, but an unbilled shared dish blocks the service charge and every adjustment, `kkb.ts:237`, and the host couldn't clear it after End); tests asserting `SESSION_CLOSED` on those routes flip (`tests/settlement.test.ts:149-151`, `receipt-total.test.ts:83-86`, `contract-receipt-total.test.ts:504-516` C03/C04, `contract-table-prices.test.ts:407-413` T24) and their contract docs update.

### Done when
- `timeout 900 pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e` pass (Postgres via `pnpm db:up`).
- Unit (`tests/adjustments.test.ts`): each method's shares sum to the amount; percent rounding; over-limit flag; waiting gate; unallocated keeps cards unchanged; switching method replaces (one adjustment); `reconcile` uses adjusted total; `kkbText` and `myShareLabel` "so far".
- Contract (`tests/contract-adjustments.test.ts` + `docs/contracts/adjustments.md`): create, edit, conflict 409, delete, guest 403, closed order allowed, cross-session participant rejected by trigger, manual sum mismatch 400, idempotent replay, `NON_TICKET_EVENTS` keeps Confirm fresh.
- E2E (`e2e/adjustments.spec.ts`): host adds a senior discount for one guest, guest's card and dock update live; receipt that includes the discount matches; Decide later shows "so far"; host edits after End; axe light/dark on the sheet. Existing `receipt-check.spec.ts` / `kkb.spec.ts` stay green (no-adjustment output unchanged).
- Manual: shots of every state above.

### Skills
- `impeccable` + `.impeccable/surfaces/src-app.md`: Operate surface, ticket world.
- `database-migrations`: 0013 + triggers (hand plpgsql after `--> statement-breakpoint`, `pnpm db:generate`).
- `backend-patterns`: route handlers; read `node_modules/next/dist/docs/` per AGENTS.md.
- `frontend-a11y` / `accessibility`: radio groups, labelled amount fields, live save status.
- `mobile-native`: decimal keypad, drawer above keyboard.

### You need to do
- [ ] After merge, the first app start runs migration 0013 (watch logs, HANDOFF line 51).

### Mockups (slice 2, text sketch)

M1 KKB tab, "Discounts and extras" block (host, 375):
```
┌ Discounts and extras ─────────────────────────┐
│ Senior citizen discount for Lola   −₱184.00   │
│   20% of her food                    [Edit]   │
│ Promotion for everyone             −₱150.00   │
│   split by what each ordered         [Edit]   │
│ Corkage                            +₱200.00   │
│   ⚠ Not assigned yet                 [Edit]   │
│ [ + Add discount or charge ]                  │
└───────────────────────────────────────────────┘
```
M1 empty, host (owner-approved after build): hint "Senior or PWD discount, a promo, or a charge the receipt shows." above the Add button.
M1 guest: same rows without [Edit] and the add button.
M1 waiting: `│ Promotion for everyone  −10%  ⚠ Waiting for prices │`
M1 over limit (D15a): `│ ⚠ ₱500.00 is more than Ana's ₱320.00. Not on her share yet. │`

M2 Receipt check with adjustments:
```
│ Food in Salo                     ₱2,340.00 │
│ Service charge                     ₱234.00 │
│ Salo total                       ₱2,574.00 │
│ Discounts and extras              −₱134.00 │
│ Adjusted total                   ₱2,440.00 │
│ Receipt total               [ ₱2,440.00 ]  │
│ ✓ Matches the receipt.                     │
```

M3 Adjustment sheet (drawer, 375):
```
┌ Add discount or charge ──────────────────── ✕ ┐
│ ( • Discount )( Extra charge )                 │
│ Reason  [ Senior citizen  ▾ ]                  │
│ Note    [ ____________ ]  optional             │
│         Everyone at the table sees this.       │
│         Don't type ID numbers.                 │
│ Amount  ( • ₱ [ 184.00 ] )  ( % [ __ ] )       │
│ Who it applies to                              │
│ ( • ) One person        [ Lola ▾ ]             │
│ (   ) Split by what each ordered               │
│ (   ) Split equally                            │
│ (   ) Exact amounts                            │
│ (   ) Decide later                             │
│ ── Effect ──                                   │
│ Lola   ₱1,012.00 → ₱828.00                     │
│ [ Save ]                          [ Remove ]   │
└────────────────────────────────────────────────┘
```
M3 split / equal: people checklist (all with food ticked by default) under the chosen option; Effect lists each person.
M3 exact amounts:
```
│ Lola  ₱[ 100.00 ]   Ana  ₱[  34.00 ]   │
│ ₱20.00 left to assign    [ Save ] (disabled) │
```

M4 Card footer (Lola):
```
│ Food subtotal                    ₱920.00 │
│ Service charge                    ₱92.00 │
│ Senior citizen discount         −₱184.00 │
│ Total                            ₱828.00 │
```

M3 % mode: `Amount ( ₱ ) ( • % [ 10 ] )  = ₱234.00 of selected food ₱2,340.00`; Effect lists each person's before → after.
M3 waiting: Effect reads "Waiting for prices. Shares show once every dish has a price." Save still allowed.
M3 edit: title "Edit discount" / "Edit charge"; [Remove] shown; tapping it → `Remove this? [ Yes, remove ] [ Keep ]`.
M3 Other: under Reason, "Credit? Choose Discount, Other."

M6 Ended banner (host and guest): `This order has ended. Everyone can still look at the tickets until Nov 30. The host can still fix prices and the bill.`

M5 Dock while unresolved: `[ My share so far · ₱828 ]` / short `[ Share so far ₱828 ]`.
