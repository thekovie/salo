# Salo v1.4 Phase 0 audit

Brief: [`salo-v1-4-brief.md`](salo-v1-4-brief.md) (owner, 2026-11-23, verbatim). Plan: [`salo-v1-4.md`](salo-v1-4.md).

**Evidence labels.** `[code]` = read in the repository at `755b0ec` (dev). `[node]` = checked with a `node -e` snippet. `[browser]` = local Chromium via Playwright (`.shots/before/`, git-ignored). `[unverified]` = general platform knowledge, to be checked on devices. No real-device testing and no real-user testing was done for this audit.

## 1. Technical gap assessment

### Roles and permissions
- `[code]` One role column, `participants.role` ∈ HOST | GUEST (`schema.ts:26,77`); exactly one host per session by partial unique index (`schema.ts:90`); removal only for guests (`schema.ts:88`).
- `[code]` `can(actor, action)` (`permissions.ts:33-35`) is a flat host-only set. Action names are already capability-shaped (`serving.update`, `receipt.set`, `price.default`), so co-host = widen `can()`, not a new framework.
- `[code]` **Gap (blocks F04/F09).** The actor's role is resolved before the transaction (`auth/actor.ts:36-46`). `runMutation` re-checks only `removedAt` under the session lock (`mutations.ts:53-57`). A write that passed `can()` just before a revoke or transfer commits can land after it. Fix: re-select role (and co-host flag) under the lock and re-run the permission check there.
- `[code]` Host-check sites a role change must reach: server `serving.ts:15`, `rounds.ts:92,136,169,224,241`, `settlement.ts:35,37,69,89,139,148,157`, `people.ts:32-34,71,104,109,128,187,197,215`, `entries.ts:67,116`, `unavailable.ts:25`, `sessions/rename.ts:11`; client `workspace.tsx`, `kkb-view.tsx`, `review-panel.tsx`, `rounds-view.tsx`, `people-view.tsx`, `groups-view.tsx`, `service-charge-block.tsx`, `lib/views.ts`, `lib/summary.ts:69`, `onboarding/guide-steps.ts`, `landing/resume-list.tsx`. Several derive "the host" by `role === "HOST"` lookups (ready notice `people.ts:32`, claim owner `people.ts:109`), which a transfer must keep correct.
- `[code]` `participant_credentials.credential_type` copies the role at creation and is never read (`create.ts:42`, `join.ts:70`); stale after a transfer, harmless.

### Serving (F04)
- `[code]` Host-only `updateServed` (`serving.ts:14-50`): delta input, row `FOR UPDATE`, clamped to 0..expected from the effective order, idempotent per key, `updated_by` = last actor only, `food.served` notified once per line. UI `served-section.tsx` already takes `canEdit`.
- `[code]` **Gap.** Two people tapping +1 for the same plate both land (delta), clamped only at the expected count. `served_counts.revision` is written but never checked. This is the brief's "two co-hosts mark the same dish served" case.

### Pricing (F01)
- `[code]` Resolution: own price → table price (dish + size, `shared_prices`) → unknown (`kkb.ts:150-158`); unknown is `null`, never ₱0 (`tests/kkb.test.ts:67`). Completeness counts distinct dishes (`kkb.ts:282-295`).
- `[code]` Entry point after confirming: a low-emphasis ghost button "Enter receipt prices (KKB)" in What's next (`workspace.tsx:638-640`), then the KKB tab, then "Show the n without a price" (`kkb-view.tsx:184-197`), then a per-line editor (`price-editor.tsx`). One dish at a time; no completeness on the Order screen.
- `[code]` Typed prices live only in the open editor; closing the row loses the value and its pending retry (`use-direct-save.ts:21-66`).
- `[code]` **Gap (guest incompleteness).** Under 430 px the dock label shortens "My share so far · ₱X" to "Share ₱X" (`kkb.ts:363`), dropping the only sign that the share is incomplete on most phones.

