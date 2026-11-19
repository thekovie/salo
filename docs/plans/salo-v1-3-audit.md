# Salo v1.3 — Phase 0 UI/UX audit

Date: 2026-11-19. Plan: [`salo-v1-3.md`](salo-v1-3.md). Brief: [`salo-v1-3-brief.md`](salo-v1-3-brief.md).

## Method and limits

- **Code inspection** (C): full read of the composer, edit sheet, price editor, workspace, header, tabs, KKB, summary, toasts, drawers, the realtime layer, mutations, schema, and the order/settlement services. Findings cite `file:line`.
- **Browser observation** (B): 58 states captured on local `next dev` with Chromium (Playwright, reduced motion, DPR 2) at 320 / 360 / 375 / 390 / 430 / 768 / 1280, light plus one dark state, host and guest contexts, seeded through the UI. Each state also has geometry (`measure-rows.js`), horizontal-overflow and sub-44 px target measurements. Files: `.shots/before/*.png|json`, summary `.shots/summary-before.json`, script `.shots/capture-baseline.mjs`.
- **Hypothesis** (H): needs a real device, a screen reader, or real users.
- **Not done:** real Android/iOS, VoiceOver/TalkBack, virtual keyboard, real-user task tests. Nothing here is user research. The owner's earlier Android run (2026-11-08) and the one usability run on the pre-November UI (HANDOFF task 6) are the only real-world evidence, and they predate KKB.
- **Not measured:** contrast ratios (no computed-colour run this pass; prior e2e runs checked AA with axe per `docs/testing.md`).

## 1. Executive findings

1. **Sizes and notes are hidden inside "Who's it for"** (B+C, High). At 320 px the open panel fills the whole content area; "Size, notes or price" sits below eight recipient chips, and only the price field is visible before the panel's 45dvh cap clips size and instructions (`composer-notes-open-320.png`, `composer.tsx:137-224`). Typing "Katsu, large, no sauce" into the dish field is the path of least resistance. This is the root cause the brief asks about.
2. **Same dish, different prices is already visible** (B, High for F02). KKB lists "Chicken Katsu (No sauce) ₱120.00 each" and "Chicken Katsu (Large) — Add price" as unrelated lines (`kkb-partial-prices-375.png`). Every line is priced alone (`entry_settlements` per entry, `kkb.ts:157`).
3. **Items and KKB disagree about pending corrections** (C, High, billing). Items applies a correction the moment it's recorded; KKB only after the waiter is told (`summary.ts:28-40` vs `kkb.ts:162-166`). The copied Items text can drop a dish the waiter still brings and bills.
4. **"Collected" vs "told the waiter" is clear for rounds, not for corrections** (C, Medium). A correction's pending/told state is inferred from its round's status; the UI doesn't label it (`ticket.ts:4-18` has no `communicatedAt`).
5. **Price completeness is invisible until a service charge exists** (B+C, Medium). With no service charge the KKB status line reads only "Service charge: not entered yet" (`kkb-partial-prices-375.png`, `kkb-view.tsx:128`); per-person "2 items no price" badges exist but no table-level count.
6. **The confirmed screen has a natural home for tracking** (B). After confirm, the Order tab is the stamped ticket then "What's next?" (`order-after-confirm-375.png`, `workspace.tsx:527-559`). A served section fits between them without a new tab.
7. **Layout holds at every width** (B). No horizontal overflow in any of 58 states; long dish names wrap (`workspace-long-375.png`).

## 2. Current user journeys

