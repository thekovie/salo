# Salo v1.4: billing, co-hosts, continuity (plan)

Owner's brief, kept in full: [`salo-v1-4-brief.md`](salo-v1-4-brief.md). Phase 0 audit: [`salo-v1-4-audit.md`](salo-v1-4-audit.md). Baseline screenshots: `.shots/before/` (git-ignored; v1.3 shots archived in `.shots/v1-3/`).

Each slice ships as its own branch and squash PR into `dev` (HANDOFF working rules). One slice per session: `/clear`, then `/workflow:kickoff slice N of docs/plans/salo-v1-4.md`. Later slices get their own research, decisions and text sketch when they start; the cross-cutting decisions below are settled now because they shape migrations.

## Slices

| Slice | Brief | Content | Migration | Status |
|---|---|---|---|---|
| 0 | Phase 0 | Audit (`salo-v1-4-audit.md`) + this plan | — | done (decisions answered 2026-11-23) |
| 1 | F01 + F11 (pricing part) | Price status in What's next, quick-entry Prices sheet, draft persistence, guest "so far" label | none | landed (PR #51) |
| 2 | F02, F03 | Receipt adjustments, allocation methods A–E, adjusted vs actual totals | 0013 | landed (PR #52) |
| 3 | F04 (+F12 lock fix) | Co-hosts, `can()` capability map, role re-check under lock, serving precondition | 0014 | landed (PR #53) |
| 4 | F05, F06 | Multiple receipts, shared-dish splits | 0015 | landed (PR #54) |
| 5 | F07 | Payment ledger, derived balances | 0016 | landed (PR #55) |
| 6 | F08, F09 | My order sheet, host transfer | none (D39) | landed (PR #56) |
| 7 | F10, F12 | Manifest `id`/`scope`, invite continuity copy, reliability fixes + tests | — | landed (PR pending) |
| 8 | F11, F13, F14, F16, F17 | Billing flow polish, export options, large-order search/collapse, menu link, creation animation (tail-less table: current mark has a speech-bubble tail, `brand/logo.tsx:3-6`; aligned to the final logo in slice 10) | 0017 | not started |
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
| L16 | F05 "Allow one dining session to record multiple restaurant receipts." | `receipts` | 4 | planned (slice 4 section) |
| L17 | F06 "Allow the host to allocate a shared item's cost among selected participants." | Split payers | 4 | planned (slice 4 section) |
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

Status: landed (PR #52)

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

## Slice 3: co-hosts and safe serving (F04, F12 lock fix)

Status: landed (PR #53)

Research brief (2026-11-23, researcher) cited below; baseline in `.shots/before/` (slice 2 shots moved to `.shots/v1-4-slice2/`). D2 (`participants.cohost_at`) and D3 (count precondition) are already decided. Pre-existing, seen in baseline: at 320 long guest names wrap to 3–4 lines and squeeze the Ready chip (chip text wraps) in `people-host-long-names-320`; the "Kain na!" toast covers a row above the dock there. Not this slice's scope unless D17's control makes it worse.

### Ask ledger (slice 3)

Brief F04 quoted from `salo-v1-4-brief.md:382-440`, F12 scenarios from `:762-800`.

| # | Owner's words | Planned change | Status |
|---|---|---|---|
| S3.1 | "Introduce an optional **Co-host** role. Co-hosts assist with food tracking but do not receive complete administrative privileges." | `participants.cohost_at`; `can()` grants a co-host `serving.update` only | done |
| S3.2 | Permission table: co-host "Update serving quantities: Yes", "Undo serving updates: Yes"; "Confirm rounds / Correct confirmed orders / Manage participants / Manage billing adjustments / Assign co-hosts / End session: No" | Co-host gets the stepper and All served; "Change…" (corrections, `round.open`) stays host-only; every other host check unchanged | done |
| S3.3 | "The host can: Promote guests to co-hosts. Revoke co-host permissions. View which participants are co-hosts." | People tab card: "· co-host" mark (everyone sees it), host control "Make co-host" / "Stop co-host" (D17) | done |
| S3.4 | "Co-hosts can: Mark portions as served. Update partial-serving quantities. Undo incorrect serving updates. View serving progress." | Same Served section as the host (stepper ±, All served, done rows reopen); undo = stepping down, as today | done |
| S3.5 | "Implement explicit capability checks such as `serving.update`." / "Enforce permissions in server-side mutations." | `can(actor, "serving.update")` with a `cohost` actor field; server is the authority | done |
| S3.6 | "Revalidate capabilities on every write." / "Ensure revoked co-hosts cannot continue updating food." / F12 "Host revokes a co-host while an update is pending." | `runMutation` re-reads role + `cohost_at` under the session lock and hands the fresh actor to `apply` (all mutations, not only serving) | done |
| S3.7 | "Handle simultaneous serving changes atomically." / F12 "Two co-hosts mark the same dish served simultaneously." | D3: request carries `expectedServed`; mismatch applies nothing and returns the current count | done |
| S3.8 | "Clamp served quantities to valid bounds." | Kept (`serving.ts:36`) | done |
| S3.9 | "Preserve idempotency on retries." | Unchanged replay path (`mutations.ts:59-75` runs before `apply`), retry keeps key and its original seen count | done |
| S3.10 | "Record the actor responsible for serving updates when practical." | Already: `served_counts.updated_by` + `mutation_records.actor_id`; add `actorId` to the `serving.updated` event payload. No UI | done |
| S3.12 | D19 (owner): hint for the host | M4 line in the host's Served section | done |
| S3.11 | F12 potential events "Co-host assigned. Co-host revoked." / Phase 3 "Realtime status propagation." | Events `participant.cohostSet` / `participant.cohostRevoked` (refetch makes it live); notification to that person per D18 | done |

### Today

- `can()` is a flat host-only set; `serving.update` is in `HOST_ONLY` (`src/lib/permissions.ts:31-36`). Actor resolved before the transaction (`auth/actor.ts:13-46`); routes close over it (`serving/route.ts:11,16`).
- `runMutation` locks the session and re-checks only `removedAt` (`mutations.ts:51-57`), so a write queued behind a role change lands with the old role (audit F12 gap).
- Serving: `updateServed` checks `can` (`serving.ts:15`), clamps `before = min(stored, expected)` and applies the delta (`:35-36`); `served_counts.revision` written, never checked (`:37`). Two taps for the same plate both land.
- Client: `src/hooks/use-served-edits.ts` coalesces taps (300 ms, `:7`), POSTs `{roundId, lineKey, delta}` with a key (`:56-62`), retries same key on Try again / `online` (`:89-93`). Edits are in memory only.
- UI: `ServedSection canEdit={isHost && sessionOpen}` (`workspace.tsx:233`) gates stepper, All served, done-row reopen and "Change…" together (`served-section.tsx:79-151`).
- People tab card heading shows "(you)" and "· host" (`people-view.tsx:138-143`); host's right cluster has the Ready pill, item count and a `UserX` icon opening `RemoveGuestSheet` (`:144-162`).
- Snapshot participants are `{id, displayName, role}`, `me` is `{participantId, role, displayName}` (`sessions/snapshot.ts:73-76`, `lib/snapshot.ts:16,21`). Any SSE event refetches the snapshot (`use-session.ts:292-293`).
- Latest migration `0013_adjustments`.

### Approach

- **Migration 0014** (`drizzle/0014_cohosts.sql`): `participants.cohost_at timestamptz NULL`; CHECK `cohost_at IS NULL OR (role = 'GUEST' AND removed_at IS NULL)`. Additive; rollback drops the column. `docs/data-model.md` line. (`notifications.type` is plain text, `schema.ts:462`: no CHECK to change.)
- **Permissions**: `Actor.cohost?: boolean` (optional so test literals compile); `can(actor: Pick<Actor,"role"|"cohost">)` returns true for `serving.update` when `actor.cohost`. New action `cohost.set` in `HOST_ONLY` (brief §6's `participant.cohost.assign/revoke`, adapted to one action). `resolveActor` selects `cohostAt`. Client: `canServe = can(snapshot.me, "serving.update") && sessionOpen`, so the capability map stays the single source; `canEditEntry` (`workspace.tsx:310`) is the only other client caller and needs nothing.
- **Lock re-check (F12)**: per D20. `runMutation` selects `{removedAt, role, cohostAt}` under the lock and builds `fresh = {...actor, role, cohost}`. Replay still runs first (a replay is an earlier legitimate write).
- **Assign / revoke**: `PUT /api/sessions/[id]/participants/[pid]/cohost` body `{cohost: boolean}`, modelled on `participants/[pid]/remove/route.ts`; host only, not on closed orders. Target loaded `FOR UPDATE` like `loadGuest` (`people.ts:182-192`) but: host → 409 `NOT_A_GUEST`, removed → 409 `ALREADY_REMOVED` (else the CHECK would 500), unknown → 404. Same value → 200 no-op, same event type, no notification. Key type `participant.cohost:<pid>`. Events `participant.cohostSet` / `participant.cohostRevoked` (payload ids only), both in `NON_TICKET_EVENTS` (`settlement.ts:15`) so the host's pending Confirm stays fresh. `removeParticipant` clears `cohost_at` in the same `UPDATE` as `removed_at` (`people.ts:~208`, required by the CHECK); `restoreParticipant` (`people.ts:226`) leaves it null, so Undo gives a plain guest.
- **Notifications (D18)**: `NotificationType` (`lib/notifications.ts:3`) gains `participant.cohostSet` / `participant.cohostRevoked`; cases in the exhaustive `notificationText` (`:35-58`); `notificationTarget` cohostSet → `"served"`, cohostRevoked → `"order"`. Recipients `[pid]`; subject carries the host's display name; dedup key `cohost:<pid>:<session.revision+1>` (a re-assign after a revoke must notify again; `notify` is `onConflictDoNothing`). Rows in `docs/contracts/notifications.md` + `tests/contract-notifications.test.ts`.
- **Client assign / revoke**: per D21. Queued path = new `Op` kind `setCohost {participantId, name, cohost}` in `use-session.ts` (union `:48`, `OP_KINDS` `:87`, `request()` `:137` PUT, `describeOp()` `:183`: "Make {name} a co-host" / "Stop {name}'s co-host role"). Control component `cohost-toggle.tsx` (button + its busy/error text); `workspace.tsx` (794/800 lines) gets only prop plumbing.
- **Serving precondition (D3)**: `servingSchema` gains required `expectedServed` (int ≥ 0). `updateServed` checks `can(fresh, "serving.update")` and compares `expectedServed` with the clamped `before`. Result shape `{served, revision, applied}` (`revision` = the served row's, 0 if none; `applied: true` also on a clamped no-op, V13). Mismatch → `{served: before, revision, applied: false}`; `served_counts` and notifications untouched; `runMutation` still writes session revision +1, one `serving.updated` event and the mutation record (so a replay returns the same `applied: false`). This is not a refusal; the contract doc says so. Event payload gains `actorId`. Forbidden copy: "Only the host and co-hosts can mark food as served."
- **Client hook** (`src/hooks/use-served-edits.ts`): `bump` gains a `seen` argument; `ServedSection` passes `row.line.shown + (edit?.sending ?? 0)` (server count the row stood on, counting a batch in flight). The hook stores `seen` on the edit when its first unsent tap lands (`unsent` 0 → non-zero) and sends it as `expectedServed`; later taps in the same 300 ms batch don't change it; a retry keeps key and `seen`; the next batch takes `seen` from its own first tap, never from a response. Response at `data.result.applied` (`ok()` wraps `{result, revision, replayed}`, `http.ts:15`). On `applied: false`: await `refresh()` as on success, then clear `sending`, `unsent`, key; no `failed`, no flash of the stale count. Hook signature `useServedEdits(sessionId, refresh, revision, canServe)`: when `canServe` turns false, or a serving POST returns 403, drop all edits and timers (no stuck "Couldn't save this" row).
- **UI**:
  - `workspace.tsx`: `canServe` to `ServedSection` `canEdit`; new prop `canChange = isHost && sessionOpen` gates both `changeButton` call sites (`served-section.tsx:~75,~140`).
  - People card (M1): "· co-host" after the name for everyone; host control per D17, gated like `onRemoveGuest` (`people-view.tsx:152`: participant bucket, GUEST, not removed).
  - Co-host: D18 notification + M3 note at the top of their Served section (shown while `me.cohost` and the section renders). Host: M4 quiet line at the bottom of the Served section when the order is open, no co-host and ≥1 active guest; not dismissible; its link calls `onOpenPeople` → `setView("people")`.
  - Snapshot: `participants[].cohost`, `me.cohost` (boolean; `snapshot.ts:~23` selects `cohostAt`, `me.cohost` from that row, not the actor); `everyone()` (`lib/snapshot.ts:119`) sets `cohost:false` for removed people; `PersonBucket.cohost`. Literals in `tests/overlay.test.ts:24`, `tests/guide.test.ts:7,10` updated.
- **Copy siblings**: `docs/ux-specification.md:59,78` ("host's steppers" → host and co-hosts); `docs/api.md:46` role column "host or co-host" + new PUT row, `docs/realtime.md:12`, `docs/security.md` role line, `docs/contracts/serving.md` write rule; code comments `served-section.tsx:14,28`, `src/hooks/use-served-edits.ts:34`. `invite-sheet.tsx:122` and `workspace.tsx:217,656` stay true, unchanged.

Rejected: a `COHOST` role value (D2); 409 on precondition mismatch (rolls back cleanly but the client needs a second round trip to learn the count; D3 says the stepper updates from the reply).

### Reuse
- `RemoveGuestSheet` trigger styling and `onRemoveGuest` gating (`workspace.tsx:687`) for the co-host control; `remove/route.ts` for the route shape.
- Existing notification center (`notify`, `notifications-drawer.tsx`) for D18; SSE refetch for live updates.
- `trackerLines` `shown` (`serving.ts:100`) as the seen count; `tests/helpers/session.ts` actor builders extended with a co-host helper.

### Not doing
- Any co-host capability beyond serving (confirm, corrections, people, billing, End stay host-only).
- Host transfer (slice 6), co-host cap (bounded by participant limit), persisting serving edits across reload (slice 7 F12), a serving history / "marked by" UI.
- Analytics events for co-hosts (brief asks none).
- Guide copy changes (`guide-steps.ts:73` stays; the People control and D18/D19 are the prompts).

### States

| State | After |
|---|---|
| Host, People tab, guest | "· co-host" absent; control per D17 "Make co-host" |
| Host, People tab, co-host | "Jun · co-host"; control "Stop co-host" |
| Guest / co-host viewing People | "· co-host" mark, no controls |
| Order ended | Marks stay; no controls (assign/revoke refused on closed orders) |
| Co-host, Served section, open | M3 note on top; stepper, All served, done rows reopen; no "Change…" |
| Co-host, order ended / no confirmed round | Read-only / section hidden, as guests today |
| Plain guest | Unchanged read-only |
| Two co-hosts tap the same plate | One lands; the other's row snaps to the new count, no error |
| Revoked while a tap is pending | Write refused under the lock; controls disappear on refetch; no stuck "Couldn't save" row; notification per D18 |
| Removed co-host, then Undo | Back as plain guest |
| Assign/revoke saving / failed | Button "Saving…" (queued or waiting, D21) and keeps its place; a refused write shows the error text under the button and re-enables it; tapping again retries (new key) |
| Host Served section, no co-host, guests present | M4 line "Busy table? Make a guest a co-host so they can help. →"; hidden once anyone is co-host, with no guests, or after End |
| Tab opened before deploy (no `expectedServed`) | 422, failed row; accepted for this release |
| Long names, 320 | Heading wraps; control 44 px on its own line under the heading (D17 a) |
| Widths | 320, 360, 375, 390, 430, 768, 1280; light and dark |

### Decisions

Owner answers 2026-11-23: D17 (a), D18 (b) notification + M3 note, D19 (b) quiet hint line, D20 (a), D21 (a). M3 confirmed as sketched.

- **D17 [decided: (a) own-line button] Where the host makes a co-host.** (a) Text button on its own line under the card heading, host only: "Make co-host" / "Stop co-host" (M1a); (b) replace the `UserX` icon with one "Manage Jun" sheet holding Make co-host + Remove (M1b); (c) a "Co-hosts" list with switches in the Order options sheet (M1c). Recommend (a): the right cluster is already full at 320 (pill + items + remove, `people-view.tsx:144-162`), a labelled button is clearer than a new icon, and it sits beside the "· co-host" mark the brief asks the host to see; (b) adds a tap to Remove; (c) hides it from where people are listed.
- **D18 [decided: (b) notification + M3 note] How a new co-host finds out.** (a) Notification-center item to that person only: "{Host} made you a co-host. You can mark food as served." / "{Host} stopped your co-host role." (no M3 note); (b) (a) + M3 permanent note above their Served section; (c) M3 note only. Recommend (a): brief §7 lists "Co-host assigned / revoked" events, the notification is the first-use prompt, and a permanent note pushes steppers down at 320 (plan-critic).
- **D19 [decided: (b) quiet non-dismissible line] Hint for the host in the Served section** (M4). (a) none, the People control is the entry point; (b) one quiet, non-dismissible line when no co-host and ≥1 guest, links to People. Recommend (a): no ask justifies it and it would show on every visit (plan-critic); the memory rule is met by the People control where people are managed.
- **D20 [decided: (a) serving uses fresh, other writes ROLE_CHANGED guard] Scope of the lock re-check.** (a) `runMutation` passes `fresh` as an optional third `apply` argument; only `updateServed` uses it now; every other write throws 403 `ROLE_CHANGED` when `fresh.role !== actor.role` (covers slice 6's transfer in a few lines); (b) sweep all ~25 `apply` callers to use `fresh`. Recommend (a): same guarantee ("Revalidate capabilities on every write"), no behaviour change elsewhere this slice, ~25 fewer route edits.
- **D21 [decided: (a) queued like remove] Offline co-host change.** (a) Queued like remove (`use-session.ts:87`), "Saving…" until reconnect, same key retries; (b) direct call that fails fast with "Not saved. Try again". Recommend (a): consistent with remove and ready; an offline host can't reach the server either way, and the server enforces the revoke the moment it lands.

### Assumptions
- Mobile scope: responsive + native feel (D6 carried); controls 44 px, no hover-only behaviour.
- Precondition mismatch is a 200 `applied: false`, not 409 (Approach).
- A tab opened before deploy sends no `expectedServed` and gets 422 (failed row) until reload; accepted.
- `expectedServed` is required; the only clients are ours and `scripts/contract/serving-http.mjs` (updated).
- Removing a co-host clears the role; Undo restores a plain guest.
- No limit on co-hosts.
- Co-hosts count as guests for readiness ("Ready / Still choosing", `people.ts:33`).
- Assign/revoke refused on ended orders (no `allowClosed`).

### Done when
- `timeout 900 pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e` pass (Postgres via `pnpm db:up`).
- Unit: `tests/permissions.test.ts` co-host matrix (only `serving.update` true); `served-edits` helper: seen count, `applied:false` adoption, drop on revoke.
- Contract (`tests/contract-serving.test.ts` + `docs/contracts/serving.md`): K01-K05 / V02-V04 / V13 / I02-I03 rewritten for the precondition; new rows: co-host 200, revoked co-host 403, demotion between `requireActor` and lock refused, mismatch returns current count with `served_counts` and notifications untouched (revision +1 and one event, as pinned), retry of a stale batch applies nothing, actorId in payload. New `tests/contract-cohosts.test.ts` + `docs/contracts/cohosts.md`: assign, revoke, idempotent same value, guest 403, target host 409 `NOT_A_GUEST`, removed 409 `ALREADY_REMOVED`, unknown 404, re-assign after revoke notifies again, closed 409, removal clears, events keep Confirm fresh.
- E2E (`e2e/cohosts.spec.ts`): host makes Jun co-host, Jun sees the note and steppers live, marks one served, host sees it; Liza (guest) still read-only; host revokes, Jun's controls vanish; two co-host tabs tap the same plate, count ends at one; axe light/dark on People and Served. `food-tracker.spec.ts` stays green.
- Manual: shots of every state above.

### Skills
- `impeccable` + `.impeccable/surfaces/src-app.md`: Operate surface.
- `database-migrations`: 0014 (`pnpm db:generate`).
- `backend-patterns` + `contract-first`: route, contract docs; read `node_modules/next/dist/docs/` per AGENTS.md.
- `frontend-a11y` / `accessibility`: button names ("Make Jun a co-host"), live status.
- `mobile-native`: 44 px targets.

### You need to do
- [ ] After merge, the first app start runs migration 0014 (watch logs).

### Mockups (slice 3, text sketch)

M1a People card, host, 375 (D17 a):
```
┌──────────────────────────────────────────────┐
│ Jun · co-host        [✓ Ready] 3 items  (⊗)  │
│ [ Stop co-host ]                             │
│ Sisig ×2 · Halo-halo                         │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ Liza          [◷ Still choosing] 2 items (⊗) │
│ [ Make co-host ]                             │
│ Chicken Inasal ×2                            │
└──────────────────────────────────────────────┘
```
M1b (D17 b): right cluster `[✓ Ready] 3 items (⋯)`; ⋯ opens "Jun" sheet: `[Make co-host]` `[Remove from the order]`.
M1c (D17 c): Order options sheet section "Co-hosts · can mark food served" with a switch per guest.

M2 People card, guest or co-host viewing: `Jun · co-host   [✓ Ready] 3 items` (no buttons).

M3 Co-host's Served section, 375:
```
Served
You're a co-host: you can mark food as served.
Sisig                              [ − 1 + ]
1 of 2 served · 1 waiting
[ ✓ All served ]
```
(no "Change…")

M4 Host's Served section footer (D19 a): `Busy table? Make a guest a co-host so they can help. →`

D18 notifications: "Ana made you a co-host. You can mark food as served." / "Ana stopped your co-host role."

## Slice 4: multiple receipts and shared-dish splits (F05, F06)

Status: landed (PR #54)

Research brief (2026-11-24, researcher) cited below; baseline in `.shots/before/` (seed `.shots/before/seed.mjs`, index `README.md`; slice 3 shots moved to `.shots/v1-4-slice3/`). Pre-existing, seen in baseline: on a payer's card the tag "table price · from Whole table" wraps to two lines at 375 (`kkb-shared-billed-375`); at 320 long names make each Bill to chip wrap to 2 lines and "Billed to Maria Concepcion dela Cruz-Villanueva" runs 4 lines (`kkb-long-names-320`); the session header title button is 25 px next to 44 px buttons (geometry finding in every shot). Not this slice's scope unless the new UI makes them worse.

### Ask ledger (slice 4)

Brief F05 and F06 quoted from `salo-v1-4-brief.md:449-530`.

| # | Owner's words | Planned change | Status |
|---|---|---|---|
| S4.1 | "Allow one dining session to record multiple restaurant receipts." | Host adds extra receipts beside the existing one, which becomes "Main receipt" once there are two | done |
| S4.2 | "Each receipt should support: Optional descriptive label. Actual total amount. Associated participants or relevant allocations. Recorded adjustments. Reconciliation status." | Receipt = label (optional, ≤ 40) + typed total + who it covers (D22) + the adjustments on those people (derived, listed) + its own match / more / less chip | done |
| S4.3 | "Example: Main table receipt, Senior citizen receipt, PWD receipt" | Label hint "e.g. Senior citizen receipt" | done |
| S4.4 | "The receipts should be created when needed, not before ordering." | "Add another receipt" lives only in the Receipt check block (after a confirmed round, as today); nothing before ordering | done |
| S4.5 | "Never double-count the same item or payment obligation." | A person can be on one extra receipt only (DB unique + picker disables people already covered); Main = everything not on an extra receipt | done |
| S4.6 | "Never assume a separate receipt automatically belongs entirely to one participant." | Receipts never change anyone's share; they only compare. A receipt can cover several people | done |
| S4.7 | "Keep unassigned amounts visible." | Main receipt shows what it carries, incl. "Decide later" adjustments; an extra receipt whose people have nothing on the bill is flagged | done |
| S4.8 | "Ensure total receipt amounts reconcile with participant obligations." | Per-receipt chip + "All receipts ₱X · Salo ₱Y" summary row when there are two or more | done |
| S4.9 | "Preserve the standard single-receipt workflow as the default." / "Avoid building a complete billing-group engine…" | No extra receipts → block, labels, chip and Copy summary byte-identical to today; receipts cover people, not lines | done |
| S4.10 | "Allow the host to allocate a shared item's cost among selected participants." | Bill to gains "Split equally" across picked people (D23) | done |
| S4.11 | "Initially support: Equal division. Selected participants. Explicit payer assignment. Custom amounts may be implemented if necessary…" | Equal split among selected people; explicit payer = today's one-person Bill to; custom amounts per D24 | done |
| S4.12 | "Preserve the original source order. Do not change the waiter ticket." | Split stored in settlement only; tickets, Items text/PNG, confirmed snapshots untouched (`lib/snapshot.ts:39-44`) | done |
| S4.13 | "Separate who submitted the order from who pays." | Origin row stays in its shared section tagged "Split 3 ways: Jun, Liza, Ana"; each payer card shows its share "from Whole table" | done |
| S4.14 | "Prevent duplicate billing." | One-person Bill to and split are mutually exclusive on the same settlement row (one revision); shares sum to the line subtotal | done |
| S4.15 | "Recalculate shares when the item's price changes." | Only the set of people is stored; shares derived in `buildKkb` | done |
| S4.16 | "Handle cancellation and replacement correctly." | Shares follow the effective line (quantity corrections, replacement price); Bill to / split also offered on replacement lines (fixes today's hole, `kkb-view.tsx:78`) | done |
| S4.17 | "Use deterministic rounding." | `allocate` with equal weights (largest remainder, ties by payer key) | done |
| S4.18 | "Shared-cost allocation must also be compatible with receipt discounts." / "…does not automatically establish eligibility for a statutory discount." | Split shares count as the payer's food (service weight, proportional / % basis, D15 cap), like Bill to today; discounts still pick people explicitly, never from dish payers | done |

### Today

- **Receipt**: one `sessions.receipt_total_centavos` + `receipt_total_revision` (`schema.ts:57-58`); `PUT /receipt-total` (`receipt-total/route.ts:9-17`, `allowClosed`) → `setReceiptTotal` (`settlement.ts:159-166`); snapshot `settlement.receiptTotal` (`sessions/snapshot.ts:110`, `lib/snapshot.ts:67,91`). `reconcile(kkb, centavos)` compares with `kkb.adjustedTotal` after the incomplete / pending / waiting gates (`kkb.ts:316-324`). `ReceiptCheckBlock` (`receipt-check-block.tsx`, 97 lines): Food in Salo / Service charge / Salo total (`:80-82`), Discounts and extras + Adjusted total when any (`:83-84`), host `AmountEditor` "Receipt total (₱)" + chip (`:87-90`), chip copy `:29-40`. Mounted once at `kkb-view.tsx:166`. `kkbText` never mentions the receipt (contract S08).
- **Bill to**: per entry, whole line, one payer: `entry_settlements.bill_to_participant_id | bill_to_label` (`schema.ts:366-382`, one-payer CHECK `:381`), `PUT /entries/[id]/settlement` (`allowClosed`, key `entry.settle:<id>`) → `setEntrySettlement` (`settlement.ts:34-74`): host only, shared lines only (422 for personal), person must be active. Body `entrySettlementSchema` (`validation.ts:108-116`).
- **Math**: `buildKkb` routes a billed shared line twice: counted on the payer card (`billedFrom`), listed uncounted in the shared section (`billedTo`) (`kkb.ts:113-129`). `billBlockers` treats any shared line without `billedTo` as `unbilled`, which blocks the service charge and every adjustment (`kkb.ts:242-251`, used `:134,260`). Service charge and adjustments weight by `pricedCentavos` (`kkb.ts:261-268`, `adjustments.ts:71,82,87`).
- **Picker**: radio chips "No one yet / Host (you) / Jun / Liza" in the inline `PriceEditor` fieldset "Bill to" (`price-editor.tsx:197-210`), copy "The whole dish goes to one person…" (`:200`); offered when `isHost && line.billable && !line.correctionId && !draft` (`kkb-view.tsx:78`). `billKeyOf` lower-cases labels (`price-editor.tsx:45`) while `payers` uses `normalizeText` (`kkb-view.tsx:51`): preselection can miss for a label that differs only by NFKC/whitespace.
- **Replacement hole**: a replaced shared line keeps routing by the source entry's Bill to (`kkb.ts:118`), the server accepts Bill to on it, but the UI hides Bill to on replacement lines (`!line.correctionId`), so a shared dish swapped before billing blocks the service charge forever.
- **Typed names**: claim approval adopts adjustment-share labels (`people.ts:151` → `adoptLabelShares`, `adjustments.ts:99-111`) only once the label has no food left; `labelHasFood` already counts `entry_settlements.bill_to_label` (`adjustments.ts:95`), so Bill to labels never need adopting.
- `workspace.tsx` is at 800/800 lines; `kkb.ts` 449, `kkb-view.tsx` 415, `price-editor.tsx` 243, `schema.ts` 535. Latest migration `0014_cohosts`.

### Approach

Store only who and what the host typed; derive every share and expected total in pure code, as slices 1–2.

- **Migration 0015** (`drizzle/0015_receipts_splits.sql`, additive; rollback drops the three tables):
  - `entry_payers`: `entry_id` (FK `order_entries`, cascade), `session_id` (cascade), `participant_id` nullable (FK, no cascade: participants are soft-removed), `bill_to_label` nullable (tidied, ≤ 40), `num_nonnulls = 1`; unique `(entry_id, participant_id)` and `(entry_id, bill_to_label)`; `*_same_session` trigger on entry + participant (pattern `0007_settlement.sql:43-64`). Rows exist only for a split (≥ 2 people).
  - `receipts`: `id uuid` (client-generated), `session_id` (cascade), `label` nullable (≤ 40), `total_centavos` nullable (0 … `MAX_SERVICE_CHARGE_CENTAVOS`, same cap as the receipt total), `revision ≥ 1`, `created_at`, `updated_by` (set null), `updated_at`, `session_idx`.
  - `receipt_people`: `receipt_id` (cascade), `session_id`, `participant_id` | `bill_to_label` (`num_nonnulls = 1`); unique `(session_id, participant_id)` and `(session_id, bill_to_label)` so a person sits on one extra receipt at most (S4.5); same-session trigger.
  - The main receipt stays the existing `sessions.receipt_total_*` (no backfill; R01-R05, V01 and `docs/contracts/receipt-total.md` stay valid). No `adjustments.receipt_id` (audit §4 idea dropped: adjustments reach a receipt through the people they apply to).
- **Split API**: extend `PUT /entries/[id]/settlement`: `entrySettlementSchema` gains `splitAmong: [{participantId} | {label}]` (2 … `LIMITS.participantsPerSession`, distinct), mutually exclusive with `billTo` (zod refine). Setting `splitAmong` clears `bill_to_*` and replaces `entry_payers`; setting `billTo` (incl. null) deletes `entry_payers`; both bump the one `entry_settlements.revision` (so switching modes can't race). Same checks as Bill to (host, shared line, typed labels tidied). Duplicates by `personKey` (participantId, or `normalizeText` of the label) → 422 "Pick each person once" before insert (else `allocate`'s Map collapses keys and shares stop summing); DB backstop unique on `(entry_id, lower(bill_to_label))`. Newly added people must be active (404 `PERSON_NOT_FOUND`, as `settlement.ts:44`); a person already in the stored set may stay, and the editor lists them ticked "(left)" so the host can untick. Same two rules for receipt people (unique `(session_id, lower(bill_to_label))`). Same event `entry.settled`, same key type.
- **Receipts API** (host only, existing `receipt.set` action, `allowClosed: true`, `assertBillable`):
  - `PUT /api/sessions/[id]/receipts/[receiptId]` `{expectedRevision, label, totalCentavos, people: [{participantId}|{label}]}`, `expectedRevision 0` creates; people ≥ 1; replaces `receipt_people` in the transaction; a person already on another receipt → 409 `ALREADY_ON_RECEIPT` (unique violation mapped, never 500); `LIMITS.receiptsPerSession = 10` next to `adjustmentsPerSession` (`validation.ts:21`); 11th → 400 `TOO_MANY_RECEIPTS`. `totalCentavos` nullable: Save works with a blank total.
  - `DELETE …/receipts/[receiptId]` `{expectedRevision}`; missing → 404 `RECEIPT_NOT_FOUND`; stale → 409.
  - Events `receipt.set`, `receipt.removed` in `NON_TICKET_EVENTS` with the `tests/serving.test.ts:102` assertion (event names `receipt.set` / `receipt.removed` deliberately match the `receipt.set` action; docs say so). Keys `receipt.set:<id>` / `receipt.remove:<id>`.
  - Claim approval: `labelHasFood` also counts `entry_payers.bill_to_label` (a typed name that is a split payer is never adopted); `adoptLabelShares` also adopts `receipt_people` labels. If the claimant already sits on an extra receipt (any, incl. the same one), delete the label row instead of updating it (else the unique → 500).
- **Snapshot**: `settlement.entries[id].splitAmong?: {participantId, label}[]`, optional and omitted when there is no split (keeps `tests/settlement.test.ts:41` `toEqual` and typed fixtures valid); `settlement.receipts: SnapshotReceipt[]` (with people), ordered by `created_at`; `EMPTY_SETTLEMENT` (`lib/snapshot.ts:91`) and the literal at `tests/guide.test.ts:37` gain `receipts: []`.
- **Split math** (`buildKkb` loop, helper in new `src/lib/splits.ts` so `kkb.ts` stays small): a shared line with `splitAmong` (and no Bill to) pushes one copy per payer with `subtotalCentavos = allocate(subtotal, equal weights by payer key)`, `billedFrom: origin.title`, `splitWays: n`; the origin keeps one listed, uncounted line with `billedTo` = the names. So `pricedCentavos`, service weight, adjustment basis, D15 cap and `foodCentavos` all follow with no further change (shares sum to the subtotal). An **unpriced** split line: payer copies keep `unpricedUnits` and `status: partial` on their own card (each card honestly shows "no price"; `toSection` never counts the `billedTo` origin, `kkb.ts:215-218`), and every bill-wide sum dedupes by `entryId`: `billBlockers` units and pending (`kkb.ts:245,248`), `kkbText` "Not yet settled" (one line under the origin title, `kkb.ts:349-353`) and its reasons. `priceCompleteness` already dedupes (`kkb.ts:292`). Server rejects `splitAmong` < 2 after de-duplication (422); a cancelled line (`quantity ≤ 0`, `kkb.ts:206`) keeps inert rows. A split with a removed person keeps their share on their "(left)" card, as Bill to does today.
- **Receipt math** (new pure `src/lib/receipts.ts`, `reconcile` untouched): `reconcileReceipts(kkb, mainTotal, receipts)` → per receipt `{id, label, covers: names, expectedCentavos, adjustments: titles, state}` where expected = Σ covered cards' `totalCentavos ?? pricedCentavos` + the signed `shares` of **flagged** adjustments for its people (D15 flagged ones count in `adjustedTotal`, `adjustments.ts:115`, but not on cards; they keep `shares`, `:117`); Main expected = `adjustedTotal` − Σ extras' expected (so "Decide later" adjustments and anyone not covered land on Main). Same gates as `reconcile` (incomplete / pending / waiting) for every receipt; an extra receipt with no total → "Enter the total"; a covered person with no card or ₱0 → flagged "Ana has nothing on the bill". Overall: Σ receipt totals vs `adjustedTotal` when every total is entered.
- **UI** (new files; `workspace.tsx` untouched: everything rides on the snapshot already passed to `KkbView`):
  - `ReceiptCheckBlock`: no extra receipts → exactly today's markup and copy, plus a quiet "Add another receipt" button for the host. Unlabelled extras read "Receipt 2", "Receipt 3"… by `created_at`. With extras every chip says "on this receipt" (Main included); single-receipt copy "on the receipt" untouched (`e2e/receipt-check.spec.ts:46,55`). Covers line: names, "Host, Jun and 4 more" past 3 (`names`, `adjustments.ts:51`). Main with no total shows today's "Enter the receipt total…" (`receipt-check-block.tsx:97`). With extras → M1: one card per receipt (Main first), each with Salo's expected amount for it, its total field (Main keeps the existing `AmountEditor` "Receipt total (₱)" path; extras open the sheet), its chip; then the "All receipts" row. Region name "Check against the receipt" kept.
  - `receipt-sheet.tsx`: drawer (M2) label, who it covers (checklist of people with food; people on another receipt disabled with "on Senior citizen receipt"), total, Save / Remove with inline confirm, conflict and offline states as `AmountEditor` / `AdjustmentSheet`.
  - `split-picker.tsx` inside `PriceEditor`'s Bill to fieldset (D23 a): chips stay as today; a last option "Split equally…" mounts (not merely shows: `e2e/kkb.spec.ts:62` uses a strict `getByText("JD")`) a checklist of payers and the live "₱260.00 each" line. Copy line changes to "One person pays, or split it equally." Hidden when `payers.length < 2`. Save disabled below 2 with "Pick at least 2 people." A line already split opens on "Split equally…" with its people ticked; `billChanged` (`price-editor.tsx:85`) includes a change of the set and `adoptLatest` (`:72-76`) resets it; the table-price path's `expectedEntryRevision` (`:110`) bumps for it too.
  - Replacement lines (D25): `lineProps` passes the entry's `billTo`, `splitAmong` and `settlement.entries[entryId].revision` for the bill part (today it hands correction lines `billTo: null`, `kkb-view.tsx:70-72`); the editor sends the price to `/corrections/:id/price` and Bill to / split to `/entries/:entryId/settlement` (today all goes to the correction route, `price-editor.tsx:92-99`). Two saves; a conflict on either keeps what was typed.
  - Rows: origin "Split 3 ways: Jun, Liza, Ana" (replacing "Billed to …"; the origin line also carries `splitWays`, since `billedTo` is only a names string and `LineRow`, `kkb-view.tsx:379`, must tell split from Bill to). Payer copy: title `Crispy Pata ×{qty}`, sub-line `₱390.00 of ₱780.00 · split 3 ways · from Whole table` (no fraction glyphs); its action button reads the share; the editor on it is the same entry's editor. Unpriced: `No price yet · split 3 ways · from Whole table`. Check at 320 and 375 (baseline already wraps the shorter tag at 375). Footer "Everything here is billed to someone." counts splits as billed.
  - `kkbText`: split shares appear inside each person's total (food sum), no new line; no receipt lines (S08 kept). Unbilled reason copy unchanged.
- **Docs**: `docs/api.md` (settlement row, receipts rows), `docs/data-model.md:29,62` + KKB section, `docs/ux-specification.md:63-64` (also drop the stale "Read-only after the order ends"), `docs/realtime.md:12` events, new `docs/contracts/receipts.md`, `docs/contracts/table-prices.md` or the settlement contract for split rows, `docs/contracts/adjustments.md` D1 table (new routes).

Rejected: line-level receipt assignment (`entry_settlements.receipt_id`): exact item membership, but it is the billing-group engine the brief says to avoid and reopens per-receipt service and adjustment math. A separate split route: two revisions on one line would let Bill to and a split both land (S4.14).

### Reuse
- `allocate` for split shares; `bucketOf` / `payerOfBillTo` key scheme (`p:<id>`, `n:<normalized>`) for split payers and receipt people.
- `payers` list (`kkb-view.tsx:48-54`) for the split checklist and the receipt's "who it covers".
- `adoptLabelShares` / `labelHasFood` (`adjustments.ts:90-111`) extended for `receipt_people` and `entry_payers`; `personKey` (`adjustments.ts:40`) for duplicate checks.
- Route + revision pattern from `adjustments/[adjustmentId]/route.ts` and `server/orders/adjustments.ts:34-92`; trigger pattern from `0013_adjustments.sql`.
- `Drawer`, `Button`, `AmountEditor`, `useDirectSave` + `useRetryOnReconnect`, `parsePeso`/`formatPeso`, `AdjustmentSheet` layout and Remove confirm.

### Not doing
- Uneven splits, portions or exact amounts (D24), per-receipt service charge (the host types the session's total service across receipts), labelling the Main receipt, line-level receipt membership.
- Receipt lines in Copy summary, Items text/PNG, waiter ticket, invite.
- Who actually paid (slice 5), rotating the odd-centavo winner across dishes.
- Notifications for receipts or splits.

### States

| State | After |
|---|---|
| No extra receipts | Receipt check exactly as today + host "Add another receipt" (guests: unchanged) |
| Two receipts, both matching | M1: Main + Senior citizen receipt cards with ✓ chips; "All receipts ₱3,054.00 · Salo ₱3,054.00 ✓" |
| Extra receipt, no total yet | Its card: "Enter the total"; overall row hidden until every total is in |
| One receipt more / less | Its chip "₱120.00 more on this receipt. Not split."; others unaffected |
| Blocked (unpriced / pending / waiting / unbilled) | Every receipt shows today's incomplete copy once (block-level), no per-receipt chips |
| Covered person has nothing on the bill | Receipt card flag "Ana has nothing on the bill" |
| "Decide later" adjustment with extras | Main card line "Not assigned: Corkage +₱200.00" |
| Flagged (D15) discount for a covered person | Counted on that person's receipt, not Main |
| Receipt sheet: saving / failed offline / conflict / remove confirm / person on another receipt | As `AdjustmentSheet`; disabled checkbox "on Senior citizen receipt" |
| 11th receipt | Add button hidden at the limit; server 400 |
| Guest, open or ended | Read-only cards and chips, no Add / edit |
| Split picker: choosing people | Checklist; "₱260.00 each" (or "₱260.34 or ₱260.33 each" when it doesn't divide); Save disabled below 2, "Pick at least 2 people."; option hidden with < 2 payers; left person in set ticked "(left)" |
| Split, unpriced dish | Origin "Split 3 ways…"; each payer card shows "No price yet · split 3 ways…"; blockers / Copy summary count the dish once |
| Split, priced | Payer cards each show their share; origin row uncounted; service charge unblocked |
| Price changes / quantity corrected / replaced | Shares recompute live; replacement line offers Bill to / split |
| Switch split → one person → split | One mode at a time; never both on cards |
| Payer later removed | Their share stays on the "(left)" card, as Bill to today |
| Ended order, host | Receipts and splits editable (D1); guest read-only |
| Long names, 320 | Split checklist rows wrap under the box; receipt card title wraps; no horizontal scroll |
| Widths | 320, 360, 375, 390, 430, 768, 1280; light and dark; sheets at 320 with keyboard |

### Decisions

Owner answers 2026-11-24: D22–D26 = recommended option. M1, M2, M3a and M4 confirmed as sketched. Follow-up 2 (owner, 2026-11-24): a receipt a name claim leaves covering nobody is kept with its total and flagged "Covers nobody yet. Tap the pencil to pick who." (guest: "Covers nobody yet."), no chip. After build (owner): "Split equally…" stays visible on an already-split dish even with fewer than 2 active payers, so the host can see and fix it.

- **D22 [decided: (a) people it covers] What an extra receipt is tied to.** (a) The people it covers (optional label + total + people); Salo's expected amount = their cards; Main = everyone else (M1); (b) total only: sum of all receipt totals vs Salo's adjusted total, no per-receipt check; (c) line-level: each dish assigned to a receipt. Recommend (a): the brief asks for "Associated participants" and per-receipt "Reconciliation status", which (b) can't give; (c) is the "billing-group engine" the brief says to avoid; (a) reuses card totals that already include splits, service share and that person's discounts (`kkb.ts:261-268`, `adjustments.ts:71`).
- **D23 [decided: (a) inside Bill to] Where the split lives.** (a) Inside the existing Bill to fieldset: chips as today plus "Split equally…" revealing a checklist (M3a); (b) separate "Split…" action on the row opening a drawer (M3b). Recommend (a): one place decides who pays, one revision (S4.14); the e2e `platter.getByText("JD")` chip click (`e2e/kkb.spec.ts:62`) keeps working because the one-person chips are unchanged and the checklist is hidden until chosen.
- **D24 [decided: (a) equal only] Unequal splits.** (a) Equal only this slice; (b) equal + optional portions per person (Jun 2, Liza 1), stored as small integers and fed to `allocate`'s weights, so shares still recalc when the price changes; (c) exact ₱ amounts. Recommend (a): the brief lists equal division first and "Custom amounts may be implemented if necessary"; (b) is the safe upgrade if the owner wants it now; (c) goes stale when the price changes (slice 2 rejected stored shares). Note: Bill to is per entry and whole, so without (b)/(c) one platter ×1 can't be split unevenly.
- **D25 [decided: (a) offer it] Bill to / split on replacement lines.** (a) Offer it (two saves: price to the correction route, payer to the entry route); (b) leave replacement lines without Bill to as today. Recommend (a): brief "Handle cancellation and replacement correctly"; today a shared dish swapped before billing blocks the service charge forever (`kkb-view.tsx:78`, `kkb.ts:118`).
- **D26 [decided: (a) fix] Pre-existing picker bug.** (a) Fix `billKeyOf` to use `normalizeText` while editing `price-editor.tsx` (one line; a typed payer like "Ana " vs "ana" today opens with no chip selected); (b) leave it. Recommend (a): same file, same key scheme the split needs.
- **D6 Mobile scope** carried: responsive + native feel (assumption, below).

### Assumptions
- Mobile scope: responsive + native feel (D6 carried); inputs `text-base`, `inputMode="decimal"`, 44 px targets; mobile baseline re-audited 2026-11-24, nothing regressed.
- Split shares count as the payer's food for service weight, % basis and the D15 cap, the same as a whole-dish Bill to today.
- Odd centavos go by `allocate`'s key order (same as the service charge); at most ₱0.01 per dish.
- Groups and the whole table can't be covered by a receipt or be split payers; people and typed names can.
- The service charge stays one session amount; the host types the total across receipts. A senior receipt with a different service line shows as more/less, never hidden.
- Main receipt is labelled "Main receipt" only once an extra receipt exists; not editable.
- Pre-existing, same file, approved (D26): `billKeyOf` lower-cases labels instead of `normalizeText` (`price-editor.tsx:45` vs `kkb-view.tsx:51`).

### Done when
- `timeout 900 pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e` pass (Postgres via `pnpm db:up`).
- Unit (`tests/splits.test.ts`, `tests/receipts.test.ts`): shares sum to the subtotal for 2–7 people and odd centavos; unpriced 3-way split: `billBlockers` units = quantity and `kkbText` has one "Not yet settled" line; duplicate label (Ana/ana) rejected; left person kept in a split edit; flagged-adjustment attribution to the receipt; price change and quantity correction recompute; split + service charge + proportional discount sums hold; Main = adjusted − extras; covered-nothing flag; no extras → `reconcile` result unchanged; `kkbText` byte-identical with no splits (`.shots/before/kkb-export.txt`).
- Contract: `tests/contract-receipts.test.ts` + `docs/contracts/receipts.md` (create, edit, conflict 409, delete 404, guest 403, closed allowed, cancelled 409, person on two receipts 409, limit 400, cross-session trigger, idempotent replay, events keep Confirm fresh); split rows in the settlement contract (split ≥ 2, billTo + split 422 (repo validation status), personal line 422, newly added removed person 404, kept left person 200, duplicate person 422, switch modes bumps one revision, replacement line Bill to via entry route); claim approval with the claimant already on another receipt does not 500. `contract-billing-after-end` route list gains receipts.
- E2E (`e2e/receipts-splits.spec.ts`): host splits Crispy Pata among Jun and Liza, both cards and the guest's dock update live, service charge unblocks; host adds a Senior citizen receipt for Liza, Main and Senior chips match (split-scenario amounts with the 20% discount: Host ₱880.00, Jun ₱1,232.00, Liza ₱864.00, adjusted ₱2,976.00; Main ₱2,112.00); guest read-only; host edits after End; axe light/dark on both sheets. Existing `kkb.spec.ts`, `receipt-check.spec.ts`, `adjustments.spec.ts` stay green.
- Manual: shots of every state above.

### Skills
- `impeccable` + `.impeccable/surfaces/src-app.md`, `DESIGN.md`, `PRODUCT.md`: Operate surface, ticket world.
- `database-migrations`: 0015 (hand plpgsql after `--> statement-breakpoint`, `pnpm db:generate`).
- `backend-patterns` + `contract-first`: routes, contract docs; read `node_modules/next/dist/docs/` per AGENTS.md.
- `frontend-a11y` / `accessibility`: checkbox group with a legend, labelled amounts, live save status.
- `mobile-native`: decimal keypad, drawer above the keyboard.

### You need to do
- [ ] After merge, the first app start runs migration 0015 (watch logs).

### Mockups (slice 4, text sketch)

M1 Receipt check with an extra receipt (host, 375; amounts from the baseline seed, Crispy Pata billed whole to Jun):
```
┌ Check against the receipt ────────────────────┐
│ Food in Salo                       ₱2,880.00  │
│ Service charge                       ₱288.00  │
│ Salo total                         ₱3,168.00  │
│ Discounts and extras                −₱114.00  │
│ Adjusted total                     ₱3,054.00  │
│ ┌ Main receipt ──────────────────────────────┐│
│ │ Host, Jun · Salo ₱2,541.00                 ││
│ │ Receipt total (₱)   [ 2,541.00 ]           ││
│ │ ✓ Matches the receipt.                     ││
│ └────────────────────────────────────────────┘│
│ ┌ Senior citizen receipt ──────────── [Edit] ┐│
│ │ Liza · Salo ₱513.00                        ││
│ │ Senior citizen discount                    ││
│ │ Receipt total                    ₱513.00   ││
│ │ ✓ Matches the receipt.                     ││
│ └────────────────────────────────────────────┘│
│ All receipts ₱3,054.00 · Salo ₱3,054.00  ✓    │
│ [ + Add another receipt ]                     │
└───────────────────────────────────────────────┘
```
M1 Decide later with extras: Main card gains `│ Not assigned: Corkage            +₱200.00 │`.
M1 no extras: today's block unchanged + `[ + Add another receipt ]` (host only).
M1 guest: same cards without the field, [Edit] and Add.

M2 Receipt sheet (drawer, 375; same seed as M1):
```
┌ Add a receipt ────────────────────────────── ✕ ┐
│ Label   [ Senior citizen receipt ]  optional   │
│ Who it covers                                  │
│ [✓] Liza                         ₱513.00       │
│ [ ] Jun                          ₱1,661.00     │
│ [ ] Host (you)                   ₱880.00       │
│ Receipt total (₱)  [ 513.00 ]                  │
│ Salo has ₱513.00 for Liza.                     │
│ Everyone else stays on the main receipt.       │
│ [ Save ]                            [ Remove ] │
└────────────────────────────────────────────────┘
```
M2 person on another receipt: `[–] Ana   on PWD receipt` (disabled).

M3a Bill to with split (inside the price editor, 375):
```
│ Bill to                                         │
│ One person pays, or split it equally.           │
│ ( No one yet ) ( Host (you) ) ( Jun ) ( Liza )  │
│ ( • Split equally… )                            │
│   [✓] Jun   [✓] Liza   [ ] Host (you)           │
│   ₱390.00 each                                  │
│ [ Save ]                                        │
```
M3b (D23 b): row actions `[ Bill to… ] [ Split… ]`; Split opens a drawer with the same checklist.

M4 Payer card line and origin row:
```
Jun
│ Sisig ×2                             ₱580.00 │
│ Crispy Pata ×1                       ₱390.00 │
│   ₱390.00 of ₱780.00 · split 2 ways · from Whole table │
Whole table · settle at the table
│ Crispy Pata          Split 2 ways: Jun, Liza │  (greyed, uncounted)
```

## Slice 5: payment tracking (F07)

Status: landed (PR #55)

Verify 2026-11-27: reviewer, contract-tester (43/44 + G41 known), qa, ui-critic all SHIPPABLE; follow-ups in `.shots/follow-ups.md`: 1 and 3 done (chip column measured; "of ₱Y" hidden when ₱0), 2 resolved by the addendum below.

Research brief (2026-11-24, researcher) cited below; plan-critic pass applied (2026-11-24). Baseline in `.shots/before/` (seed `.shots/before/seed.mjs`, index `README.md`); slice 4 shots moved to `.shots/v1-4-slice4/`, incl. its `follow-ups.md`. Seeded: order A final (Crispy Pata split Jun/Liza, Liza senior −₱192, "Senior citizen receipt" for Liza, Jun co-host), order C with one unpriced dish, order B 7 long names. Pre-existing, seen in baseline: header title button 25 px next to 44 px buttons (all 26 geometry findings); split sub-line wraps at 375; "Add another receipt" sits at the viewport bottom at 375; ended-order cards start collapsed. Not this slice's scope.

### Ask ledger (slice 5)

Brief F07 quoted from `salo-v1-4-brief.md:531-579`; §5.1 "Payment: Money already paid toward an obligation" (`:984`), §5.2 "Sum of recorded payments. Remaining outstanding balances." and "an unpriced dish must never be treated as a free dish", §6 `settlement.record`, §7 "Payment status updated" + "Notifications should be meaningful, targeted, and non-redundant."

| # | Owner's words | Planned change | Status |
|---|---|---|---|
| S5.1 | "Introduce optional settlement tracking after billing amounts are finalized." | Nothing shows until the host records a payment (no chips, no block); the only new control before that is the host's "Record payment" on cards with a share. Recording before the bill is final: D29 | done |
| S5.2 | "Support: Unpaid / Partially paid / Paid" | Derived per person, never stored: chip (icon + words) "Unpaid" / "Partly paid" / "Paid" | done |
| S5.3 | "Allow the authorized host to record: Payment amount. Payer. Recipient or payee, when relevant. Optional payment method. Optional note." | "Record payment" drawer from a person's card (payer = that card); amount, Paid to (D27), method toggles, note ≤ 40 | done |
| S5.4 | "Show: Total obligation. Amount paid. Remaining balance." | Card footer: existing total row, then "Paid" + payment lines, then "Left to pay"; Payments block with table-wide Collected and Left to pay | done |
| S5.5 | "Do not reset recorded payments if a bill changes. Instead, recalculate the remaining balance." | Payments are rows of their own; balance computed on render from `buildKkb`; a bill drop below paid shows "Overpaid ₱X" | done |
| S5.6 | "Avoid allowing ordinary guests to mark themselves paid without an explicit authorization mechanism." | `settlement.record` host-only (co-hosts too are refused) in `can()`, server-checked; guests see no record or delete control | done |
| S5.7 | "No GCash or Maya integration. No payment processing. No stored card information. No bank-account management." | Method is a label only; no links, numbers or accounts | done |
| S5.8 | §7 "Payment status updated" / "meaningful, targeted, and non-redundant" | D30 (a) notify, D31 (a) retract on delete | done |
| S5.9 | D5 (slice 0) "Payment status visibility" | D28 (a) everyone sees everyone | done |

### Today
- No payment concept in `src` (audit `salo-v1-4-audit.md:28`); the only "payments" text is the privacy page ("no accounts, no ads and no payments", `src/app/privacy/page.tsx:15`).
- Obligation = `KkbSection.totalCentavos ?? pricedCentavos` (`kkb.ts:73-74`; fallback used at `receipts.ts:63`). `totalCentavos` = food + service share + adjustments, null while no service charge and no adjustment (`kkb.ts:280-294`, `adjustments.ts:128`). Splits and Bill to are folded into the payer's food (`kkb.ts:118-141`, `splits.ts:25-32`).
- `buildKkb` runs on the client only (`kkb-view.tsx:43`, `receipt-sheet.tsx:35`, `adjustment-sheet.tsx:46`, `workspace.tsx:141`); the server can't tell who has a share or what is left.
- Card keys `p:<participantId>` / `n:<normalizeText(label)>` (`kkb.ts:153-160`) = `personKey` (`adjustments.ts:40`). Removed people keep a "(left)" card (`snapshot.ts:133-136`); typed names have a card only while they have food (`adjustments.ts:88-98`); claim approval re-keys labels in `adoptLabelShares` (`adjustments.ts:101-125`, `people.ts:159`). `resolvePeople` 404s a newly added removed participant (`person-refs.ts:22-26`).
- "Not final" pieces: `priceCompleteness` (`kkb.ts:308-321`), `billBlockers` (`kkb.ts:265-274`), charge `unset`/`blocked` (`kkb.ts:276-295`), `kkb.unresolved` (`adjustments.ts:128`).
- Cards: `Card` / `SummaryAmount` / `Footer` (`kkb-view.tsx:257-354`, file 435 lines). The Total row prints only with a service charge or adjustment (`kkb-view.tsx:322-340`), else the footer ends at "Food subtotal" / "Priced subtotal". One mount (`summary-sheet.tsx:163`), same view open and ended.
- Delete confirms: billing sheets use an in-sheet "Yes, remove / Keep" row (`adjustment-sheet.tsx:364`, `receipt-sheet.tsx:229`); Undo toasts exist only for draft edits (`workspace.tsx:291-321`); DESIGN.md:48 "Confirm questions stay centred dialogs"; `ConfirmDialog` in `confirm-dialog.tsx`. DESIGN.md:20 "Status, always with an icon and words".
- Snapshot identical for every viewer except `me` and notifications (`sessions/snapshot.ts:18-142`).
- Mutations: `runMutation` (`mutations.ts:44-107`); `can()` + `HOST_ONLY` (`permissions.ts:12-40`); receipts route/server fn (`receipts.ts:21-62`, 409 on an existing id via `expectedRevision` `:30`, 404 for another session's id `:29`); `useDirectSave` reuses the idempotency key only for an identical request (`use-direct-save.ts:28`); events join `NON_TICKET_EVENTS` (`settlement.ts:16`); `docs/realtime.md:12` lists events.
- Notifications: `notify()` excludes the actor and dedups (`server/notifications.ts:25-40`), `source` + delete-by-source exists (`:25-60`); text renders from `subject` only (`lib/notifications.ts:44`); target defaults to "order" (`:30-32`); `notifications.type` has no CHECK (`schema.ts:466`).
- Latest migration `drizzle/0015_receipts_splits.sql` (generated DDL + hand plpgsql same-session triggers `:63-96`); tables cascade from `sessions` (`schema.ts:20-23`), so cleanup (`maintenance/cleanup.ts:13-16`) covers a new table.

### Approach
- **Migration 0016 `payments`**: `id uuid` (client-minted), `session_id` cascade, payer `participant_id | label` (`num_nonnulls = 1`, label 1–40), payee `payee_participant_id | payee_label` (both null = Restaurant; never both set), `amount_centavos` CHECK 1…99,999,999, `method text null` CHECK in (`cash`,`gcash`,`maya`,`bank`,`other`), `note text null` CHECK 1–40, `created_at`, `created_by` participant. Same-session trigger for the three participant FKs, as 0015. Index `(session_id)`.
- **Routes**: `PUT /api/sessions/[id]/payments/[paymentId]` creates; `DELETE` (no body) removes. Host only (`settlement.record` in `HOST_ONLY`), `allowClosed: true`, `assertBillable` (cancelled → 409). Idempotency: the client mints the id when the drawer opens and keeps it until saved; an existing id in this session → 200 no-op if the body matches, else 409 `CONFLICT`; an id in another session → 404 (as `receipts.ts:29`). DELETE of an unknown id → 404.
- **Validation** (no card check, the server has no KKB): payer `participantId` must belong to this session, removed allowed; payer label via `tidyName` (≤ 40). Payee: an active participant (newly added removed → 404 `PERSON_NOT_FOUND`), a typed label taken as typed (as receipts), or null. Payee == payer (same `personKey`) → 422 "Pick someone else". Limit `LIMITS.paymentsPerSession = 200`. No revision: payments are never edited.
- **Events** `payment.recorded` / `payment.deleted` (ids only) in `NON_TICKET_EVENTS` and `docs/realtime.md`; key types `payment.set:<id>` / `payment.delete:<id>`.
- **Snapshot**: `settlement.payments: {id, payer: PersonRef, payee: PersonRef | null, amountCentavos, method, note, createdAt}[]`, oldest first; `EMPTY_SETTLEMENT` and `tests/guide.test.ts:37` gain `payments: []`.
- **Math** (new pure `src/lib/payments.ts`):
  - `billFinal(kkb)` (table-wide, not tied to End): `priceCompleteness` priced = total, `billBlockers` empty, no pending change, `charge.state` is `none` or `allocated`, `!kkb.unresolved`. Receipt more/less doesn't block.
  - `paymentStatus(section, paid, final)`: obligation = `totalCentavos ?? pricedCentavos`. Cards with status `none`/`empty` or obligation 0 → no chip, no Left row (paid rows still show). Else paid 0 → Unpaid; final and paid ≥ obligation → Paid (overpaid = paid − obligation when > 0); else Partly paid. Not final never says "Paid"; its balance reads "Left to pay so far".
  - `paymentTotals(kkb, payments)`: Collected = all payments incl. orphans; Of = sum of obligations over non-shared cards with a share; Left to pay = sum of per-person `max(0, left)` (an overpayment never hides someone else's debt). Orphans = payments whose payer key has no card.
- **Claim**: `adoptLabelShares` re-keys payer and payee labels to the claimant (plain UPDATE; payments have no uniqueness).
- **UI** (`kkb-view.tsx` + new `payment-sheet.tsx` + `payments-block.tsx`; `kkb-view.tsx` stays < 500 lines):
  - Chip: in `SummaryAmount`'s row after the amount, non-shared cards with a share only, shown once the order has ≥ 1 payment. Icon + words (lucide, e.g. circle / circle-half / circle-check), tokens from DESIGN.md. At 320 it wraps under the amount, right-aligned; the heading never overflows.
  - Footer: after the last amount row (Total, or Food/Priced subtotal when there is no Total) add "Paid ₱X", one line per payment ("₱500 · GCash · to Ana · note"; host gets a 44 px lucide trash button named "Delete ₱500 payment from Jun"), then "Left to pay ₱Y" / "Overpaid ₱Y" / "Left to pay so far ₱Y". Host: full-width secondary "Record payment" at the end of every card with a share (incl. the host's own), from the start.
  - Delete: `ConfirmDialog` (danger), title "Delete ₱500 payment from Jun?", confirm "Delete"; `onConfirm` returns the server message so the dialog stays open on failure (offline: "You're offline. Try again when you're back."). No Undo.
  - Record drawer: title "Record payment from Jun", line "₱628 left of ₱1,128" (or "so far"); amount prefilled with what's left, empty when nothing is left or obligation unknown; Paid to = radio group (D27); Method = toggle buttons (`aria-pressed`) in a labelled group, tap again to clear; note field (≤ 40); primary "Record ₱X". Saving / Not saved · Try again via `useDirectSave` + `useRetryOnReconnect`; typed values kept on failure; 422/403 show the server message under the button.
  - Payments block (after Receipt check, once ≥ 1 payment, visible per D28): "Collected ₱X of ₱Y", "Left to pay ₱Z"; orphan payments listed under "Not matched to a share" with the host's delete.
  - Privacy page: "no payment processing" instead of "no payments", and recorded payments (amount, method label, note) added to what Salo keeps until the order is deleted.
- **Notification** per D30/D31: type `payment.recorded` joins `NotificationType`, `notificationText` "{host} recorded ₱500 from you", `notificationTarget` → "kkb"; subject `{centavos}` + actor; recipient = payer's `participantId` only when active (typed names get none; host's own card sends none since `notify()` skips the actor); dedup key `payment:<id>`, `source: ["payment:<id>"]`.
- **Docs**: `docs/api.md`, `docs/data-model.md`, `docs/ux-specification.md:63` (KKB tab), `docs/realtime.md`, new `docs/contracts/payments.md`, `docs/contracts/notifications.md`.
- Rejected: one stored "paid" amount per person (`receipt_people` style): loses payee, method and the ledger §5.1 describes.

### Reuse
- `personKey`, `tidyName`, `personRef` zod (`validation.ts:111`), receipts route + server fn shape (except idempotency, above), 0015 trigger SQL, `runMutation`, `notify` + `source`, `ConfirmDialog`, `Drawer` + `useDirectSave` + `useRetryOnReconnect` + `parsePeso` + `formatPeso`, Bill to pill styling from `price-editor.tsx` for Paid to.

### Not doing
- Paid status in `kkbText`, Items text/PNG or exports (F13, slice 8); `kkbText` stays byte-identical.
- Paid status in the dock label; status counts ("2 paid · 1 unpaid"); ended-banner rewording.
- Editing a payment (delete and record again), void history, guests self-reporting, any payment integration.
- Payments by someone with no share: the host records it on the card it covers, with a note.

### States
Each has a sketch below (M-label).
- No payments: today's KKB + host's Record payment (M1a); guest unchanged.
- Partly paid (M1), paid (M4), overpaid (M1b), not final "so far" (M1c), no price / zero card (M1d), several payments + long payee/note + long name at 320 (M1e), host's own card (M1f), guest viewing someone else's card (M4b).
- Drawer: default with prefill (M2), nothing left / empty prefill (M2b), Saving / Not saved · Try again / server error (M2c).
- Delete confirm, incl. failure (M3c).
- Payments block (M3), with orphans (M3b).
- Ended order: host still records and deletes; guest read-only (same as M1 / M4).
- Widths 320 / 375 / 430 / 768 / 1280; light and dark.

### Decisions
Owner answers 2026-11-24: D27–D31 = recommended option.

- **D27 [decided: (a)] Paid to (payee).** (a) Radio pills: the people on the order who have a card, minus the payer, plus "Restaurant"; preselect the host, or "Restaurant" on the host's own card; stored as person ref, null = Restaurant; (b) free text ≤ 40; (c) no payee. Recommend (a): at a KKB table money goes to whoever fronted the bill (usually the host) or straight to the restaurant; pills reuse the Bill to picker; brief "Recipient or payee, when relevant".
- **D28 [decided: (a)] Who sees payment status (was D5).** (a) Everyone sees every card's Paid / Left rows and the Payments block (every member already sees every price, `sessions/snapshot.ts:59-95`); (b) guests see only their own. Recommend (a): no per-viewer snapshot exists; (b) needs filtering in `getSnapshot` and the `/sync` SSE path.
- **D29 [decided: (a)] Recording before the bill is final.** (a) Allowed; balance "Left to pay so far", chip never "Paid" until `billFinal`; (b) Record payment disabled until final. Recommend (a): people pay at the table before the last dish is priced; "after billing amounts are finalized" is honoured by never showing "Paid" early.
- **D30 [decided: (a)] Notify the payer.** (a) One notice per recorded payment to an active participant payer: "Ana recorded ₱500 from you", opens KKB; (b) none. Recommend (a): brief §7 "Payment status updated"; one per real payment isn't noise. No balance in the text: the server can't compute it.
- **D31 [decided: (a)] Delete retracts the notice.** (a) Deleting a payment deletes its notice (`source: ["payment:<id>"]`, existing delete-by-source, `server/notifications.ts:25-60`); (b) notice stays. Recommend (a): a mistyped ₱5,000 deleted and re-recorded as ₱500 would otherwise leave two notices, one wrong ("non-redundant").

### Assumptions
- Mobile scope: responsive + native feel (D6, carried): decimal keypad, drawer above the keyboard, 44 px targets.
- Overpaying is allowed at record time; "Overpaid ₱X" shows on the card.
- Method set Cash, GCash, Maya, Bank, Other is ours (brief says only "Optional payment method"); label only.
- Co-hosts can't record (brief §6; slice 3 grants co-hosts `serving.update` only).
- HANDOFF says no tool attribution in commits; the land step follows HANDOFF.

### Done when
- `timeout 900 pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e` pass (Postgres via `pnpm db:up`).
- Unit (`tests/payments.test.ts`): unpaid / partly / paid / overpaid; `billFinal` false for each piece (unpriced, blocker, pending, charge unset/blocked, unresolved) and never "Paid" then; no-price and zero cards get no status; price change after payment recomputes left, payment unchanged; split + adjustment obligation; removed person keeps payments; orphans surfaced; totals: Left = sum of max(0, left) with one overpaid person. `tests/permissions.test.ts`: `settlement.record` host only, co-host refused. `kkbText` byte-identical (`.shots/before/kkb-export.txt`).
- Contract (`tests/contract-payments.test.ts` + `docs/contracts/payments.md`): record 200; same id same body 200 no-op; same id different body 409; other session's id 404; delete 200 / unknown 404; guest 403; co-host 403; closed allowed; cancelled 409; removed payer 200; newly added removed payee 404; payee == payer 422; bad method / note > 40 / amount 0 or > max → repo validation status; limit; cross-session trigger; events keep Confirm fresh; claim re-keys a typed payer and payee; notice created for a participant payer, none for a typed payer or the host's own card, deleted with the payment (D30/D31). `contract-billing-after-end` gains the payment routes; notifications contract gains `payment.recorded`.
- E2E (`e2e/payments.spec.ts`): host records ₱500 GCash to self for Jun; Jun's card shows Partly paid and left live on Jun's phone, plus the notice opening KKB; host records the rest → Paid; host raises a price → Partly paid again, payments untouched; lowers it → Overpaid; host deletes a payment via the dialog and Jun's notice disappears; guest sees no controls; after End the host still records; axe light/dark on the drawer, the dialog and a card with payments. Existing KKB specs stay green.
- Manual: shots of every state above.

### Skills
- `impeccable` + `.impeccable/surfaces/src-app.md`, `DESIGN.md`, `PRODUCT.md`: Operate surface, ticket world, status = icon + words, centred confirm dialogs.
- `database-migrations`: 0016 (hand plpgsql after `--> statement-breakpoint`, `pnpm db:generate`).
- `backend-patterns` + `contract-first`: routes, contract docs; read `node_modules/next/dist/docs/` per AGENTS.md.
- `frontend-a11y` / `accessibility`: radio group (Paid to), toggle group (method), labelled amount, live save status, named delete buttons.
- `mobile-native`: decimal keypad, drawer above the keyboard.

### You need to do
- [ ] After merge, the first app start runs migration 0016 (watch logs).

### Mockups (slice 5, text sketch)

M1 Host, Jun's card, partly paid (375):
```
┌─────────────────────────────────────────┐
│ Jun                 ₱1,128  (◐ Partly paid)│
│  Sisig ×2 ......................  ₱580   │
│  Halo-halo .....................  ₱150   │
│  Crispy Pata ½ · from Whole table ₱390   │
│ - - - - - - - - - - - - - - - - - - - -  │
│ Food subtotal                 ₱1,120     │
│ Service charge                  ₱108     │
│ Senior citizen discount         −₱100    │
│ Total                         ₱1,128     │
│ Paid                            ₱500     │
│   ₱500 · GCash · to Ana            [trash]│
│ Left to pay                     ₱628     │
│ ┌─────────────────────────────────────┐ │
│ │          Record payment             │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```
M1a No payments yet (host): no chip; footer ends at Total, then [Record payment].
M1b Overpaid (price lowered after paying): chip (● Paid); rows "Paid ₱1,200" … "Overpaid ₱72".
M1c Bill not final (one dish unpriced anywhere): chip (◐ Partly paid) even if paid ≥ total so far; row "Left to pay so far ₱628".
M1d No prices yet: heading "No prices yet", no chip; footer "No prices entered"; Paid rows only if payments exist; no Left row; [Record payment] (empty amount).
M1e 320, long name + 2 payments:
```
┌──────────────────────────────────┐
│ Maria Concepcion dela    ₱1,128  │
│ Cruz-Villanueva  (◐ Partly paid) │
│ …                                │
│ Paid                      ₱800   │
│  ₱500 · GCash · to Ana    [trash]│
│  ₱300 · Cash · to         [trash]│
│  Restaurant · for drinks         │
│ Left to pay               ₱328   │
│ [        Record payment        ] │
└──────────────────────────────────┘
```
M1f Host's own card: same as M1; drawer preselects "Restaurant".

M2 Record payment drawer (host, from Jun's card):
```
┌─────────────────────────────────────────┐
│ Record payment from Jun                  │
│ ₱628 left of ₱1,128                      │
│ Amount                                   │
│ ₱ [ 628.00                         ]     │
│ Paid to                                  │
│ (● Ana · host) ( Liza ) ( Restaurant )   │
│ Method (optional)                        │
│ [ Cash ] [ GCash ] [ Maya ] [ Bank ]     │
│ [ Other ]                                │
│ Note (optional)                          │
│ [ e.g. for drinks                  ]     │
│ ┌─────────────────────────────────────┐ │
│ │           Record ₱628               │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```
M2b Nothing left / unknown: subline "Nothing left to pay" or "No prices yet"; amount empty; button "Record payment" until an amount is typed.
M2c Saving: button "Saving…" disabled. Not saved: "Not saved · Try again" under the button, values kept, retries on reconnect. Server error: message under the button (e.g. "Only the host can record payments.").

M3 Payments block (after Receipt check, once a payment exists):
```
┌─────────────────────────────────────────┐
│ Payments                                 │
│ Collected              ₱2,000 of ₱3,054  │
│ Left to pay                     ₱1,054   │
└─────────────────────────────────────────┘
```
M3b With orphans: below, "Not matched to a share" + lines "₱300 · Cash · from Pedro [trash]".
M3c Delete confirm (centred dialog):
```
┌───────────────────────────────┐
│ Delete ₱500 payment from Jun? │
│        [ Keep ]  [ Delete ]   │
└───────────────────────────────┘
```
failure: message inside the dialog, dialog stays open.

M4 Guest (Liza) own card, paid: M1 footer without trash buttons and without Record payment; chip (● Paid).
M4b Guest viewing Jun's card (D28 a): same read-only rows as M4.

### Slice 5 addendum: payments that need review after a claim (follow-up 2)

Status: landed (PR #55)

Verify 2026-11-27: checker 963/963 (e2e: 2 flaky specs outside payments, pass on re-run), reviewer, qa, ui-critic SHIPPABLE; G41 + G45–G51 pass as plain `it`; Fix/trash gap fixed and measured (8 px on every card at 320/375).

Owner's message (2026-11-27), verbatim:

> **Follow-up 2 — Payment becomes self-referential after a name claim**
> Let's proceed with **Leave the payment record**, with additional safeguards.
> When Ana claims a typed-name participant and that causes an existing payment to have the same payer and payee:
> 1. Preserve the original payment record for auditability. Do not automatically delete it or change the payee to Restaurant.
> 2. Mark the payment as **Needs review** because the payer and payee now refer to the same participant.
> 3. Exclude the unresolved payment from settlement calculations so it cannot incorrectly reduce Ana's outstanding balance.
> 4. Notify the host that the payment needs correction.
> 5. Allow the host to reassign the payee to the correct participant or Restaurant, or remove the payment if it was entered incorrectly.
> 6. Once corrected, restore its normal settlement effect.
> 7. Ensure this behavior is handled atomically when a typed-name participant is claimed, with proper idempotency and realtime updates.
> **For test G41:** Update the expected behavior to verify that the payment is preserved, flagged for review, and excluded from settlement totals until resolved. Remove the expected-failure marker only after the implementation passes.
> The guiding rule is that identity changes must never silently rewrite payment history or produce an invalid financial settlement.

#### Ask ledger (addendum)

| # | Owner's words | Planned change | Status |
|---|---|---|---|
| S5.10 | "Preserve the original payment record… Do not automatically delete it or change the payee to Restaurant." | Claim keeps today's re-key (`adoptPaymentLabels`, `adjustments.ts:130-133`); amount, method, note, created_at untouched; never deleted or nulled | done |
| S5.11 | "Mark the payment as **Needs review**" | Derived flag (D32 a): payer == payee | done |
| S5.12 | "Exclude the unresolved payment from settlement calculations" | `paidByKey`, `paymentStatus`, `paymentTotals` skip flagged rows (Paid, Left, chip, Collected); line still listed on the payer's card | done |
| S5.13 | "Notify the host that the payment needs correction." | One host notice per flagged payment, created in the claim tx, retracted on fix or delete (Pinned details) | done |
| S5.14 | "Allow the host to reassign the payee to the correct participant or Restaurant, or remove the payment" | `PATCH /api/sessions/[id]/payments/[paymentId]` `{payee}` (host only, payee ≠ payer, same payee rules as record) + D33 UI; delete = existing trash + dialog | done |
| S5.15 | "Once corrected, restore its normal settlement effect." | Flag clears as soon as payer ≠ payee; totals include it again; host notice retracted | done |
| S5.16 | "handled atomically when a typed-name participant is claimed, with proper idempotency and realtime updates" | Flagging + host notice inside the claim-approval transaction (already one `runMutation`); PATCH via `runMutation` with key type `payment.payee:<id>`, event `payment.updated` in `NON_TICKET_EVENTS`; snapshot carries the flag | done |
| S5.17 | "For test G41: … preserved, flagged for review, and excluded from settlement totals… Remove the expected-failure marker only after the implementation passes." | G41 rewritten to those expectations; `it.fails` → `it` only once green | done |

#### Approach
- **Flag is derived**: `needsReview = personKey(payer) === personKey(payee)` (payee non-null). Record and PATCH already refuse payee == payer (422), so a claim is the only way in, and any payee change clears it, so the flag can't drift. Snapshot payments gain `needsReview: boolean` computed server-side in `getSnapshot`, so every client agrees.
- **Claim** (`adoptPaymentLabels`): after the re-key, for each payment that became payer == payee, `notify` the host in the same transaction: type `payment.needsReview`, text "{claimant}'s claim left a ₱500.00 payment paid to themself. Fix it on KKB.", target "kkb", dedup `payment-review:<id>`, `source: ["payment:<id>"]` (so delete removes it with the existing call) plus `["payment-review:<id>"]`. The claim's event already refreshes clients.
- **PATCH payee**: body `{payee: personRef | null}`; host only (`settlement.record`), `allowClosed`, `assertBillable`; 404 unknown/other session; payee rules as record (active participant, typed label, or null = Restaurant; payee == payer 422). Allowed only on a payment that needs review (else 409 `NOT_NEEDS_REVIEW`; editing stays out of scope). Same body twice → 200 no-op via the idempotency key. Retracts the host's `payment-review:<id>` notice. Payer's original `payment.recorded` notice stays (it was true).
- **Math**: flagged rows count nowhere (card Paid/Left/chip, Payments block Collected/Left); orphan logic unchanged.
- **UI**: per D33.

#### Decisions (addendum)
Owner answers 2026-11-27: D32, D33, D35 = recommended option (D34 dropped: the owner asked for the notice).

- **D32 [decided: (a)] How "Needs review" is stored.** (a) Derived from payer == payee, no column; (b) a `needs_review_at` column set on claim and cleared on fix. Recommend (a): it can't disagree with the data, needs no migration change, and a fixed payee clears it by definition.
- **D33 [decided: (a)] Where the host fixes it.** (a) The payment line on the payer's card shows a tag "Needs review" (alert icon + words, saffron) and, for the host, a "Fix" button next to the trash that opens the payment drawer in a payee-only mode: "Who received ₱500.00 from Ana?" + Paid to pills (payer excluded) + "Save"; guests see the tag only; (b) a "Needs review" list in the Payments block with the same Fix/delete controls. Recommend (a): the line is where the host sees it, and it reuses the drawer and pills.
- **D35 [decided: (a)] PATCH scope.** (a) Only payments that need review (409 otherwise); (b) any payment's payee. Recommend (a): plan says payments aren't edited; the owner asked only for the flagged case.

#### Pinned details (plan-critic, verified)
- **Host notice recipient**: `notify` drops the actor (`server/notifications.ts:33`) and claim approval is host-only (`permissions.ts:35`), so `adoptLabelShares` / `adoptPaymentLabels` gain a `hostId` argument; `resolveClaim` (`people.ts:159`) passes `actor.participantId`; the notice goes with `recipients: [hostId]`, `actorId: <claimant participantId>`. The claimant is always a guest (`requestClaim` is guest-only, `people.ts:105`), so the host is never the self-payer.
- **Notice type**: `payment.needsReview` joins the `NotificationType` union (`lib/notifications.ts:3`), the `kkb` case of `notificationTarget` (`:37`) and `notificationText` (`:74`); subject `{ name: claimant displayName, centavos }`; text "{name}'s claim left a ₱500.00 payment paid to themself. Fix it on KKB."; dedup `payment-review:<id>`; `source: ["payment:<id>", "payment-review:<id>"]`. No migration (`schema.ts:466`).
- **Replay**: replaying the claim-approval key returns the stored result before `apply` (`mutations.ts:73-79`), so no second notice; a new key gets 409 `CLAIM_RESOLVED` (`people.ts:134`).
- **No flag while the name still has food**: `adoptLabelShares` returns early (`adjustments.ts:103`); the payment stays on the typed name's card, unflagged. Tested.
- **Payer-side variant** (typed payer, participant payee, payee claims the name) flags the same way; the line lands on the claimant's card. Only the payee can be fixed (owner item 5); delete covers the rest.
- **Orphans**: `paymentTotals.orphans` still scans all payments, flagged included; `collected`, `left`, `paidByKey` skip flagged rows. A flagged orphan shows in "Not matched to a share" with the tag, Fix (host) and trash. PATCH doesn't check the payer (as `deletePayment`), so Fix works for a removed payer. A flagged line appears once: on its card or in the orphan list.
- **Paid ₱0.00**: with only a flagged payment, the card shows "Paid ₱0.00", the line with the tag, and Left unchanged; the Payments block shows "Collected ₱0.00 of ₱X". Intended.
- **Delete dialog** for a flagged payment: body "It was not counted in what they have paid." (title unchanged).
- **Fix drawer (M6)**: opens with no pill selected, Save disabled until one is chosen; options = `payeeOptions` (`payment-sheet.tsx:43-49`) minus the payer; amount, method and note hidden; failure keeps the drawer open with the message. Stale fix (409 `NOT_NEEDS_REVIEW`): "That payment doesn’t need review any more.", then closes on refresh. Only the same idempotency key replays.
- **PATCH route**: added to `api/sessions/[id]/payments/[paymentId]/route.ts`, `allowClosed: true`, key type `payment.payee:<id>`; event `payment.updated` in `NON_TICKET_EVENTS` (`settlement.ts:16`) and `docs/realtime.md:12`.
- **Docs**: `docs/api.md` PATCH row; `docs/contracts/payments-golden.md` G41 rewritten + G45–G51; `docs/contracts/notifications.md` E-row for `payment.needsReview`; `docs/contracts/payments.md` flag rule.

#### Done when (addendum)
- Unit: flagged rows excluded from paid/left/chip/totals; fixing the payee restores them.
- Contract (G41 rewritten + new G45–G51): claim flags the payment (row preserved byte for byte except the re-keyed side); the host has exactly 1 `payment.needsReview` notice after approval; replaying the approval key doesn't add one; claim while the name still has food leaves it unflagged; payer-side variant flags; flagged orphan (payer removed) can be fixed and deleted; PATCH 200 clears the flag and retracts the notice; PATCH on an unflagged payment 409; PATCH payee == payer 422; guest/co-host 403; delete of a flagged payment removes both notices; after End allowed. `it.fails` removed only when green.
- E2E: host records Ana paying typed Rafa, approves Ana's claim of Rafa, Ana's card shows the line with "Needs review" and her Left unchanged, host gets the notice, fixes payee to Restaurant, balance updates live on Ana's phone.
- `timeout`-wrapped typecheck, lint, test, build, e2e pass.

#### Mockups (addendum, text sketch)
M5 Host, Ana's card with a flagged payment (375):
```
│ Paid                            ₱0.00    │
│   ₱500.00 · GCash · to Ana   [Fix][trash]│
│   (! Needs review)                       │
│ Left to pay                   ₱1,128.00  │
```
M6 Fix drawer: "Fix payment" / "Who received ₱500.00 from Ana?" / (Host (you)) (Liza) (Restaurant) / [ Save ].

## Slice 6: My order and host transfer (F08, F09)

Status: landed (PR #56)

Verify 2026-11-27: checker typecheck/lint/1031 unit + touched e2e pass; contract-tester 50/50 (`tests/contract-host-transfer-adversarial.test.ts`, golden `docs/contracts/host-transfer.md`); reviewer NOT SHIPPABLE → fixed (notices over drawers, claim on Shared rows, ClaimControl, typed rows) → re-check SHIPPABLE; qa SHIPPABLE; ui-critic SHIPPABLE, 9 fix-in-loop items fixed and measured. Follow-ups in `.shots/follow-ups.md`.

Research brief (2026-11-27, researcher) cited below. Baseline in `.shots/before/` (seed `.shots/before/seed.mjs`, index `README.md`; slice 5 shots moved to `.shots/v1-4-slice5/`). Seeded: host + Jun (co-host), Liza, Ana (joined, nothing added); round 1 confirmed, round 2 draft with Liza's Large + note dish, a dish the host added for Liza, a dish Liza added for Jun, a whole-table dish; Jun ready. Pre-existing, seen in baseline: header title button 25 px next to 44 px buttons (all 20 geometry findings). Not this slice's scope.

### Ask ledger (slice 6)

Brief F08 and F09 quoted from `salo-v1-4-brief.md:581-657`.

| # | Owner's words | Planned change | Status |
|---|---|---|---|
| S6.1 | "Improve the existing readiness workflow rather than introducing a duplicate confirmation system." | One ready toggle, same `PUT /readiness`; where it lives per D36 | done |
| S6.2 | "Provide a convenient **My order** review showing: Dish names. Quantities. Variants. Preparation notes. Assigned participant. Current round. Readiness status." | New `MyOrderSheet` drawer (M2): header "My order · Round n" + readiness line; rows show qty, dish, size, note, and who it is for / who added it | done |
| S6.3 | "Allow participants to: Correct their draft items when permitted." | Rows the guest may edit (`canEditEntry`) get the ticket's stepper and Edit (opens the existing `EditDishSheet`); host-added rows per D43 | done |
| S6.4 | "Identify mistakes before confirmation." | Sheet covers the open round only (D37); groups my items by "For you" / "You added for others" / "Shared" | done |
| S6.5 | "Clearly indicate readiness." | Sheet footer toggle "I'm ready" / "Ready ✓ · tap to undo"; dock shows the state (D36) | done |
| S6.6 | "The host should see which participants have responded." | Already: People badges "Ready" / "Still choosing" (`people-view.tsx:149-155`) and Review "x of y ready · still choosing: names" (`review-panel.tsx:65-70`); wording per D38 | done |
| S6.7 | "Readiness must remain appropriately scoped to the active round." | Unchanged: rows keyed (participant, draft round) (`people.ts:21-31`), reset on own changes (`:48-58`) | done (existing) |
| S6.8 | "Do not add mandatory confirmation steps for guests who are not actively participating." | Readiness stays advisory (never blocks Confirm); D38 decides whether guests with nothing in the round count | done |
| S6.9 | "Introduce an explicit host-transfer workflow. … 1. Select another active participant. 2. Review the transfer consequences. 3. Confirm the transfer. 4. Relinquish host authority." | Order options → "Hand over host" → pick (M4) → consequences + confirm (M5); old host becomes a guest (D40) | done |
| S6.10 | "The new host should receive the appropriate capabilities immediately." | Role swap in one `runMutation`; event refetches every device's snapshot; `isHost` flips from `snapshot.me.role` (`workspace.tsx:74`); new host gets a notice (M6) | done |
| S6.11 | "Only the active host can initiate a normal transfer." | `can(fresh, "host.transfer")`, new action in `HOST_ONLY` | done |
| S6.12 | "Transfer must be atomic." / "Never allow two primary hosts accidentally." | One transaction under the session lock: demote then promote (one-host unique index `schema.ts:95`, cohost CHECK `:93`); a second transfer in flight fails 403 `ROLE_CHANGED`, one sent after the commit 403 `FORBIDDEN` | done |
| S6.13 | "Update permissions across connected devices." | Event `host.transferred` (ids only) → SSE refetch on all devices; in `NON_TICKET_EVENTS` | done |
| S6.14 | "Reject stale writes from the former host." | After the commit the old host resolves as GUEST and fails `can()` → 403 `FORBIDDEN`; a write already in flight hits the `ROLE_CHANGED` guard (`mutations.ts:84`, R01 `tests/contract-slice3-golden.test.ts:385-399`); client refreshes on any 403 (today only 409/404, `use-session.ts:359`) | done |
| S6.15 | "Record the transfer event." | `host.transferred {fromId, toId}` event in `session_events` (D39 a) | done |
| S6.16 | "Lost-device recovery should be evaluated separately." / "Do not implement insecure automatic takeover, predictable PINs, or unrestricted host reassignment." | Not built; noted in Not doing | planned (none) |

### Today

- **Ready control**: guest-only dock button "I'm ready" / "Ready" (`workspace.tsx:738-753`, `!isHost && isOpen`), op `{kind:"ready"}` → `PUT /readiness` → `setReady` (`people.ts:21-43`), DRAFT round only (`people.ts:13-15`). The host has no ready state.
- **"Everyone ready" notice**: fires when ready guests = all non-removed guests (`people.ts:33-37`), so a guest who added nothing (Ana) blocks it. Host count "n/m guests ready" (`views.ts:105-109`, dock `workspace.tsx:713-717`); Review "1 of 3 guests ready · still choosing: Liza, Ana" (`review-panel.tsx:44-45,65-70`).
- **A guest's own items**: inline in the shared round ticket (`order-ticket.tsx:61,85`) and in People "for me" (`people-view.tsx:84-92,176-182`). KKB My share is the only all-rounds personal view (`workspace.tsx:721-727`). No review sheet.
- **Edit rules**: draft round only and `canEditEntry` = host or submitter (`permissions.ts:~43`, `entries.ts:~118-122`). A guest can't edit a dish someone else added for them; they can edit dishes they added for others. Edit UI: `EditDishSheet` (`workspace.tsx:482`), stepper/remove via `TicketActions` (`workspace.tsx:315-330`).
- **Assignment data**: snapshot entry `attribution {type, label, participantId}` + `submittedBy` (`lib/snapshot.ts`); groups via `snapshot.groups[].memberIds` (`views.ts:~53`).
- **Host role**: `participants.role`, partial unique index one HOST per session (`schema.ts:~90`); CHECK `cohost_at IS NULL OR (role='GUEST' AND removed_at IS NULL)`. `runMutation` re-reads role under the lock and throws 403 `ROLE_CHANGED` if it changed (`mutations.ts:57-84`). No transfer exists. Options sheet (`order-options-sheet.tsx`, host + open only, `session-header.tsx:~58-70`) already has a two-step options → confirm flow for End.
- **Files at cap**: `workspace.tsx` 800/800 lines; `use-session.ts` 569.

### Approach

**F08 My order**
- New `src/components/workspace/my-order-sheet.tsx` (vaul `Drawer`, like `PricesSheet`; `EditDishSheet` stacks over it as PaymentSheet does over SummarySheet, `kkb-view.tsx:200-201`). Guests only, open order with a draft round.
- Pure `myOrderRows(roundEntries /* overlay, so steppers move optimistically */, {participants, removedPeople, groups}, meId)` in `src/lib/views.ts`: open-round entries in groups. **For you**: `attribution.participantId === me`. **Host added for "{name}"** (typed name = my display name, `normalizeText`, as `people-view.tsx:86-87`) per D43. **You added for others**: `submittedBy === me` and for someone else. **Shared**: TABLE, and GROUP whose `normalizeText(label)` matches a group with me in `memberIds` (attribution has no groupId, `snapshot.ts:143-150`). Each row: qty, dish, size, note, plus "for {name}" or "added by {name}" when not both me.
- Rows I may edit (`canEditEntry`) reuse the ticket's controls: export `EditButton` from `order-ticket.tsx:26`, use `Stepper` from `./stepper`; sheet takes `actions: TicketActions` (built `workspace.tsx:315`). Row layout = `SourceRow` (`order-ticket.tsx:59`): text left with `min-w-0` wrap and Edit after the detail, stepper right; "Saving…" on `entry.pending` rows.
- Footer: the ready toggle (same op). Header line: "Round 2 · You're ready" / "Round 2 · Not marked ready yet".
- Entry per D36.
- **Room in `workspace.tsx`**: extract the dock (`workspace.tsx:700-757`) to `src/components/workspace/dock.tsx` first, behaviour unchanged, then wire the sheet there. See Pinned details.

**F09 Host transfer**
- Action `host.transfer` in `HOST_ONLY` (`permissions.ts:35`).
- `PUT /api/sessions/[id]/host` body `{participantId, displayName?}`, modelled on `participants/[pid]/cohost/route.ts`; key type `host.transfer:${pid}`; `apply` uses its third argument `(tx, s, fresh) => transferHost(tx, s, fresh, …)`; not `usesFreshActor`. No route pre-check needed (guard makes `fresh.role === actor.role`). Open orders only (D41). Transport per D42.
- `transferHost(tx, session, fresh, targetId, displayName?)` in `src/server/orders/people.ts`: `can(fresh, "host.transfer")`; `targetId === actor` → 422 `ALREADY_HOST` (checked first); target via `loadTarget` (`people.ts:~176`, FOR UPDATE; not `loadGuest`, which says `CANNOT_REMOVE_HOST`): unknown → 404, removed → 409 `ALREADY_REMOVED`. If `displayName` given: `tidyName` (`settlement.ts:19`) and rename the old host first. Then `UPDATE` old host `role='GUEST', cohost_at=NULL` (D40), then target `role='HOST', cohost_at=NULL`, in that order (index). Event `host.transferred {fromId, toId}` in `NON_TICKET_EVENTS` (`settlement.ts:16`). Notice `host.transferred` to the new host only: "{old name} made you the host." using the name after any rename; dedup `host.transferred:${toId}:${session.revision+1}`; `NotificationType` + `notificationText` (`lib/notifications.ts:3,~71`), target defaults to order. Pending claims the target requested are rejected in the same transaction (as `removeParticipant`, `people.ts:~188`).
- Record per D39.
- Client: per D42. Any 403 joins the refresh set (`use-session.ts:359`). On success the old host's device runs `markTourSeen("guest")` (else a guest tour offer pops up right after handing over); `<Guide key={role}>` so a promoted guest mid-tour doesn't keep a stale step index (`workspace.tsx:495-497`).
- UI (M3–M5): Options sheet gets a "Hand over host" row above "All done? End order" → step "pick": radio list of active guests, co-hosts first then join order, names `break-words` → step "handover": consequences list + stacked buttons (as End's confirm, `order-options-sheet.tsx:96-103`): [Make Jun the host] primary, [Keep hosting] ghost with autoFocus. `step` union gains `pick` | `handover`; `startAt="confirm"` still means End. If the host's name is still "Host" (`order-options-sheet.tsx:49` test), the handover step shows a required "Your name" field sent as `displayName` in the same request (Assumption A6.1).
- Everything else follows `snapshot.me.role` on refetch: Review, Rounds, KKB pricing, groups, claims queue, Options button, guide.

Rejected: transfer from the People card (right cluster already full at 320, slice 3 D17 note); a FullScreenSheet for My order (Drawer-over-Drawer is proven, `kkb-view.tsx:200-201`; Drawer over a top-layer `<dialog>` is not).

### Pinned details (plan-critic, verified)
- **D38 [decided 2026-11-27: (a) guests with no order don't count] rule** (if (a)): one pure `orderingIds(entries, participants, groups, roundId)` in `src/lib/views.ts`, used by client and `setReady`. Ordering = any non-deleted open-round entry with `attribution.participantId === me`, or `submittedBy === me`, or INDIVIDUAL with no participantId and `normalizeText(label) === normalizeText(displayName)`, or GROUP whose label matches a group with me in `memberIds` (server: `withMembers`, `server/notifications.ts:~66`). Whole-table and unassigned dishes don't count. A guest with nothing who taps Ready counts as Ready in both n and m. `readinessSummary` (`views.ts:105`) takes `entries, groups, activeRoundId` too and returns `{ready, total, readyIds, noOrderIds}`; callers `workspace.tsx:250`, `review-panel.tsx:44,66-70`, `people-view.tsx:89`. Notice needs `ordering.length > 0`.
- **Dock extraction**: safe; `composerActive` (`workspace.tsx:97`) is used only in the dock and moves with it; `dockRef` is a callback ref (`use-dock-height.ts`) passed as a prop. ~20 props (`dockRef, isOpen, isHost, total, ready, iAmReady, shareLabel, left, onShare, onPrices, confirmedTicket, correctionsThisRound, onMode, mutate, snapshot, recipients, view, detailsSignal, onAdd, onMyOrder`). Net ≈ −10 lines in `workspace.tsx`; `e2e/slice8-measure.spec.ts` dock geometry is the guard.
- **Session events are never pruned** beyond the session's own deletion (checked), so D39 (a) is a durable record for the order's life.

### Reuse
- `Drawer` + `PricesSheet` structure; `TicketActions` (stepper, Edit, remove + Undo) and `EditDishSheet` for edits; `canEditEntry`.
- `attributionLabel` (`lib/snapshot.ts:~143`) for "for {name}"; `everyone(snapshot)` for "added by {name}". `people-view.tsx` is not refactored.
- `setCohost` route/server/op/notification shape (slice 3) for the transfer; `OrderOptionsSheet` step pattern for pick → confirm.
- Contract tests: `tests/contract-cohosts.test.ts` template; e2e `e2e/cohosts.spec.ts` helpers.

### Not doing
- Lost-device recovery, automatic takeover, PINs (brief: "evaluated separately").
- Transfer to a typed name (no device) or to a removed person.
- A ready state or My order sheet for the host (the host has Review).
- Earlier, confirmed rounds in My order (D37 a); KKB My share covers them.
- New edit permissions: a guest still can't edit a dish someone else added for them.
- Re-parenting `submitted_by` on transfer. Claims key on the submitter's current role (`people.ts:110`) and only work in the draft round, so dishes the old host added in that round become editable by the new host directly instead of claimable. Accepted (Assumptions).

### States
| State | After |
|---|---|
| Guest, draft round, items for them | Dock entry (D36); sheet M2 with groups, editable rows have stepper + Edit |
| Guest, draft round, nothing for them | Sheet M2-empty: "Nothing for you in round 2 yet." + ready toggle |
| Guest ready | Dock shows ready state; sheet header "You're ready"; any change of theirs resets it (existing) |
| Guest edits in sheet | Stepper/Edit as the ticket; queued op, "not saved" handling as today; readiness resets; Undo toast shows above the sheet, at the top of the screen on the overlay while any sheet is open (`z-[60]`; a bottom offset covered short sheets' controls, CI axe on quick-prices) |
| Someone adds a dish for a passive guest | They become "ordering" and "Still choosing"; any ready is cleared (existing reset, `entries.ts:97`) |
| Only shared dishes in the round | "Nothing for you in round 2 yet." then the Shared section |
| Dish added for me by someone else | Guest-added: read-only "added by Jun". Host-added: per D43 |
| Round confirmed while sheet open | Sheet closes; `useEffect` sets `myOrderOpen=false` when `!isOpen \|\| isHost`, render `open={myOrderOpen && !isHost && isOpen}` so it never reopens by itself |
| No draft round / order ended | No My order entry |
| Co-host (Jun) | Same as guest (role GUEST) |
| Host, Options | "Hand over host" row (open order, ≥1 active guest); hidden with no guests |
| Pick step | Active guests list, none preselected, Continue disabled until one picked |
| Confirm step | Consequences (M5); name field when host is still "Host"; busy; offline: "No connection. Keep this open: it hands over as soon as you're back online.", retries on reconnect (D42) |
| After transfer, old host's phone | Becomes guest view on refetch: My order / ready, no Review/Options, no tour offer; People card has no suffix (`people-view.tsx:140-146`) |
| After transfer, new host's phone | Host view on refetch + notice M6; host tour offer appears (not seen as host) |
| Old host's write after the swap | 403 `FORBIDDEN` (per-action message), or 403 `ROLE_CHANGED` ("Your role in this order changed. Reload to continue.") if already in flight; both refresh the snapshot |
| Two transfers | In flight together (different keys): first wins, second 403 `ROLE_CHANGED`; sent after the commit: 403 `FORBIDDEN`; same key: replayed (`mutations.ts:64-77`), no second notice |
| Target removed meanwhile | 409 `ALREADY_REMOVED` with message, stays on handover step |
| Host dock count when nobody is ordering | Hidden (as `ready.total > 0` today) |
| Widths | 320, 375, 430, 768, 1280; light and dark |

### Decisions

Owner answers 2026-11-27: D36–D43 = recommended option.

- **D36 [decided 2026-11-27: (a) dock "My order" → sheet with the ready toggle] My order entry and the ready control.** (a) The dock's ready button becomes "My order" (M1a): opens the sheet; the sheet's footer holds the one ready toggle; dock label shows the state ("My order ✓ Ready"). (b) Keep the dock "I'm ready" one-tap button as is and add "Check my order" as a link at the top of the People "for me" list and in the Order tab (M1b); the sheet also has the toggle. Recommend (a): the brief asks to improve readiness "rather than introducing a duplicate", and puts review before ready ("verify their orders before the host confirms"); the dock row is already at its limit at 320 (`workspace.tsx:719-753`, `max-[359px]` wrap), so (a) adds no button. Cost: ready takes two taps instead of one.
- **D37 [decided 2026-11-27: (a) open round only] Rounds in My order.** (a) Open round only. (b) Open round editable + earlier rounds read-only below. Recommend (a): readiness is per round (`people.ts:13`), confirmed rounds can't change, and KKB My share already lists every round with prices.
- **D38 Guests with nothing in the round.** (a) Guests with no dish for them in the open round (for you, added by you, or a group they're in) don't count in "n of m ready" and don't hold back the "Everyone is ready" notice; Review reads "1 of 2 ready · still choosing: Liza · no order yet: Ana"; People badge "No order yet". (b) Unchanged: everyone counts. Recommend (a): today a passive guest blocks the notice (`people.ts:33-37`) and shows "Still choosing" forever, which is what the brief's "not actively participating" line rules out. Notice copy becomes "Everyone who's ordering is ready for round n".
- **D39 [decided 2026-11-27: (a) session event, no migration] Transfer record.** (a) The `host.transferred` event in `session_events` (durable, ids only, kept as long as the order, `schema.ts:~346`); no migration. (b) New `host_transfers` table (migration 0017, from/to ids, time, same-session trigger). Recommend (a): nothing reads a separate table, retention would be the same (cascades with the session), and the brief asks only to "record the transfer event". Slice table's 0017 then moves to slice 8.
- **D40 [decided 2026-11-27: (a) plain guest] The old host after transfer.** (a) Plain guest. (b) Co-host (keeps serving). Recommend (a): the brief's step 4 is "relinquish host authority"; the new host can make them co-host in one tap (`cohost-toggle.tsx`).
- **D41 [decided 2026-11-27: (a) open orders only] Transfer after End.** (a) Open orders only (Options sheet is hidden on ended orders, `session-header.tsx:~58-70`). (b) Also after End, since billing after End is host-only (D1). Recommend (a): the host can still bill from their own phone after End, and (b) needs a new host surface on ended orders. Revisit if the pilot shows hosts leaving before the bill.
- **D42 [decided 2026-11-27: (a) direct call via `useDirectSave`] How the transfer reaches the server.** (a) Direct call from the handover step with `useDirectSave` (`src/hooks/use-direct-save.ts`, as PaymentSheet): same-key retry, offline shows "No connection…" and retries on reconnect while the step is open, nothing persisted; route is PUT. (b) Queued op in `use-session.ts`: persisted in localStorage (`use-session.ts:223,414`), so an offline "Make Jun the host" could fire hours later. Recommend (a): a handover should happen while the host is looking at it ("Transfer must be atomic"); also keeps `use-session.ts` (569 lines) untouched.
- **D43 [decided 2026-11-27: (a) "That's mine" claim on host-added rows] Dishes the host added for me (by participant or typed name) in My order.** (a) Show the existing "That's mine" claim on host-added rows (reuse `onClaim` / `myClaims`, `people-view.tsx:127-129,151-155`); typed-name rows in their own group 'The host added these for "Liza". Yours?'. (b) Read-only "added by Host", no claim. Recommend (a): claiming is the only existing way a guest corrects a host-added dish ("Correct their draft items when permitted", "Identify mistakes before confirmation"), and `requestClaim` says names alone never merge (`people.ts:~100`), so typed names can't be shown as mine without it.
- Mobile scope: carried from D6 (responsive + native feel; all baseline items present, researcher re-checked 2026-11-27).

### Assumptions
- Co-hosts see My order like any guest (role GUEST).
- The new host's earlier ready row is left as is (`readinessSummary` counts guests only).
- `participant_credentials.credential_type` left stale (never read, `create.ts:42`).
- The new host gets the host tour offer (`tourSeen` is per role, `guide-steps.ts:169`); kept, it helps. The old host's guest offer is suppressed.
- A6.1 Handover step asks for the host's name when it is still "Host" (one request); not asked by the owner, needed because a guest can't rename themself (`permissions.ts:35`).
- The M6 notice is an addition (brief asks only for immediate capabilities and a record); same shape as the co-host notice.
- Unread `guests.ready` / `payment.needsReview` notices in the old host's Updates stay.
- The old host's own open-round dishes make them "ordering" (via `submittedBy`) under D38, so they hold back the notice until they tap ready.
- D38 notice is evaluated only in `setReady`: a guest removing their last dish when everyone else is ready sends no notice. Accepted.
- The new host's earlier dishes in the open round become claimable by guests (claim rule keys on current role, `people.ts:110`). Accepted.
- Guide: guest step "Tell the host you're done" (`guide-steps.ts:128-135`) copy becomes "Check your order" / "Tap My order to see everything that's yours this round, fix mistakes, then tap I'm ready." (D36 a); the dock button keeps `data-tour="ready"`; no host-transfer guide step (first-use prompt: the row sits in Options, where the host meets it).
- Claims after transfer as in Not doing.

### Done when
- `timeout`-wrapped `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e` pass.
- Unit: `myOrderRows` grouping (for you / added for others / shared incl. group membership / typed-name fold); `readinessSummary` with D38; `can()` table gains `host.transfer`.
- Contract (`tests/contract-host-transfer.test.ts`, golden `docs/contracts/host-transfer.md`): host transfers → roles swapped, one HOST; new host's `cohost_at` cleared; old host co-host flag cleared; guest/co-host 403; self 422; removed target 409; typed/unknown 404; closed order 409 `SESSION_CLOSED`; replay same key = same result, no second notice; old host's write after transfer 403 `FORBIDDEN`, in-flight one 403 `ROLE_CHANGED` (R01-style `betweenAuthAndLock`); two concurrent transfers → exactly one HOST; displayName renames before demote; target's pending claims rejected; event in `NON_TICKET_EVENTS`; notice to new host only (E16 in `contract-notifications`). D38: notice fires when all ordering guests are ready, never with 0 ordering.
- Existing tests to update: `e2e/groups.spec.ts:42-47`, `e2e/rounds.spec.ts:25`, `e2e/slice8-measure.spec.ts:99` (dock), `tests/contract-notifications.test.ts:331,346` (E08/E08b under D38), `tests/views.test.ts:74`, `tests/people.test.ts:29-42`.
- E2E (`e2e/my-order.spec.ts`, `e2e/host-transfer.spec.ts`): guest opens My order, sees size + note + "added by Host" row, changes quantity in the sheet, marks ready, host sees Ready; host hands over to Jun, Jun's phone shows Review without reload, old host's phone shows "I'm ready"/My order; axe on both sheets light/dark.
- Manual: shots of every state above at 320/375/430/768/1280.

### Skills
- `.impeccable/surfaces/src-app.md`, `DESIGN.md`: order-pad world, dock, sheet styling.
- `frontend-a11y` / `accessibility`: drawer focus, radio group, aria-pressed toggle, live status.
- `mobile-native`: drawer on phones, tap targets.
- `contract-first`: new route + golden contract.
- AGENTS.md: read `node_modules/next/dist/docs/` route handler guide before the new route.

### You need to do
- Nothing (no migration: D39 a).

### Mockups (slice 6, text sketch)

M1 Guest dock, 375 (today: `[Share ₱880] [Ticket] [✓ I'm ready]`):
```
M1a (D36 a)                                M1b (D36 b)
│ 7 items                                │ │ 7 items                               │
│ [Share ₱880] [Ticket] [☰ My order]     │ │ [Share ₱880] [Ticket] [✓ I'm ready]   │
│   ready: [☰ My order ✓]  (ok-wash)     │ │ + Order tab, above Liza's first row:  │
│                                        │ │   "Check my order →"                  │
```

M2 My order sheet (guest Liza, 375):
```
┌──────────────────────────────────────────┐
│ My order                             [✕] │
│ Round 2 · Not marked ready yet           │
│──────────────────────────────────────────│
│ FOR YOU                                  │
│ 2× Sinigang · Large                [−][+]│
│    No sauce, extra calamansi · Edit      │
│ 1× Halo-halo                             │
│    added by Host          [That's mine?] │  (D43 a)
│ THE HOST ADDED THESE FOR "LIZA". YOURS?  │  (D43 a, only if any)
│ 1× Pancit                 [That's mine?] │
│ YOU ADDED FOR OTHERS                     │
│ 1× Sisig · for Jun · Edit          [−][+]│
│ SHARED                                   │
│ 1× Crispy Pata · whole table             │
│──────────────────────────────────────────│
│ [        ✓ I'm ready        ]            │
│ The host sees this. Changing anything    │
│ clears it.                               │
└──────────────────────────────────────────┘
```
M2-empty: "Nothing for you in round 2 yet." then any SHARED rows, same footer.
M2-ready: header "Round 2 · You're ready"; footer button `[✓ Ready · tap to undo]` (ok-wash, aria-pressed=true).

M3 Order options (host, 375), new row above End:
```
│ Your name [ Kovie        ]              │
│ Order name [ Max's Restaurant ] [Save]  │
│ ─────────────────────────────────────── │
│ How Salo works                          │
│ Hand over host →                        │
│ All done? End order                     │
```

M4 Pick step:
```
│ ← Hand over host                    [✕] │
│ Who should host this order?             │
│ ( ) Jun · co-host                       │
│ ( ) Liza                                │
│ ( ) Ana                                 │
│ [ Continue ]  (disabled until picked)   │
```

M5 Confirm step:
```
│ ← Make Jun the host?                [✕] │
│ • Jun can confirm rounds, change prices,│
│   record payments and end the order.    │
│ • You become a guest. You can't undo    │
│   this; only Jun can hand it back.      │
│ • Everyone's phone updates right away.  │
│ Your name [            ] (only if "Host")│
│ [      Make Jun the host       ]        │
│ [        Keep hosting          ] (ghost)│
```

M6 New host's notice (Updates): "Kovie made you the host." → opens the order.

## Slice 7: invite continuity and reliability (F10, F12)

Status: landed (PR pending)

Verify 2026-11-27: checker typecheck/lint/1035 unit/build + 47 touched e2e pass; reviewer SHIPPABLE (fixed: `docs/pwa-invites.md` join line; corrections replay test rewritten to record real corrections); qa SHIPPABLE (7 flows); ui-critic SHIPPABLE, 3 fix-in-loop items fixed and measured (hint code weight 500, no gap before ".", curly apostrophe). Follow-ups in `.shots/follow-ups.md`.

Brief F10 quoted from `salo-v1-4-brief.md:659-720`, F12 from `:762-800`. Research 2026-11-27 re-verified the audit's F10/F12 rows (`salo-v1-4-audit.md:45-60`) against slices 3–6. Slice 6 shots and handoff moved to `.shots/v1-4-slice6/`. Baseline: `.shots/before/` (21 states, script `.shots/before-s7.mjs`; `invite-ended-member-*` re-captured after End: the 404).

### Ask ledger (slice 7)

| # | Owner's words | Planned change | Status |
|---|---|---|---|
| S7.1 | "Define the proper PWA scope." | `manifest.ts`: `id: "/"`, `scope: "/"` (D44) | done |
| S7.2 | "Support installed-app link capture." / "Evaluate launch-handler behavior." / "Avoid opening unnecessary duplicate application windows." | `launch_handler: { client_mode: "navigate-existing" }` (D44); capture itself is the OS's call, documented as such | done |
| S7.3 | "Preserve the destination invitation." / "No invite codes are lost." | Invite page shows the code with a Home Screen hint (D45); join failures keep name and URL (already true) | done |
| S7.3b | "Clear installed-app guidance." (iOS, Consider) | The D45 line: guidance for someone already using the Home Screen app, not an install how-to | done |
| S7.3c | "Session resumption." (iOS, Consider) | Not doing: no cross-context identity; F09 rules out insecure takeover | not doing |
| S7.3d | "Browser/PWA storage isolation." (iOS, Consider) | Documented in `docs/pwa-invites.md`, `[unverified until device check]` | done |
| S7.3e | "Review the PWA manifest and invite routing." / "Use supported browser and OS mechanisms." / "Installed PWA launch works where supported." | Manifest per D44, invite routing per D46; launch behaviour confirmed by owner device check | done |
| S7.4 | "Invitations open the correct session." | A member opening their ended order's invite lands on the order instead of a 404 (D46) | done |
| S7.5 | "Browser fallback remains usable." / "Maintain a reliable browser fallback." / "No invite codes are lost." | Invite page stays the browser path; offline join error says what really happens | done |
| S7.6 | "Existing sessions are not silently overwritten." | Already true (per-session cookies `credentials.ts:13-30`); pinned by a new e2e | done |
| S7.7 | "Android and iOS behavior is documented accurately." / "Do not claim ordinary external HTTPS links can always force-launch a Home Screen PWA." / "Never use an unreliable custom URI scheme" | New `docs/pwa-invites.md`: what each platform does, what's unverified until a real-device check; no custom scheme | done |
| S7.8 | F12 "Audit and strengthen: Server-Sent Events delivery. Reconnection behavior." | Covered: durable log replay + resync (`events.ts:19`, `use-session.ts:300-313`), `realtime.test.ts:81-155`; written up in new `## Reliability scenarios (F12)` section of `docs/realtime.md` (audit file untouched) | done |
| S7.8b | "Offline change queues. Direct-save retries." | Queue persisted (`use-session.ts:214-228`, `queue.test.ts`); direct saves retry on `online` (`use-direct-save.ts:56-67`); new offline payment e2e (S7.12); serving per D48 | done |
| S7.8c | "Idempotency keys." | `mutations.ts:62-78`; `contract-billing-after-end.test.ts:150` (E02), `contract-adjustments.test.ts:576` (R07); lost-response e2e (S7.10) | done |
| S7.8d | "Concurrent serving updates." | `contract-serving.test.ts:545-596` (slice 3) | done |
| S7.8e | "Stale price revisions." / "Simultaneous adjustment changes." / "Conflict handling." | `contract-table-prices.test.ts:203`, `contract-adjustments.test.ts:103`, `e2e/adjustments.spec.ts:97` | done |
| S7.8f | "Session revision behavior." | Gap-free revisions, stale snapshots ignored (`use-session.ts:244`); `realtime.test.ts` | done |
| S7.8g | "No duplicate serving increments, duplicated discounts, lost payments, silently overwritten prices, or invalid totals." / "Preserve existing working infrastructure and apply targeted improvements only." | Serving: `contract-serving.test.ts`; discounts/payments: S7.10; prices: `contract-table-prices.test.ts:203`; totals: money tests in `tests/kkb*.test.ts` + slice 9 property tests. No new infrastructure | done |
| S7.9 | F12 "Test: Two co-hosts mark the same dish served simultaneously. Host revokes a co-host while an update is pending." | Already fixed and tested in slice 3 (`contract-serving.test.ts:545-596,645-664`, `e2e/cohosts.spec.ts:60,91`); cited, no new work | done |
| S7.10 | F12 "A discount save succeeds but its response is lost. The client retries a saved receipt adjustment." | New e2e: response dropped after the server commits (adjustment, receipt, payment); retry must not duplicate or show a false conflict | done |
| S7.11 | F12 "Two devices edit the same bill." | Already covered (`contract-table-prices.test.ts:203`, `e2e/adjustments.spec.ts:97`, `e2e/quick-prices.spec.ts:110`); cited | done |
| S7.12 | F12 "The host switches networks during settlement." | New e2e: host records a payment offline, it retries on reconnect and lands once | done |
| S7.13 | F12 "A participant reconnects after several corrections." | New contract/realtime test: replay after several correction events, then snapshot matches | done |
| S7.14 | F12 "An order closes while changes remain queued." | Replay-after-End already pinned (E02, R07). New e2e only for a fresh queued add: guest adds offline, host ends, guest reconnects → "Not saved" list with Discard, nothing lands | done |
| S7.15 | F12 "Notification read-state synchronization." | Documented limitation kept (refresh-only across one person's devices, `notifications.ts:150-158`) | done |
| S7.16 | Slice 3 deferral: "persisting serving edits across reload (slice 7 F12)" | D48 (b): unsent / failed / in-flight served taps persisted with keys in `localStorage` `salo:served:<sessionId>`, resent on load | done |

### Today (slice 7)
- Manifest: `name`, `start_url: "/"`, `display: "standalone"`, colours, icons; no `id`, `scope`, `launch_handler`; no service worker (`src/app/manifest.ts:5-20`). Next's type has `id`, `scope`, `launch_handler` but not `handle_links` (`node_modules/next/dist/lib/metadata/types/manifest-types.d.ts:26,28-30,43`).
- Invite page: closed or unknown code → `notFound()` (`src/app/i/[code]/page.tsx:55`) runs **before** the "already a member → redirect" check (`:60-61`), so a member tapping their ended order's link gets "Wala dito." while the order is still viewable at `/s/<id>` until expiry.
- Join form offline: shows the shared network message "No connection. Your change is kept and will be retried." (`api-client.ts:48`, shown by `join-name-form.tsx:33`); nothing is kept or retried there.
- No standalone detection or install guidance anywhere. iOS Home Screen apps don't share cookies with Safari, so a guest who joined in Safari is a stranger in the Home Screen app; the landing page's code field (`components/landing/join-form.tsx`) is the only way in from there, and the invite page never shows the code as text.
- F12, re-verified: co-host serving race and revoke-under-lock fixed in slice 3; offline direct saves retry on `online` (`use-direct-save.ts:56-67`, 8 sheets); queue persisted in `localStorage` `salo:queue:<id>` (`use-session.ts:214-228`); server replay by key in `mutation_records`, before the closed check (`mutations.ts:62-82`). A lost-response retry of the same request reuses its key (`use-direct-save.ts:22-27`) and replays, but only while the same sheet stays mounted: ids are minted per mount (`adjustment-sheet.tsx:75`, `receipt-sheet.tsx:56`, `payment-sheet.tsx:55`). **Ceiling:** lost response, then close or reload and re-enter → a second row; the first is visible in the list via SSE. Accepted and documented in `docs/realtime.md`; fixing it needs a persisted id per sheet. Other gaps are test gaps plus serving taps held only in memory (`use-served-edits.ts:43-45`).

### Approach (slice 7)
1. **Manifest** (`manifest.ts`): add `id`, `scope`, and per D44 `launch_handler`. `id: "/"` equals the id browsers already derive from `start_url: "/"`, so existing installs are not treated as a new app.
2. **Invite page** (`i/[code]/page.tsx`): keep `lookupInvite` first. For a found CLOSED invite, don't `notFound()` at `:55`; run the cookie + `resolveActor` check (`:60-61`) first and `notFound()` only with no actor (D46). Move `inviteActivity` (`:57`) after the actor check. `resolveActor` already returns null for expired orders and removed guests (`actor.ts:36-46,53-57`); `loadSessionForPage` renders closed orders for members (`page-data.ts:12-17`), so no loop. Strangers keep the same 404 (comment at `:54`). Home Screen line (D45): shows `normalizeJoinCode(code)` (`join-code.ts:6`) in the `tally` class with `sr-only` spaced letters as `invite-sheet.tsx:102-104`; hidden with `[@media(display-mode:standalone)]:hidden` (no JS `matchMedia`, it would flash).
3. **Join form**: when `err instanceof ApiError && err.isNetwork` (`api-client.ts:11`), override the message in `join-name-form.tsx` only; other errors keep `err.message` ("No connection. Your name is still here; try again when you're back online."); `api-client.ts` stays shared and unchanged.
4. **Docs**: `docs/pwa-invites.md` (platform behaviour, labelled verified / unverified), new `## Reliability scenarios (F12)` section in `docs/realtime.md` (incl. the lost-response ceiling), `HANDOFF.md` known limitations.
5. **Tests**: the new e2e and contract tests in the ledger. Any test that fails reveals a bug that gets fixed in this slice.
6. **Serving persistence** (D48 b, `use-served-edits.ts`): every `put` mirrors edits to `localStorage` `salo:served:<sessionId>`, keeping only edits with `unsent > 0`, failed ones, or `sending > 0 && committedRevision === null` (an in-flight send is stored with its key and `expected`, so a resend after reload replays instead of counting twice). On mount with `canServe`, read back (pure `toStoredServed` / `fromStoredServed`, unreadable entries dropped, as `queue.ts` `toStored`/`fromStored`) and send each: in-flight with its stored key, unsent as a new batch. A stale `expectedServed` applies nothing and returns the current count (`serving.ts:36-39`). Losing the role (`dropAll`, 403, `!canServe`) also clears the storage key. Listed on `/cookies` (`src/app/cookies/page.tsx`) beside `salo:queue`.

Rejected: storing the pending invite code in `localStorage` with a "Continue joining" prompt (doesn't cross the iOS Safari/Home Screen storage split, which is the real gap; the code is already in the URL and share text). Server-side "same id + identical body = 200" for adjustments/receipts like payments: within one mounted sheet the same-body retry already replays by key; after close or reload the id is new, so it would never fire either.

### Reuse
- `resolveActor`, `credentialCookieName` (already on the invite page); `lookupInvite` returns the invite with its status, and `expiresAt` filtering already makes expired orders "missing" (`join.ts:38`).
- Existing e2e helpers in `e2e/` (offline via `context.setOffline`, as `reconnect-retry.spec.ts`).
- Dropping a committed response: `page.route` on the real adjustment / receipt / payment PUT path with a first-request-only counter: `await route.fetch(); await route.abort("failed")`, later calls `route.continue()`. The abort reads as NETWORK, the sheet shows Try again (`adjustment-sheet.tsx:340`, `receipt-sheet.tsx:205`, `payment-sheet.tsx:162`); `online` never fires, so the test clicks Try again (same key → replay). Assert exactly one row and no conflict banner.
- `queue.ts` `toStored` / `fromStored` conventions for the served store (D48 b).

### Not doing (slice 7)
- No service worker, offline invite page, or custom URI scheme.
- No `handle_links` (not in Next's type; Chromium-experimental).
- No "resume on a new device" or cross-context identity (would need a takeover path; F09 rules out insecure takeover).
- Notification read state stays refresh-only across one person's devices.
- No change to the landing page's "Nothing to install" (still true: Salo works in the browser).
- `theme-color` on landing/invite (tomato bar over paper, `layout.tsx:49-52`) stays as is; flag for slice 8/10 brand pass.
- No pruning of stale `salo:queue:*` keys or `mutation_records`.
- Real-device Android/iOS link tests: owner task (below).

### States (slice 7)
| State | After |
|---|---|
| Stranger opens invite (browser) | As today + one line "Using Salo from your Home Screen? Open it and enter **ABCDEF**." under the card (D45) |
| Same, already in the installed app (standalone) | Line hidden |
| Member opens own open order's invite | Redirect to the order (unchanged) |
| Member opens own **ended** order's invite | Redirect to the order (read-only ended view) instead of 404 (D46) |
| Member opens own **cancelled** (never confirmed) order's invite | Redirect to the cancelled view (`workspace.tsx:581`) |
| Member of an order past its deletion date | 404 (invite "missing", `/s/<id>` gone) |
| Removed guest opens an ended order's invite | 404, as a stranger |
| Hint at 320, light and dark | Centred, wraps freely like the line above |
| Stranger opens ended / unknown code | Same 404 as today |
| Join offline | "No connection. Your name is still here; try again when you're back online."; name kept; button re-enabled |
| Member of A opens invite B | Joins B; A untouched, both in "Pick up where you left off" (pinned by e2e) |
| Widths | 320, 375, 768, 1280; light and dark |

### Decisions

Owner answers 2026-11-27: D44 (a), D45 (a), D46 (a) = recommended; D48 = (b) persist.

- **D44 [decided: (a)] Manifest launch behaviour.** (a) `id: "/"`, `scope: "/"`, `launch_handler: { client_mode: "navigate-existing" }`; (b) `id`/`scope` only; (c) (a) + `handle_links: "preferred"` via a type cast. Recommend (a): `navigate-existing` reuses an open window where Chromium supports it ("Avoid opening unnecessary duplicate application windows") and is ignored elsewhere; `handle_links` isn't in Next's manifest type (`manifest-types.d.ts`) and is experimental.
- **D45 [decided: (a)] Home Screen hint on the invite page.** (a) one line under the card showing the code, hidden in standalone; (b) no hint, docs only; (c) a guide step about installing too. Recommend (a): the code is what an iOS Home Screen user needs (Safari and the Home Screen app don't share storage), and memory "entry point at first use" says guidance belongs where users first meet it.
- **D46 [decided: (a)] Member opens their ended order's invite.** (a) redirect to `/s/<id>`; (b) an "This order has ended" page with a link. Recommend (a): the ended view already exists and is read-only (`workspace.tsx:587`); strangers keep the 404.
- D47 unused.
- **D48 [decided: (b) persist, against the recommendation] Serving taps across reload.** (a) keep in memory (today); document; (b) persist unsent/failed taps with keys in `localStorage` and resend on load. Recommend (a): a lost offline tap leaves the count visibly unchanged and is re-tapped; `expectedServed` (`serving.ts:36-39`) makes (b) safe but it adds a second persisted queue for a kitchen counter; offline taps already retry on reconnect (`reconnect-retry.spec.ts:5-15`), only a reload loses them. Slice 3 promised this here (`salo-v1-4.md:528`), so (a) drops that deferral.
- **Mobile scope**: carried from D6, responsive + native feel; this slice touches only the invite page and join form.

### Assumptions
- Hint copy: "Using Salo from your Home Screen? Open it and enter **ABCDEF**." (code in mono, as the invite sheet).
- Lost-response tests: if the sheet shows "Someone changed this" after a committed create whose body the person then edited, that conflict is correct (the first save did land) and Keep mine re-saves; only a duplicate row or a stuck sheet counts as a bug.
- Docs label platform claims `[verified in code]` or `[unverified until device check]`, as the audit does.

### Done when (slice 7)
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e` pass.
- `GET /manifest.webmanifest` has `id`, `scope` (and `launch_handler` per D44).
- Unit: `toStoredServed`/`fromStoredServed` round-trip and drop rules in `tests/served-edits.test.ts`.
- New e2e: served tap offline → reload → online lands exactly once (in `e2e/reliability.spec.ts`).
- New e2e: `e2e/invite-continuity.spec.ts` (ended-member redirect, stranger 404, A→B no overwrite, offline join message, hint element carries the `display-mode: standalone` hide class — Playwright can't emulate display-mode); `e2e/reliability.spec.ts` (lost response on adjustment / receipt / payment create, offline payment then reconnect, queued-then-ended). New test in `tests/realtime.test.ts` or a contract file: reconnect after several corrections.
- Manual: invite page shots at 320/375/768/1280, light/dark, vs `.shots/before/`.

### Skills
- `mobile-native` (PWA manifest, standalone media query), `impeccable` + `.impeccable/surfaces/src-app.md` (invite copy), `e2e-testing`, `contract-first` (contract docs if a contract changes).

### You need to do (slice 7)
- [ ] Real-device check after merge: Android (Chrome, Messenger) and iPhone (Safari, Home Screen app) open an invite link; hint hidden inside the installed app; note results in `docs/pwa-invites.md`.

### Mockups (slice 7, text sketch)
M1 Invite page, browser (375):
```
┌ ticket ─────────────────────────────┐
│ [logo]                              │
│ Join the order at Max's Restaurant  │
│ Add your dishes to the table's …    │
│ ● Live · 3 people · 5 items so far  │
│ Your name [            ]            │
│ [        Join the order        ]    │
└─────────────────────────────────────┘
No app or account. Your name is only shown to this table.
Using Salo from your Home Screen? Open it and enter ABCDEF.   ← new (D45)
        Not now, back to Salo
```
M3 Hint at 320: same line, centred, wraps to two lines under "No app or account…".

M2 Join offline: under the name field, "No connection. Your name is still here; try again when you're back online."