### Billing (F02, F03, F05, F06, F07)
- `[code]` Pure, integer-centavo KKB (`kkb.ts`, `money.ts`, `effective-order.ts`). One service charge allocated by food subtotal with exact largest remainder (`kkb.ts:228-278`). Bill to: a shared dish has one payer for the whole line (`kkb.ts:92-107`). One session-level receipt total, compared but never split (`kkb.ts:307-323`, `sessions.receipt_total_centavos`).
- `[code]` Nothing exists for adjustments, allocations, multiple receipts, split dishes or payments (no "paid" anywhere in `src`).
- `[code]` **Gap (timing).** Every mutation is refused on a closed order unless it passes `allowClosed` (`mutations.ts:77`), and the KKB UI edits only while open (`kkb-view.tsx:167-168`). Discounts, separate receipts and payments usually happen after the meal; today they would have to happen before "End the order".
- `[code]` Invariant without a test: per-person totals sum to `foodCentavos` only once every shared line has a payer (`kkb.ts:229`). Needs a property test before adjustments are layered on.
- `[code]` The snapshot is identical for every participant apart from `me` and notifications (`sessions/snapshot.ts:59-95`); everyone already sees every price.

### Readiness and My order (F08)
- `[code]` Per-participant per-round readiness, reset on the participant's own changes (`people.ts:19-58`); host sees "n of m ready" (`views.ts:104`, `review-panel.tsx:45-65`) and a `guests.ready` notification. No single "My order" review across rounds.

### Session end and transfer (F09)
- `[code]` No transfer, no co-host, no audit trail. A transfer must demote before promoting inside the session lock, or the one-host index rejects it (`schema.ts:90`). Credentials stay per participant, so the new role takes effect on the next request through the live role lookup.

### Notifications (§7)
- `[code]` `notify()` writes in the same transaction, explicit recipients or all, actor excluded, dedup on (session, recipient, dedup_key) (`server/notifications.ts:23-45`). New kinds need branches in `notificationText` and `notificationTarget` (`lib/notifications.ts:28-67`) and the golden contract (`docs/contracts/notifications.md`). Read state is private and not live across one person's devices (`notifications.ts:144-153`).

### Export (F13)
- `[code]` Items text/image (`summary.ts:53-106`, `/api/sessions/[id]/summary`) are price-free; KKB text (`kkb.ts:326-346`) has per-person totals. No export carries corrections, serving status, receipt comparison, adjustments or payments.

### PWA and invites (F10)
- `[code]` Manifest has `name`, `start_url: "/"`, `display: "standalone"`, icons incl. maskable (`manifest.ts`); no `id`, `scope`, `launch_handler`. No service worker. No standalone detection or install guidance.
- `[code]` Credential = HttpOnly cookie per session `salo_s_<id>`, 31 days (`credentials.ts:13-30`). Opening an invite to order B while in order A keeps A (separate cookies); opening your own order's invite returns you to it (`i/[code]/page.tsx:60-61`). No silent overwrite.
- `[unverified]` Android: an installed WebAPK may capture in-scope links depending on the opening app and the user's "open by default" setting; `capture_links` was dropped and `handle_links`/`launch_handler` are experimental. iOS: https links open Safari, not the Home Screen app, and the two have separate storage, so a guest who joins in Safari is a stranger in the Home Screen app.

### Realtime and offline (F12)
| Scenario | Today | Evidence |
|---|---|---|
| Two co-hosts serve the same dish | Gap | delta, no revision precondition (`serving.ts:34-37`) |
| Co-host revoked mid-update | Gap | role not re-checked under lock (`mutations.ts:53-57`) |
| Save succeeded, response lost | OK for set-style saves (409 on retry); gap for additive creates after reload | direct-save keys live in a ref (`use-direct-save.ts:22`) |
| Two devices edit the same bill | Handled (revisions + CONFLICT) | `settlement.ts:21,44,70,95` |
| Host switches networks | Handled | SSE replay + refetch + retry on `online` (`use-session.ts:289-450`) |
| Reconnect after corrections | Handled | `tests/realtime.test.ts:81-146` |
| Order closes with changes queued | Partial: refused, shown as "Not saved", kept until Discard | `mutations.ts:77`, `workspace.tsx` failed list |
| Notification read state across devices | Refresh only | `notifications.ts:144-153` |

