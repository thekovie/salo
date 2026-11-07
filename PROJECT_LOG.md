# Project log

Running record of decisions, issues, tests and deviations, one section per PR. Newest last.

## 2026-11-06 · Project start

- Brief v1.2 saved verbatim in `docs/brief.md`. Approved plan: milestones M0–M5 mapping to brief phases 0–5, one branch and PR each, merged only after typecheck, lint, tests, build and green CI, and the owner's go-ahead.
- Owner decisions: name **Salo** (from *salu-salo*); logo = top-down round table with a speech-bubble tail and three plates reading as a "typing…" indicator; visual direction **Order ticket**; public repo `thekovie/salo`; link previews must look presentable and say what the link is for.
- Design interview (impeccable): copy voice is plain English with light Taglish touches in empty and success states; landing = tool first plus a short how-it-works; waiter ticket must work both read aloud and shown to the waiter.

## M0 · Foundation (`feat/m0-foundation`)

**Built**
- Next.js 16 / React 19 / Tailwind 4 / TypeScript scaffold, modules ported from heron: CSP with per-request nonce, JSON logger with redaction, in-memory rate limiter, client-IP helper, singleton.
- PostgreSQL schema for every brief section 8 table plus `entry_claims`; migrations `0000_init` and `0001_integrity_triggers` (snapshot immutability, revision never decreases, confirmed-round entries frozen). Migrations run at startup; the app exits with a clear log line if it cannot start.
- `proxy.ts`: CSP for pages, Origin check (CSRF layer) for every non-GET API request. `X-Robots-Tag: noindex` on `/s`, `/j`, `/api`.
- Design world (PRODUCT.md, surface brief with the direction contract): thermal-paper and carbon-copy tokens for light and dark, Fredoka / Nunito Sans / DM Mono self-hosted with `next/font/local`, perforated ticket strip, rubber CONFIRMED stamp.
- Brand: SVG logo + wordmark, favicon, apple icon and PWA icons (including maskable) generated with `ImageResponse`, web manifest.
- Link previews: root metadata (title template, description, Open Graph, Twitter large card, theme colour), landing OG image 1200×630 (logo, tagline, sample ticket labelled "Sample order"), robots (landing only), sitemap.
- Landing page: start button, join-by-code form (forgiving input: lower case, spaces, I/L/O/U look-alikes), sample ticket, how it works.
- Dockerfile (multi-stage, non-root, health check), compose for local + CI, CI with a PostgreSQL service (migration drift check, audit, typecheck, lint, tests, build) and a Docker smoke job.

**Tests**: 24 (env, CSP, logger, rate limiter, client IP, database integrity rules against real PostgreSQL). Docker image built and smoke-tested locally: health 200, CSP nonce on pages, OG image 200.

**Decisions / deviations**
- Google-hosted fonts failed to fetch during the build; fonts are self-hosted from the OFL `@fontsource` files instead (no third-party request at build or run time). Woff copies in `assets/fonts` render link-preview images.
- Rate limiter stays in process memory (one app instance per brief 7.7); move to PostgreSQL only if the app ever runs more than one instance.
- Data-model deviations listed in `docs/data-model.md` (no stored `active_round_id`, `variant` text column, added `entry_claims`, `target_round_id`, `group_id`).
- The start button calls `POST /api/sessions`, which ships in M1.

**Open**: DESIGN.md is written from the built world after M1 ships the workspace (impeccable finish step).

**Merged** 2026-11-06 as PR #2 (PR #1 closed: GitGuardian flagged a throwaway CI database password; the work was squashed onto a fresh branch and local/CI PostgreSQL now uses password-less trust auth).

## M1 · Standalone ordering (`feat/m1-standalone-ordering`)

**Built**
- `POST /api/sessions` (host, host credential cookie, draft Round 1, rate limit), entry add/update/remove/restore, rename, `/sync` snapshot (repeatable read).
- `runMutation`: per-session row lock, idempotent replay, revision bump, durable event, `pg_notify`, all in one transaction.
- Conservative dish normalization and pure consolidation (preparation = dish + variant + instructions), ticket text for copying.
- Workspace: tomato header with rename and sync pill, consolidated ticket with per-source steppers, composer with suggestions and progressive details (for whom, size, instructions), toasts with Undo, failure box with Retry/Discard.
- Waiter preview with fluid large type, copy as text and screen wake lock.
- Landing "Pick up where you left off" from session cookies.
- DESIGN.md written from the built world.

**Tests**: 50 unit/integration (incl. 12 concurrent adds giving exact totals and one event per revision, stale-revision conflict, cross-session ids, guest ownership, idempotent retry) + 6 Playwright e2e (scenarios 1, 5, 6, 7, 8, 9, stranger 404, axe WCAG 2.2 AA on landing, workspace light/dark and waiter). CI gains an e2e job.

