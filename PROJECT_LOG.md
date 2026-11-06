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