### Room creation (F17)
- `[code]` `/new` (`app/new/page.tsx`): "One moment" + `BotCheck` (`bot-check.tsx`): spinner + "Checking you're a person…" → "Starting your order…" → `router.replace("/s/<id>")`; `role="alert"` errors with Try again; invisible widget unless a challenge is needed. Server: 5 s Siteverify timeout, never fails open, checks hostname + action, rate limit before verification, 10-min in-memory replay (`turnstile.ts:20-39`, `api/sessions/route.ts:28-51`).
- `[code]` Gaps: token expiry resets silently with no message (`bot-check.tsx:95`); no `timeout-callback`/`unsupported-callback`; e2e uses always-pass keys only.
- `[code]` Reduced motion is global (`globals.css:256-264`). `src/components/motion/` holds only `ticker.tsx`; `useScene` pauses off-screen but not on `visibilitychange`.
- `[code]` The current mark (`brand/logo.tsx:3-6`) is explicitly a speech-bubble tail plus "typing…" plates. Any F17 table animation should use a tail-less table so F15 doesn't force a redraw.

### Menu link (F16)
- `[code]` No URL field. Host settings live in `OrderOptionsSheet` (`order-options-sheet.tsx:122-155`, host + open only). Header actions row (`session-header.tsx:58`) or the top of the Order panel can carry "View menu". Rename PATCH (`api/sessions/[id]/route.ts:17-24`) is the mutation template. Per-participant mutation limit is 120/min (`limits.ts:8-14`), too loose; `createRateLimiter` exists (`auth/rate-limit.ts`). CSP does not govern plain link navigation (`csp.ts:14-33`); framing is already forbidden.
- `[node]` WHATWG parsing normalises `https://2130706433/`, `0x7f.1`, `0177.0.0.1`, `127.1` and full-width digits to `127.0.0.1`; strips tabs; accepts `https:example.com` and `https:/\example.com`; `https://example.com\@evil.com` → host `example.com`; IDN → punycode. Rules derived from this are in the plan (F16 slice).
- `[unverified]` Reputation services (Google Safe Browsing Lookup/Update, Web Risk) need a key, send URLs or hash prefixes to Google, and carry usage terms; recommendation: none in v1.

### Mobile baseline
- `[code]` All v1.3 D1 native-feel items landed (slice 8): `interactiveWidget: "resizes-content"` + `viewportFit: "cover"` (`layout.tsx:48-56`), light/dark `theme-color` (`layout.tsx:49-52`, header band override `s/[id]/page.tsx:14-21`), tap highlight (`globals.css:174`), hover gated by Tailwind 4 `@media (hover:hover)`, 16 px inputs (spot-checked), `dvh` only, safe-area insets, long-press guard on buttons (`globals.css:210-213`), `touch-action: manipulation`, WebKit Playwright project (`playwright.config.ts:35-37`).
- `[code]` Partial: no `overscroll-behavior` on `html/body` (pull-to-refresh not suppressed on the page); long-press guard not on `a`/`summary`.
- Stale docs: `HANDOFF.md` Known limitations still list `interactive-widget` and offline-retry (both landed); `PRODUCT.md:22` lists menus out of scope (F16 is a link only; reword).

### Database and migrations
- `[code]` `drizzle/0000`–`0012`, sequential, snapshot JSON per migration, hand-written plpgsql after `--> statement-breakpoint`, `salo_*` functions, `*_same_session` triggers on cross-referencing tables, CHECKs mirrored in schema. Every child table cascades from `sessions` (`schema.ts:19-22`); cleanup deletes the session row (`maintenance/cleanup.ts:12`). Next migration: `0013`.

## 2. UI/UX audit

Browser baseline (`[browser]`): see section 2a (filled from the capture run). Code-inspected findings (`[code]`):