**Decisions / deviations**
- Restore endpoint added (`POST …/entries/:id/restore`) for Undo; not in brief section 10.
- A typed name ("Miguel") is stored as an INDIVIDUAL batch with `collective_label` when that person has not joined; guests' own entries default to themselves.
- The client refetches the full snapshot after each change (fine at ≤ 300 entries); SSE in M2 replaces manual refresh for other devices.
- Contrast fixes found by axe: tomato darkened to oklch(0.5 0.185 30) so white text passes 4.5:1; sync pill uses `bg-ink/20`; toast colours tokenised per theme.
- Dark mode now follows the system preference in CSS alone (the 404 render path skipped the theme script).
- Browser check note: the automation browser wiped its own cookie jar when the server restarted (a script-set cookie vanished too); not an app behaviour.

**Independent reviews (before PR)**
- Security review: no critical/high. Fixed: lifetime caps (1,000 entries ever, 300 dishes) and 120 changes/min per participant; revoked/expired credentials ignored on resume and identity; NUL refused at validation; body limit counts bytes; idempotency key bound to the mutation type; proxy matcher exclusions anchored. Documented: rate limits trust exactly one proxy hop.
- Code review: 1 high, 3 medium fixed by rewriting the client queue (`use-session.ts`): changes go one at a time in order (Undo can't overtake its removal), repeated stepper taps coalesce to the final number with the revision read at send time, steppers never unmount mid-tap, a committed change stays drawn until a snapshot containing it arrives (resync on online, focus and every 5 s while waiting), network failures retry automatically with backoff and the same key, refused changes are not drawn and are listed by name. Server: removing/restoring into the same state is a no-op, restore re-checks the entry cap. "Show waiter" is unfocusable at zero items.
- Tests after fixes: 57 unit/integration, 7 e2e (adds rapid-tap test).

**Merged** 2026-11-06 as PR #3.

## M2 · Collaboration (`feat/m2-collaboration`)

**Built**
- Guest joining: `/j/:code` invite page (forgiving code input from the landing page), name only, GUEST credential cookie, `participant.joined` event; 30 people per order; joins rate limited 30/hour per address; the join endpoint requires the session id to match the code.
- Invite sheet in the header: QR (client-generated data URL), large code, system share with a self-explaining message, copy link.
- Invite link preview: server-rendered metadata and OG card ("Join the order at <name>", "Tap to add your dishes…", "Add your order"; "This order has ended" when closed). Never dishes or names; preview fetches cannot join (POST only); noindex.
- SSE `GET /api/sessions/:id/events`: one LISTEN per process fanning out, replay from the durable log with `Last-Event-ID` / `?after=`, `resync` when history is missing or longer than 200, 20 s heartbeat, cleanup on abort, caps 500 streams / 4 per participant.
- Client: EventSource with coalesced snapshot refresh, refresh after reconnect, restart after an outright refusal, "Reconnecting…" pill state. Guests' composer defaults to "Me".

**Tests**: 67 unit/integration (join rules, duplicate names, table cap, invite preview fields, replay order, gap/empty/too-long resync, stream delivering commits to two subscribers) + 11 e2e (adds two-browser QR/code collaboration with live consolidation, offline recovery in both directions, invite preview leaking nothing, unknown code/stranger stream 404).

**Decisions / deviations**
- The join code doubles as the invitation credential (brief: "optional short join code"); no separate invite token. Codes are rate limited and the preview reveals only name, status and round.
- Join endpoint is `POST /api/sessions/:id/join` with the code in the body (brief path kept).
- Fixed during testing: replay returned "nothing new" when a session's whole history was missing; it now asks for a resync.
- Header round label shortened to "Round n · Open" so the Invite button fits at 390 px.

**Independent reviews (before PR)**
- Security: 1 high fixed: invite lookups (page, metadata, OG image) were an unthrottled code-guessing oracle; now 40 misses/hour per address, unknown and ended orders both 404. Mediums fixed: per-address stream cap (12) and 15-minute stream lifetime (reconnect re-authorises); OG image for unknown codes is a cached static card and fonts load once. Lows fixed: join keeps an existing identity instead of overwriting the cookie; a stream whose client left during setup is cleaned up.
- Code review: approve with 3 mediums, all fixed: Web Share detection no longer causes a hydration mismatch; the heartbeat re-reads the event log so a failed read heals; failed snapshot fetches retry. Lows fixed: stream restart backs off to 60 s; hub reserves slots before awaiting LISTEN; QR drawn on first open; copy success announced; code read out letter by letter.
- Left as known limitation: if a join's response is lost, retrying creates a second guest with the same name (cookie never arrived); low impact, revisit with claims in M3.

**Merged** 2026-11-06 as PR #4.

## M3 · Groups and hybrid ordering (`feat/m3-groups-hybrid`)

**Built**
- Views: Order · People · Groups tabs (WAI-ARIA tabs). Pure projections in `src/lib/views.ts` (by person incl. typed names / whole table / not assigned; by group label; likely duplicates; readiness summary).
- Collective groups: optional members per label (`order_groups.normalized_label`, migration 0002), members dialog; nothing assumes who gets which dish.
- Claims: guests mark host-recorded dishes (for them by name, or for nobody) as theirs; host approves or declines from a banner; approval moves owner and "for" to the guest; one pending claim per guest and dish.
- Duplicate hint: host-recorded dish for a guest by name + the guest's own identical preparation; "Remove your copy" with Undo.
- Readiness per round: guest toggle, host summary; reset in the same transaction when that guest changes their own entries.

**Tests**: 76 unit/integration + 13 e2e (scenario 3 groups with members across two browsers, scenario 4 claim + approve + duplicate hint + readiness reset, axe on People/Groups for host and guest).

**Decisions / deviations**
- Groups are matched to orders by normalized label instead of a required `group_id`; a group with members exists only when someone adds members.
- Any participant may name a group's members (low risk, optional metadata); claims and approvals follow brief 4.
- Found by e2e: the members dialog's label id contained spaces (no accessible name); fixed with generated ids. Guest bottom bar no longer wraps at 390 px; empty host card hidden in People.

**Independent reviews (before PR)**
- Security: no critical/high. Fixed: 30 groups per order; group members changed only by the host or the group's creator; approving a claim on a removed dish or a dish now marked for someone else is refused (`ENTRY_REMOVED`, `CLAIM_STALE`).
- Code review: no high; mediums fixed: People/Groups keep pending edits visible (only unsaved adds are claim-disabled); "That's mine" appears only on dishes the host added; readiness resets for the actor, the dish owner and whoever the dish is for (and on claim approval); new indexes for pending claims and readiness by round (migration 0003). Lows fixed: double-order hint requires the guest's own dish to be for themselves; Groups tab count matches the view; tabs support Home/End and point aria-controls only at the shown panel.
- Tests after fixes: 79 unit/integration, 13 e2e.

**Merged** 2026-11-06 as PR #5.

## M4 · Review, confirmation and rounds (`feat/m4-rounds`)

**Built**
- `confirmRound` (host only, `expectedRevision` must equal the session revision, immutable `confirmed_round_snapshots` JSON with dishes, preparations, corrections and total; entries frozen by the existing trigger; pending claims on the round closed), `openRound`, `recordCorrection` / `removeCorrection` (corrections reference a confirmed source entry and ride on the open round), `closeSession` (read-only, expires 7 days after closing).
- Pure ticket helpers (`src/lib/ticket.ts`): correction wording for the waiter, snapshot builder, live ticket for the open round, plain-text ticket.
- UI: in-place Review panel (checks + ticket) and Waiter panel (big ticket, copy, wake lock, confirm) so queued changes are never lost by navigating; one confirm dialog; the stamp animation; Rounds tab with carbon-copy colours, corrections dialog, End order dialog; ended-order banner; host "Review order" / guest "Ticket" in the bottom bar.

**Tests**: 85 unit/integration + 15 e2e (scenarios 9, 10, 11, 13 in one two-browser journey with axe on review, waiter and the ended view; stale-revision confirmation refused).

**Decisions / deviations**
- Review and waiter views moved from a separate page into the workspace (in place). `/s/:id/waiter` stays as a direct, read-only link.
- Corrections attach to the largest source entry of a preparation; cancelling is limited to that entry's quantity.
- Confirmation asks once (brief 6.8: destructive and irreversible), routine edits still never prompt.
- Found visually: the stamp covered counts; it now sits in the ticket's header row.

**Independent reviews (before PR)**
- Security: no critical/high. Fixed: cancellations add up per dish and can never exceed what was ordered; 30 rounds and 100 corrections per order; new database guards (migration 0004): confirmed rounds cannot be reopened, snapshots / confirmed entries / corrections already given to the waiter cannot be deleted or changed. Left as known: an idempotency key reused by the same host for a different target returns the earlier result (self-only).
- Found by the new guard test: deleting a session with a confirmed round failed because the cascade clears `confirmed_by` on the snapshot and the immutability trigger refused it; retention cleanup would never have removed confirmed orders. Cascaded changes now pass; direct ones are still refused.
- Code review: no high; mediums fixed: a refused confirmation (e.g. order changed meanwhile) now says why in a toast and does not block the Confirm button; Review and Waiter panels are native modal dialogs (focus moves in and back, background inert, Escape closes, one main landmark); panels close if their round changes on another device. Lows fixed: stamp ends at the same angle animated or not and plays once; corrections-only rounds say "n corrections"; guests can open the full ticket of a confirmed round; correction dialog shows what is left and its real per-correction limit.
- Tests after fixes: 86 unit/integration, 15 e2e.

**Merged** 2026-11-06 as PR #6.

## M5 · Production hardening (`feat/m5-hardening`)

**Built**
- Retention: hourly in-process job deletes sessions past `expires_at` (closed + 7 d, or last activity + 30 d) with everything in them; scenario 14 e2e (links, invite and resume all gone).
- Proxy streaming: `compose.yaml` profile `proxy` (Traefik v3, as on Coolify) + `scripts/sse-proxy-check.mjs`; new CI job. Local result: 75 ms event latency through Traefik, 3 heartbeats over 75 s idle, Last-Event-ID replay OK.
- Backups: `docs/backups.md` (Coolify schedule, S3 off-VPS, retention, alerts, restore steps) and `scripts/backup-restore-drill.sh` (dump → scratch restore → identical row counts → constraints present). Local drill PASS.
- Load and concurrency: 20 people adding at once give exact totals; 100 entries / 20 people measured locally (add 21 ms avg, reload 120 ms, dish visible 63 ms, saved 97 ms) — local numbers, not production benchmarks.
- Accessibility: keyboard-only e2e (add with Enter and focus return, steppers, tabs with arrows/Home/End, dialogs with Enter/Escape and focus return); axe scans across every screen in light and dark.
- Docs: full Coolify deployment and operations guide, backups, measurements in testing.md.
- Design finish: impeccable detector 0 findings; finish review (see below); dishes already on the ticket no longer flash on load; header band token (quiet deep red in dark); ink/cream focus ring; people/groups cards and review checks as ticket strips; `e2e/capture.spec.ts` (CAPTURE=1) re-shoots every screen for design review.

**Fixed along the way**: Playwright helper matched "Details" case-sensitively; an axe scan could catch a toast mid-animation (reduced motion set from the start).

**Finish review (impeccable finish reviewer)**: first two passes asked for recaptures (stale or malformed screenshots; `e2e/capture.spec.ts` now captures every screen at 390×844 @3×). The recapture surfaced a real defect: after End order the header still said "Round 3 · Open" and the bottom bar stayed; fixed ("Order ended", no bar, "Never confirmed with the waiter" on the unsent round). Verdict "fix first" with six fixes, all applied: confirm button now "Mark confirmed with waiter"; Review order is outline so Add is the only tomato button; corrections print once with Remove on the line; no "Round" label above the join heading (page and preview image); ended notice as plain text; flat underlined tabs instead of a segmented control. Kept as the reviewer asked: tomato mono counts on dashed strips, white/canary/pink rounds, stamp in the header row, quiet deep-red dark header, Taglish only in empty/success states.

**Tests at the end of M5**: 89 unit/integration, 18 e2e (+1 capture spec, opt-in), proxy check, backup drill.

**Deviations recorded**: confirm button label adds a verb to the brief's "Confirmed with waiter" so it is not mistaken for a status.

**Merged** 2026-11-06 as PR #7 (and #8 docs).

## UI/UX audit fixes (`feat/ux-audit-fixes`)

Owner asked for a full UI/UX and motion audit (design review only). Verdict: the direction fits and is product-specific; feedback at high-stakes moments and motion were thin. Heuristics: status visibility 2, error recovery 2, real-world match 4, error prevention 4, others 3. This PR fixes the eight UX issues; motion follows in its own PR.

1. Confirm dialog stays open with "Confirming…" and shows refusals inline; closes and stamps only on success; "Kain na!" toast follows the stamp.
2. Saffron wash replays whenever a dish gets another entry (own or live), not only for new dishes; own adds scroll into view above the composer.
3. Failed changes: Discard always, Retry when a second try can help.
4. "Ordered for": four options per role; chips and suggestions 44 px.
5. Waiter screen: the host's confirm is an outline button under the ticket, not a fixed red bar over it.
6. Guest People: host-added dishes under the guest's own name fold into the guest's card.
7. Invite page: top-aligned, "Live · n people · n items so far"; one-time "You're in!" tip after joining.
8. Confirm, invite, members and correction dialogs are ticket strips; review heading sits under Back.

Tests: 89 unit/integration, 18 e2e (join helper asserts the live line and the tip; claim test uses the merged card).

## Motion system (`feat/motion`, stacked on the UX fixes)

From the same audit's motion review (only three moments animated before). Added motion tokens; `Ticker` for every count; wash on re-add and live arrivals (kept under reduced motion as information); View Transitions for remove/Undo; confirm sequence (sheet rise → stamp at +280 ms → thunk → Android buzz → toast); sheets and dialogs enter/exit with `@starting-style` and `allow-discrete`; toasts fade out; sync pill waits 400 ms before "Saving…"; consistent press feedback. No new dependencies. Tests: e2e `motion.spec.ts` pins tick direction, wash duration under reduced motion and the stamp delay; tests now wait on the pill's real state (`data-sync`). 89 unit + 19 e2e, three consecutive green runs.

**Merged** 2026-11-06: PR #9 (UX fixes), PR #11 (motion; replaces #10, closed when its base branch was deleted).

## Bottom drawers (`feat/drawers`)

Owner asked whether shadcn would improve the UI; answer: not wholesale (the app already has accessible primitives and its own look), but a swipe-to-dismiss bottom drawer helps one-handed use. Added `vaul` (what shadcn's Drawer wraps) as `src/components/ui/drawer.tsx`, styled as a ticket torn off the pad, and moved the invite sheet and the correction sheet onto it. Found: vaul leaves focus on the trigger unless `autoFocus` is set; our Drawer turns it on (keyboard test now checks focus moves inside). Also fixed a test that measured contrast in the same frame as a theme switch. 89 unit + 19 e2e, two consecutive green runs.

## Order options, cancel, link previews (`feat/order-options`)

Owner feedback: no way to call off an order; renaming inline in the header was cramped on phones; the "Ordered for" panel needed an X; link previews did not show for room links or invite codes.

- **Header**: name gets the width; the sync status sits under it (calm "Saved" shrinks to a check, still read out; problems keep their words); host gets an "Order options" button (tapping the name opens it too).
- **Order options drawer** (host): full-width name field; **Cancel order** (no round confirmed yet) or **End order**, behind an in-drawer confirm step. "End order" moved here from the Rounds tab. A cancelled order is read-only, says "This order was cancelled. Nothing was sent to the waiter", and is deleted after 1 day (`CANCELLED_RETENTION_DAYS`) instead of 7. No migration: cancelled = closed with no confirmed round.
- **Composer**: the details panel has a Close (X) button.
- **Link previews, root causes**: (1) `robots.txt` disallowed `/j/` and `/s/`, and preview crawlers that honour robots.txt (Facebook/Messenger, X, Slack…) skipped both the page and its OG image; now only `/api/` is disallowed and `noindex` (meta + X-Robots-Tag) keeps them out of search. (2) Room links `/s/<id>` returned 404 to anyone without the cookie, crawlers included; now a non-member opening an open order's room link is redirected to its invite `/j/<code>` (the room id is a random UUID, stronger than the join code it leads to). Ended/unknown ids still 404. Note: previews also need a public `APP_URL` (og:image is absolute); localhost/LAN links never preview.

Tests: 89 unit/integration, 20 e2e (new: cancel flow; robots + room-link redirect in the preview test; stranger test updated).

## Ordering experience, guest removal, live pills (`feat/order-experience`)

Owner feedback: times were not local; the host's ordering was awkward (defaulted to "Anyone", recipient hidden, names retyped); the dish field was too small; wanted another UI/UX audit of the ordering flow (ui-ux-pro-max guidance), a way for the host to remove guests with a reason, and small live "added" notifications.

**Audit findings (ordering flow)**: A1 dish input ~80 px with a placeholder-only label (high); A2 recipient hidden behind Details (high); A3 host default "Anyone" (high); A4 retyping people/groups already in the order (high); A5 times in the server's zone (high); A6 bottom dock heavy with the keyboard open (medium); A7 frequent "who" mixed with rare size/notes (medium).

**Changes**
- `LocalTime` client component (device time zone, renders after hydration): resume list ("Today 7:42 PM" / "Yesterday" / weekday), "Confirmed h:mm", "deleted on …".
- Composer in two rows: full-width labelled Dish field; **For <name> ▾** · stepper · Add. *Who's it for?* chips from the order (Me default for everyone, other people, typed names, groups, Whole table, Anyone, + Someone else, + New group); size/notes one step in. Picking a person sends `participantId` (no server change).
- Host removes a guest (People tab): migration `0005_participant_removal` (`removed_at`, `removed_reason`, CHECK guest-only and ≤140). Their own open-round entries are soft-deleted, claims rejected, readiness and memberships cleared; event carries the id only. Removed actors resolve to nobody; session routes answer `403 REMOVED`; their page shows the reason and Join again; their live stream ends. Undo restores them and those entries. Rejoining creates a new guest. People cap counts active people only.
- Live pills: someone else's new dishes (detected by diffing snapshots on the client) show as a saffron pill under the header and a "+n · name" tag on the row; quiet on load/resync; reduced motion fades only.
- `NEW_ORDERS_PER_HOUR` env (default 20) so the e2e suite can start more orders than the production limit allows.

Tests: 95 unit/integration (new: removal, arrivals, relative time), 24 e2e (new: host default Me + one-tap guest, live pill, remove with reason + rejoin + Undo, device time zone), two consecutive green runs.

**Security review (PR #14)**, fixed in the same PR:
- HIGH: per-address limiters could be evicted by rotating 2,000+ addresses (an IPv6 /48 is enough). Added all-addresses ceilings (`createTieredLimiter`) for new orders (15×), joins (600/h) and wrong invite codes (2,000/h).
- MEDIUM:
  - A change sent just before a removal could land after it: `runMutation` re-checks removal under the session lock.
  - Dishes or group members could point at a removed guest: lookups now skip removed people.
  - Preview cards and app icons are memoized per process.
  - `/sync` is limited to 120/min per participant.
  - Deployment note for the CDN case.
- LOW:
  - The heartbeat ends a removed guest's stream even if a resync skipped the event.
  - Idempotency types include the target guest.
  - The reload-on-REMOVED runs once per page view.

Left as accepted: guests may attribute dishes to other people in the order (by design: ordering for a friend); host-written reasons are plain text; a large table behind one carrier-grade NAT shares the 30 joins/hour.

## Who ordered what (`feat/order-summary`)

Owner asked for a prompt at the end of an order to copy every order as text or save it as an image, to track who ordered what for paying later. Owner chose: items only (no prices), offered at the end and anytime.

- `src/lib/summary.ts` (pure) builds the summary from confirmed rounds only, applying corrections: cancellations lower counts, a swap reads "A → B", and an unconfirmed round is noted and left out. Order: people (host labelled), groups (with members, or "members not set"), whole table, unassigned. Removed guests show "(left)". `summaryText` gives the group-chat text.
- `GET /api/sessions/:id/summary`: a PNG drawn with the link-preview renderer's fonts and colours. Members only, under the snapshot read limit, height capped at 8000 px (`413` beyond, use the text), `private, no-store`. The date label comes from the device.
- `SummarySheet` (vaul drawer): preview, then Copy text, Save image (share sheet with the file on phones, download elsewhere), and Share text.
- Opens for the host after End order; a button on the ended banner for everyone; on the People tab once a round is confirmed.

Tests: 100 unit/integration (new: summary with corrections, groups, table, removed guest, unconfirmed round); 25 e2e (new: end, then summary, copy text checked on the clipboard, PNG download, guest access, strangers get 404).

## Landing scenes and first-time tour (`feat/landing-onboarding`)

Owner deployed the app, then asked for a landing page that shows what Salo does with visuals, plus an onboarding helper ("want to know how to use the app?"). Choices: animated coded scenes (not screenshots); a first-time offer plus a guided spotlight tour, with host and guest versions.

- **Landing**:
  - `HeroScene` replaces the static sample ticket: a looping round that fills, merges, totals and gets stamped.
  - "How it works" has four rows, each with a scene that plays once in view (invite, add, waiter ticket, who ordered what).
  - A "Why Salo" strip, a closing CTA, and a footer link.
  - `useScene` drives the steps; reduced motion shows the final frame.
  - No images and no new dependencies.
- **Tour**:
  - `TourOffer` appears once per browser and role, waits out the guest's "You're in!" tip, and is stored in localStorage (no offer if storage is blocked).
  - `Tour` is a custom spotlight (fixed frame with a huge shadow, a card that flips above or below), with Back/Next/Skip/Done, arrows and Escape, a focus trap and focus return. It skips controls that aren't on screen.
  - Replay: host from Order options → How Salo works, guest from the ? in the header.
- **Bug found while building**: inline timeline arrays restarted every scene on each render. `useScene` now keys on the durations.
- **Tests**: e2e storageState seeds the tour flags so the offer never shifts other specs. `onboarding.spec.ts` covers the host tour (5 steps, reload, replay, keyboard), the guest tour (Not now, ? replay) and the landing steps. 28 e2e total; unit tests unchanged.


**Playwright UI/UX pass (owner asked before merging).** `UX_REVIEW=1 pnpm e2e e2e/ux-review.spec.ts` (opt-in, writes screenshots and a report to `.impeccable/review/ux`).
- Landing: phone 390, small 320 and desktop 1280, light and dark, plus reduced motion.
- Every tour step, host (light, dark, 320) and guest.
- 121 automated checks: no horizontal scroll; axe WCAG 2.2 AA (landing, offer, tour open); tour card inside the viewport and never over its spotlight; spotlight on screen; card buttons ≥ 44 px; focus on Next/Done.

Fixed from the screenshots:
1. The hero's first frame had empty gaps where later lines would appear. Rows now open with a grid-rows collapse, and an invisible full copy holds the final height, so the spare room sits at the bottom.
2. At 320 px the composer's For button showed only "For". Under 360 px the word "For" hides and Add becomes an icon-only 44 px button (still named "Add").
3. Spotlights on edge controls (⋯, Invite) had their frame cut off; the frame is now clamped inside the viewport.

## Link previews, PostHog, privacy and cookie policies (`feat/analytics-previews`)

**Messenger preview.** I diagnosed it live on salo.thekovie.com with one throwaway order (cancelled, deleted within a day). Fetched as Facebook, Facebot, meta-externalagent, Viber, WhatsApp and Telegram, the invite page returns 200 with every tag in `<head>`, an absolute https `og:image` that returns 200 PNG in 0.7 s, and room links 307 to the invite. Nothing sits in front of the VPS. Conclusion: Messenger is showing a cached failure, so the fix is the Sharing Debugger's Scrape Again (documented in HANDOFF). Hardening added anyway: `og:url` on invites, and `htmlLimitedBots` extended to chat-app crawlers (Viber, Telegram, Facebot, meta-externalagent, Pinterest, Embedly, Signal…) so Next never streams their metadata into the body.

**PostHog (US cloud).**
- `posthog-js`, loaded after paint by `PostHogProvider`, only when `POSTHOG_KEY` is set. Proxied through `/ingest` (Next rewrites); the CSP gains `worker-src 'self' blob:`.
- On by default; session replay on every session, with inputs and anything inside `data-ph-mask` masked; autocapture `mask_all_text`; DNT respected; anonymous people.
- Typed product events in `src/lib/analytics.ts`: start/join, dish added (recipient kind, quantity, notes), recipient panel, invite, review/waiter, confirm/refused, end/cancel, guest removed/restored, summary, tour, sync problems.
- Checked locally with a dummy key: scripts load through `/ingest` and there are no CSP violations. Replay itself needs the real key plus replay switched on in the project.

**Policies.**
- `/privacy`: plain-language and true to the build. It covers order data, the order cookie, IPs in memory, logs, PostHog with masked replays, purposes, retention, processors, rights under the Philippine Data Privacy Act, and how to reach salo@projects.thekovie.com.
- `/cookies`: a table of every cookie and storage key, plus an "Analytics on this device" switch (PostHog opt-out).
- Links in the landing, invite, 404 and order-options footers; both pages are in the sitemap.
- axe found the cookie table's sideways scroll unreachable by keyboard; it is now a focusable labelled region.

Tests: 104 unit/integration (new: analytics no-op and safety, POSTHOG_KEY schema, CSP worker-src); 29 e2e (new `policies.spec.ts`).

**Messenger follow-up (2026-11-06).** After the redeploy the Sharing Debugger still reported *403, "could be due to a robots.txt block"* for `/j/<code>`.
- Ruled out:
  - Every crawler user agent and Facebook-style request (HTTP/1.1, byte range, no SNI) gets 200.
  - A datacenter fetch gets 200, and opengraph.xyz renders all platforms.
  - DNS is consistent (Cloudflare, DNS-only, no IPv6 record), and the TLS chain is valid.
  - The proxy labels contain no IP or bot rules.
- Cause: Facebook's cached copy of the old robots.txt (`Disallow: /j/`, removed in PR #13 the same day). Facebook reports a robots block as 403 without fetching the page.
- Resolution: wait for Facebook to re-read robots.txt, then Scrape Again. Documented in `docs/deployment.md` → Link previews. No code change.


## PRD review fixes, part A: sync reliability (`fix/sync-reliability`)

An external review of `11019b2` against PRD v1.2 listed candidate gaps. Each was verified on `main` first; this PR fixes the confirmed client-sync ones.
- **Round identity (reproduced).**
  - Adds now carry the round the person was adding to.
  - The server refuses with `409 ROUND_CLOSED` when that round was confirmed meanwhile, instead of slipping the dish into the next round.
  - The failed list offers "Add to round N" as an explicit choice.
- **Strict order (reproduced).** The pump skipped items waiting for the network, so Undo could overtake its removal. The queue rules now live in `src/lib/queue.ts`: the first unfinished change holds the line; refused ones don't block; repeated taps also fold into a waiting update; Retry keeps the change in its place.
- **Reload recovery (reproduced).** Unsent and refused changes are saved with their idempotency keys in `localStorage` (`salo:queue:<order>`) and restored on load, so nothing is lost and nothing is applied twice.
- **Silent overwrite (partly reproduced).** A quantity change sent the latest revision with an old absolute quantity. It now sends the revision the person saw, moved forward only over this device's own committed changes, so a change made elsewhere comes back as "Changed elsewhere".
- **Connection pill (owner request).** A pill under the header:
  - "You're offline. Changes are kept on this phone…", with how many changes are waiting;
  - "Reconnecting…" after 4 s without live updates;
  - "Back online · all changes sent".
- **Also:** the e2e server forces `POSTHOG_KEY` empty, so tests never send analytics from a developer's `.env`.

Tests:
- Unit: queue rules (strict order, refused not blocking, coalescing, revision choice, store and restore) and connection messages.
- Integration: stale vs current round on add.
- e2e (`offline.spec.ts`): the pill and its waiting count, reload keeps an unsent dish and sends it once, an offline add across a round boundary offers "Add to round 2".
- Totals: 112 unit/integration, 32 e2e.

## PRD review fixes, part B: server hardening (`fix/server-hardening`)

- **Shared Wi-Fi (reproduced).** The per-address live-stream cap goes from 12 to 64, so a whole restaurant fits behind one public address. A phone turned away, or with its stream down, polls `/sync` every 10 s.
- **Idempotency (reproduced).**
  - Mutation types now include their target (`entry.update:<id>`, `entry.remove:<id>`, `entry.restore:<id>`, `claim.approve/reject:<id>`, `round.confirm:<id>`, `correction.remove:<id>`), so one key can't replay onto a different target (422).
  - Starting and joining accept an `Idempotency-Key` and remember the outcome for 10 minutes (in process memory, single instance). A retry after a lost response gets the same order or guest, and the same cookie.
- **Body limit (reproduced).** `readCapped` streams the body and stops at 8 KB, with or without a Content-Length.
- **Expired orders (reproduced).** An order past `expires_at` is gone before the hourly cleanup: no credential resolves, the invite is unknown, joining is refused, and changes get 404, so it can't be revived.
- **Database integrity (partly reproduced), migration `0006_integrity_v2`.**
  - Entries can't move out of a confirmed round.
  - An entry must sit in its batch's round, in the same session.
  - Batches of a confirmed round keep their attribution and submitter frozen, and their round must be in their session.
  - Claims and group members stay inside one session.
  - Whole-order deletion still cascades.
- **Restore drill (reproduced).** It now covers all 15 tables, plus five self-contained rule probes that must be refused. A vacuous pass is no longer possible.
- **robots.txt** names `facebookexternalhit`, `Facebot` and `meta-externalagent` explicitly, as Meta's debugger asks.

Tests:
- New: chunked 9 KB body gets 413; key reuse on another target gets 422; the replay store remembers then expires; an expired order can't be read, joined or changed and isn't revived; 25 streams from one address; the 0006 rules (move, attribution, same session, cascade).
- Drill passes locally.
- Totals: 121 unit/integration, 32 e2e.

## PRD review fixes, part C: draft editing, claims, keyboard, docs (`feat/draft-editing`)

- **Draft editing (reproduced).**
  - "Edit dish" drawer from a pencil on each editable draft line: size or variant, instructions, and who it's for, with the same chips as the composer. The host can edit any dish; a guest their own.
  - Server: `PATCH …/entries/:id` accepts `attribution`, which updates the batch and resets readiness for the old and new person; it is refused once the round is confirmed (also enforced by trigger 0006).
  - The dish itself stays a remove-and-add.
- **Undo (reproduced).** Quantity changes ("Gyoza ×3 → ×2 · Undo") and edits ("Updated … · Undo") get Undo toasts. Undo goes through the same ordered, conflict-safe queue.
- **Claims (partly reproduced).** A host-added dish on the guest's own card now offers "That's mine"; the server already allowed it.
- **Radio keyboard (reproduced).** `useRovingRadio`: one Tab stop, arrow keys and Home/End move and select. Used by the shared `RecipientPicker` (composer and edit drawer) and the correction "What changed?" group, which also gets a label and 44 px targets.
- **Docs.**
  - architecture (SSE shipped, analytics, cleanup, queue), data-model (removal, 0006, expiry);
  - API (new error codes, idempotency scope, `roundId`, edit fields, pages and `/ingest`), realtime (cap 64, polling, CI proxy check);
  - README; HANDOFF (env vars, the 1-day cancellation recorded as an owner decision, known limitations refreshed).
- **Owner decision recorded:** cancelled orders are kept 1 day, deliberately not the PRD's 7.

Tests:
- Integration: edit attribution, size and notes; submitter unchanged; refused after confirm.
- e2e (`editing.spec.ts`): edit drawer, quantity Undo, claim on the guest's own card, keyboard chips.
- The UX review pass is clean (121 checks).
- Totals: 122 unit/integration, 34 e2e.

## Messenger preview, root cause (`fix/messenger-noindex`)

Submitting robots.txt to the Sharing Debugger didn't help. The owner then scraped `/privacy` (no noindex), which got 200, while a fresh invite still got 403. Meta's debugger was reading the invite's `noindex, nofollow` (header and meta tag) as a robots block.
- Fix: invite and order pages skip noindex for Meta's crawlers only (`src/lib/crawlers.ts`, plus a `missing` user-agent condition on the `X-Robots-Tag` rule in `next.config.ts`). Search engines and everyone else still get noindex.
- Tests: `isMetaCrawler` unit test; e2e checks that the Facebook user agent gets no robots header or tag while Googlebot gets `noindex, nofollow`.