| Journey | Steps today | Friction |
|---|---|---|
| Host starts alone | Landing → Start an order (1 tap) → name prompt card → type dish → Add | Name card pushes the ticket down on first view (`workspace-empty-375`); dismissible |
| Dish with size/notes | Type dish → tap *For ▾* → scroll past recipient chips → tap *Size, notes or price* → fill → Add | 3 taps + scroll; hidden under recipient selection (finding 1) |
| Guest joins | QR / link `/i/<code>` → name → Join → toast "You're in!" | Clear |
| Review & confirm | Review order → checks → Show the waiter → Mark confirmed → dialog → stamp | Clear; confirm disabled until saved |
| Correction after confirm | Rounds tab → (Start round N first) → Correct a dish → pick preparation → Cancel some / Change it | Needs an open round first (`rounds.ts:142`); one source entry per record |
| Settle | Who ordered what → KKB → Add price per line → service charge | Per-line pricing; no completeness count; no copy of totals |
| End | Options → End order (or What's next?) → summary opens | Warns about an unconfirmed round only |

## 3. Screen-by-screen

- **Landing** (B: `landing-*`): purpose clear in the hero; four "How it works" scenes cover start, add, ticket, settle up. Footer links are 20 px tall (Low). Copy describes only shipped features.
- **Setup guide** (B: `setup-guide-*`): step dots 34.5×44 (Low, under 44 wide; WCAG 2.5.8's 24 px minimum is met).
- **Workspace header** (B+C): "Name this order" is a `<button tabIndex={-1}>` in the `h1`, 25 px tall, duplicating Options (`session-header.tsx:41`, Low). Row 1 has spare width on the right for a bell.
- **Composer** (B+C): finding 1. Dish input is 36 px tall at every width (Medium against the project's 44 px rule in PRODUCT.md; its label wrapper may enlarge the real tap area, H). Suggestion container has `aria-label` on a role-less div (`composer.tsx:120`, Low). "Has notes" dot is colour-only and aria-hidden (`:175`, `:268`, Low).
- **Ticket** (B): big counts, preparations indented, readable at 320 (`workspace-dishes-320`).
- **Edit dish sheet** (B+C): flat size/notes, no price; differs from the composer (`edit-dish-sheet.tsx:83-96`, Medium).
- **Tabs** (B): four tabs with counts fit at 320 (`workspace-dishes-320`); the code-trace clipping hypothesis was not observed.
- **Rounds / corrections** (B+C): correction drawer works; "up to N at a time" per source entry (`rounds-view.tsx:138`, Medium).
- **KKB** (B+C): findings 2 and 5. "Not yet allocated · 1 thing to review" is accurate and does not present an incomplete total as final.
- **Ended order** (B): banner with deletion date, Rounds tab default.
- **Guest view** (B): only the Dish field is under 44 px. "I'm ready / Ticket" clear.

## 4. Usability issues (heuristic, severity)

| # | Screen | Problem | Heuristic | Sev | Evidence | Fix | Cx | Slice |
|---|---|---|---|---|---|---|---|---|
| U1 | Composer | Size/notes/price nested in recipient panel | Recognition over recall; discoverability | High | B `composer-notes-open-320`, C `composer.tsx:166` | F01 visible chips | M | 1 |
| U2 | Who ordered what | Items applies pending corrections; KKB doesn't | Consistency; error prevention | High | C `summary.ts:28` vs `kkb.ts:162` | One effective-order function | S | 1 |
| U3 | KKB | Same dish priced line by line | Efficiency; consistency | High | B `kkb-partial-prices-375`, C `kkb.ts:157` | F02 | L | 2 |
| U4 | Corrections | Confirmed dish needs a new round before recording | User control | Medium | C `rounds.ts:142` | F03 (D4) | M | 3 |
| U5 | Corrections | Cancel across people needs one record each | Efficiency | Medium | C `rounds-view.tsx:138` | Batch correction | M | 3 |
| U6 | Corrections | Pending vs told not labelled | Visibility of status | Medium | C `ticket.ts:4-18` | Labels | S | 3 |
| U7 | KKB | No price completeness until service charge | Visibility of status | Medium | B, C `kkb-view.tsx:128` | F08 | S | 6 |
| U8 | Edit sheet | Differs from composer, no price | Consistency | Medium | C `edit-dish-sheet.tsx:83` | F01 | S | 1 |
| U9 | Toasts | One at a time, 6 s; a second action drops the first Undo | User control; WCAG 2.2.1 timing | Medium | C `toasts.tsx:9,30` | Pause on hover/focus; keep last Undo reachable | S | 3 |
| U10 | After confirm | Nothing tracks what arrived | Match to real world | feature gap | B `order-after-confirm-375` | F06 | L | 4 |
| U11 | Header | Title is a pointer-only button duplicating Options | Consistency | Low | C `session-header.tsx:41` | Plain heading | S | 1 |

No Critical issues found: every primary workflow completed in the browser run.

## 5. Accessibility (WCAG 2.2 AA)

- C, good: drawers use vaul (focus moves in and returns; Escape closes); full-screen sheets use native `<dialog>`; toasts in a polite live region; sync pill announced; reduced motion respected (`globals.css:244-260`); status in words and icons.
- C, Low: role-less labelled div (`composer.tsx:120`); colour-only notes dot (`:175`); header `h1` button (`session-header.tsx:41`).
- C, Medium: toast timing (U9).
- B: targets under 44 px (`.shots/summary-before.json`): Dish input (36 h), header title (25 h), footer links (20 h), guide dots (34.5 w). All meet WCAG 2.5.8's 24 px minimum; they miss the project's own 44 px rule.
- H: screen-reader flow, contrast in sunlight, large-text zoom: owner task.

## 6. Mobile responsiveness

- B: no horizontal overflow at any width (58/58). Header row 2 halves under 400 px work. Long names wrap. Composer panel at 320 is cramped (U1).
- C baseline, present: viewport with `viewportFit: cover`, pinch zoom allowed (`layout.tsx:46-52`); theme-color light/dark; tap highlight off (`globals.css:174`); `touch-action: manipulation` (`:208`); inputs ≥16 px; dvh everywhere, no raw `vh`; top/bottom safe areas; scroll padding for the dock (`:173`).
- Gaps: `interactive-widget=resizes-content` missing, so on Android Chrome the fixed dock may sit behind the keyboard (H, `layout.tsx:46`); dark theme-color is page paper while the dark header band is `globals.css:74` (H); no long-press guard on buttons (H); no left/right safe areas (Low); Playwright runs Chromium/Pixel 7 only (`playwright.config.ts:24`).

## 7. Information architecture

- Keep four tabs. New features go where users first meet them: size/notes/price in the composer; served progress on the Order tab after confirm (above "What's next?"); a bell in header row 1; receipt check, completeness and Copy summary inside KKB; outstanding food in the End-order sheet.
- Stage emphasis already exists (draft dock vs confirmed "What's next?" vs ended banner); new surfaces follow it rather than adding navigation.

## 8. Proposed interaction improvements

Plan slices 1–6 and mockups: visible detail chips in the composer and edit sheet; table prices with per-line override; one correction drawer with Unavailable; served steppers per preparation; notification drawer; KKB completeness, receipt check and Copy summary.

## 9. Priorities

1 Composer + Items/KKB alignment → 2 Shared prices → 3 Unavailable/corrections → 4 Tracker → 5 Notifications → 6 Billing extras + landing copy → 7 Final verify (D7 asks whether tracker goes before notifications).

## 10. Acceptance criteria (testable)

- Composer: size, note and price are each reachable in one tap from the default composer at 320 px without opening *For*; e2e adds a dish with size + note + price in ≤ 4 taps after typing the name.
- A comma name ("Gyoza, large") offers a split and saves `dish=Gyoza, variant=large` only after Split; Keep saves the name unchanged.
- Items and KKB show the same quantities for a session with a pending cancellation.
- Pricing one "Chicken Katsu (Large)" line as host prices every matching line; an override line keeps its own price; KKB totals equal the sum of resolved prices (unit test).
- A confirmed dish can be marked unavailable without opening a round; KKB drops it at once; the round's waiter ticket snapshot is unchanged (DB test).
- Served count can never exceed effective expected (concurrency test); tracker shows "3 of 5 served · 2 waiting".
- A notification is written once per recipient per event, never to the actor, and survives reload and reconnect.
- KKB shows "n of m dishes priced" with no service charge; a receipt difference shows when food + service charge ≠ receipt; Copy summary text matches the KKB view numbers.
- No horizontal overflow and no new sub-44 px targets at 320–1280 in the after-capture.