| # | Journey | Finding | Severity |
|---|---|---|---|
| U1 | 7 Host enters prices | Price entry is a ghost button under two outline buttons; one dish per editor; ~3 taps before typing | High (F01) |
| U2 | 10 Guest reviews KKB | "so far" dropped from the dock label under 430 px | High (F01) |
| U3 | 8–9 Actual bill, discounts | Receipt total only compared; no way to record a discount; blocked after End | High (F02/F03) |
| U4 | 6 Track arrivals | Only the host can update; one phone per table | Medium (F04) |
| U5 | 4 Review my order | No single "My order" view across rounds | Medium (F08) |
| U6 | 12 Transfer | No transfer; a host who leaves strands the table | Medium (F09) |
| U7 | 1 Create | Token expiry leaves "Checking…" with no message | Low (F17) |
| U8 | 2 Join via link | No guidance for installed-app users or Safari/Home Screen split | Low (F10) |
| U9 | Large order | People tab renders everyone fully, no collapse; Order tab has no search | Low (F14) |

§3.2 checklist coverage: touch targets and dense lists (B4, B5) `[browser]`; sticky controls (composer overlaps lower ticket rows at 320/375 by design, ticket scrolls under it) `[browser]`; sheet a11y and focus restoration (vaul drawers return focus; keyboard e2e covers dialogs) `[code]`, re-verified per slice; contrast (v1.3 phase 7 axe 0 violations) `[code]`; mobile keyboard behaviour: not testable in Playwright, real-phone task. Journeys 3 (add dishes), 5 (confirm) and 11 (settle) showed no new issue beyond U1–U3 (`order-host-draft-*`, `order-host-confirmed-*`); 11 has no feature today (F07).

### 2a. Browser baseline
`[browser]` Local production build, Chromium, 70 shots + geometry in `.shots/before/` (scripts `.shots/v1-4/`), widths 320/375/430/768/1280, reduced motion on, dark only at host draft 375. No soft keyboard (Playwright), so keyboard-over-input checks remain a real-phone task.

| # | Finding | Evidence |
|---|---|---|
| B1 | No horizontal scroll at any width (`scrollWidth == innerWidth` in every shot, incl. 320) | `_summary.json` |
| B2 | Host post-confirm: What's next and "Enter receipt prices (KKB)" sit at y≈2157–2201 of a 2351 px page at 375 with 6 dishes, ~1,345 px of scrolling. The dock "Share · no prices yet" button reaches KKB with no scroll | `order-host-confirmed-full-375` |
| B3 | Taps to first price: 3 either way (open KKB → Add price → Save) plus a "Every X here / Only this line" choice | `kkb-editor-open-375` |
| B4 | Touch targets under 44 px (all ≥24 px except radios, so WCAG 2.5.8 AA mostly met): order title button 105×25 on every host shot (also misaligned against the 44 px Back/bell, the only geometry finding); dish input 36 px high; "Name this order" 141×25; price-editor radios 16×16 (check their label hit area); inline footer links 19–20 px (inline, exempt) | `*.json` per shot |
| B5 | Large order (62 entries, 20 names, 2 rounds): Order tab 7,086 px tall at 375; People 2,923; Rounds 927 | `large-*` |
| B6 | Creating state "Starting your order…"; errors "Something went wrong on our side." / "No connection…" with Try again | `start-*` |
| B7 | Guest dock: "Share · no prices yet" → "Share ₱325"; "so far" not visible under 430 | `order-guest-dock-my-share-375` |
| B8 | Axe: `ux-review.spec.ts` (landing + guide) 10/10 pass; it doesn't cover order screens (v1.3 phase 7 axe: 0 violations across 16 checks) | run log |

## 3. Feature → existing component map

