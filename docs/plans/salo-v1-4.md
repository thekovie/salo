# Salo v1.4: billing, co-hosts, continuity (plan)

Owner's brief, kept in full: [`salo-v1-4-brief.md`](salo-v1-4-brief.md). Phase 0 audit: [`salo-v1-4-audit.md`](salo-v1-4-audit.md). Baseline screenshots: `.shots/before/` (git-ignored; v1.3 shots archived in `.shots/v1-3/`).

Each slice ships as its own branch and squash PR into `dev` (HANDOFF working rules). One slice per session: `/clear`, then `/workflow:kickoff slice N of docs/plans/salo-v1-4.md`. Later slices get their own research, decisions and text sketch when they start; the cross-cutting decisions below are settled now because they shape migrations.

## Slices

| Slice | Brief | Content | Migration | Status |
|---|---|---|---|---|
| 0 | Phase 0 | Audit (`salo-v1-4-audit.md`) + this plan | — | done (decisions answered 2026-11-23) |
| 1 | F01 + F11 (pricing part) | Price status in What's next, quick-entry Prices sheet, draft persistence, guest "so far" label | none | landed (PR pending) |
| 2 | F02, F03 | Receipt adjustments, allocation methods A–E, adjusted vs actual totals | 0013 | not started |
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
| L13 | F02 "Receipt Discounts and Adjustments" incl. "The restaurant's final receipt is authoritative… must not subtract that discount again" | Adjusted total and receipt total shown separately; discrepancy never forced to zero | 2 | not started |
| L14 | F03 "Proportional / Equal / Individual / Manual / Unallocated" | Allocation methods over `allocate` | 2 | not started |
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
- [ ] (carried from v1.3) KKB pilot, backups: see HANDOFF Owner tasks.

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
