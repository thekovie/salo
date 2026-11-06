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