| Feature | Reuse | Missing |
|---|---|---|
| F01 | `priceCompleteness`, `setSharedPrice`/`setEntrySettlement`, `PriceEditor` semantics, `useDirectSave` + `useRetryOnReconnect`, `TablePrice` | Order-screen price status, multi-row quick-entry sheet, draft persistence, full "so far" label |
| F02/F03 | `allocate` (largest remainder), `AmountEditor`, `parsePeso`, `ReceiptCheckBlock`, `SettlementView` | adjustments + allocations tables/API/UI, adjusted total, post-close editing |
| F04 | `updateServed`, `ServedSection canEdit`, `use-served-edits` | co-host flag, `can()` capability map, lock re-check, assign/revoke, serving precondition |
| F05 | `receiptTotal`, `reconcile` | receipts list and per-receipt reconcile |
| F06 | `billTo`, `payerOfBillTo`, payer picker | weighted split across payers |
| F07 | `Kkb` totals | payments ledger, derived balances |
| F08 | `readinessSummary`, `setReady`, People "for me", My share | one My order sheet |
| F09 | session lock, live role lookup | atomic transfer mutation, log, UI |
| F10 | per-session cookies, `JoinForm` | manifest `id`/`scope`, install/"open the app" guidance |
| F11 | `SummarySheet` KKB tab, `StatusStrip` | next-action strip |
| F12 | `runMutation`, queue, SSE, direct-save | lock re-check, serving precondition, persisted keys for creates |
| F13 | `kkbText`, `summaryText`, summary PNG | optional sections |
| F14 | `searchPreps`, `dish-picker` search, round/served collapse, `useRowFocusFallback` | Order search, People collapse |
| F15 | `LogoMark`, `app-icon.tsx`, `pwa-icon` route, `apple-icon.tsx`, `icon.svg` | new mark |
| F16 | rename PATCH, `OrderOptionsSheet`, `createRateLimiter`, zod | `sessions.menu_url/menu_label`, validator, View menu chip |
| F17 | `BotCheck`, `useReducedMotion`, tokens, keyframes | table animation, expiry/timeout states |

## 4. Database and API change plan (additive)

| Migration | Slice | Change |
|---|---|---|
| none | 1 (F01) | quick entry reuses `shared_prices` / `entry_settlements` |
| `0013` | 2 (F02/F03) | `adjustments` (kind, category, label, amount or basis points, method, nullable `receipt_id`, revision) + `adjustment_allocations` (manual amounts / selected participants only; computed shares never stored) |
| `0014` | 3 (F04) | co-host marker on `participants` (per D-decision), `served_counts` precondition is code-only |
| `0015` | 4 (F05/F06) | `receipts` (default main receipt read from `sessions.receipt_total_centavos`, no destructive backfill), split payers for shared dishes |
| `0016` | 5 (F07) | `payments` ledger; balances derived |
| `0017` | 6 (F09) | `host_transfers` log |
| `0018` | 8 (F16) | `sessions.menu_url`, `sessions.menu_label` |

All new tables cascade from `sessions`, get `*_same_session` triggers and non-negative/range CHECKs, and never touch frozen tables. Every new event type joins `NON_TICKET_EVENTS` (`settlement.ts:15`) or it makes the host's Confirm stale.

## 5. Implementation sequence
Brief order (§9 plus addendum), one PR per slice into `dev`. See the plan's Slices table.

## 6. Regression risks
1. Role read before the lock (`mutations.ts:53-57`): every mutation; fix once in `runMutation`.
2. `NON_TICKET_EVENTS` (`settlement.ts:15`): a missed billing event type silently breaks Confirm round.
3. One-host index (`schema.ts:90`): transfer must demote first.
4. `role === "HOST"` derivations (`people.ts:32,109`, `views.ts:83-86`, `summary.ts:69`): wrong after a transfer.
5. KKB invariants (`kkb.ts:229`): unpriced must stay `null`; add property tests before adjustments.
6. Snapshot identical for everyone: payments/adjustments become visible to all guests unless filtered.
7. Closed-order retention (7 days): post-close billing lives only that long.
8. `workspace.tsx` is 781 lines (800 cap): new UI goes in new components.
9. F17 touches `e2e/new-order.spec.ts` ("One moment") and the `startOrder` helpers that wait on `/new`.
10. Manifest `id`/`scope` changes may re-identify installed PWAs `[unverified]`.
