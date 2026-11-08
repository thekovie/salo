# Handoff

Read this first when resuming. Specification: `docs/brief.md`. Decisions per PR: `PROJECT_LOG.md`. Design: `PRODUCT.md`, `DESIGN.md`, `.impeccable/surfaces/src-app.md`.

## Status

| Milestone | Brief phase | State |
|---|---|---|
| M0 Foundation | 0 | Merged (PR #2) |
| M1 Standalone ordering | 1 | Merged (PR #3) |
| M2 Collaboration (QR, SSE) | 2 | Merged (PR #4) |
| M3 Groups & hybrid | 3 | Merged (PR #5) |
| M4 Review, confirm, rounds | 4 | Merged (PR #6) |
| M5 Hardening | 5 | Merged (PR #7) |

After M5 (owner feedback), all merged:

| PR | What |
|---|---|
| #9, #11, #12 | UI/UX audit fixes, motion system, bottom drawers |
| #13 | Order options (rename, cancel, end), roomier header, link-preview fixes |
| #14 | Local times, two-row composer with "who's it for" chips, host removes guests (with reason), live "added" pills, security-review fixes |
| #15 | "Who ordered what" summary: copy as text or save as an image |
| #16 | Landing page scenes, first-time guided tour, Playwright UX pass |
| #18–#25 | PostHog analytics with masked replay, privacy/cookie policies, sync reliability (strict queue, poll fallback), server hardening, draft editing with Undo, invites at `/i/<code>` with working link previews |
| #26–#30 | Turnstile bot check before starting an order, findable "End the order" (What's next?), a way out of every screen, density pass, proxy check joins a browser-started order |
| #31 | **KKB**: optional prices per dish, each person's food subtotal, one receipt service charge split by food (largest remainder, exact), host Bill to for shared dishes, priced replacements; host name; **setup guide** (full-screen wizard with animated steps, Try it, checklist) replacing the spotlight tour; landing "Settle up" scene with prices |
| #32 | Host is asked for their name as soon as the order opens ("What should the table call you?") |

All 14 brief end-to-end scenarios are covered by Playwright (see `docs/testing.md`).

## Deployment

- **Deployed on Coolify by the owner on 2026-11-06**; redeploy from `main` (at `6423a0b`, PR #32) to get everything above.
- Database migrations run when the app starts. The latest is `0007_settlement` (PR #31: `entry_settlements`, `correction_settlements`, `sessions.service_charge_*`; backward compatible, old orders load with no prices). Check the first start after deploying it logs no migration error.
- Environment: `APP_URL` must be the real https domain (invite links, QR codes, link previews and the CSRF origin check depend on it). Optional: `NEW_ORDERS_PER_HOUR` (default 20; leave it in production), `CLOSED_RETENTION_DAYS` (default 7), `INACTIVE_RETENTION_DAYS` (default 30), `POSTHOG_KEY` (analytics on when set). A cancelled order (ended before anything was confirmed) is deleted after **1 day**: an owner decision, recorded 2026-11-07, that deliberately differs from the PRD's 7 days, since nothing was ordered. See `docs/deployment.md`.
- After each deploy, a quick smoke check:
  - `/api/health` returns 200;
  - start an order on a phone, and join it from a second phone by QR;
  - the host sees "What should the table call you?" right after starting; save a name;
  - add a dish with a price (Size, notes or price), confirm a round, open Who ordered what → KKB, enter a service charge, and check the guest's phone shows their share;
  - end the order, and check that "Who ordered what" opens.

## Working rules

- One branch per change, PR into `main`, merge only after typecheck, lint, tests, build and CI pass and the owner says go.
- Conventional commits; no co-author or tool attribution anywhere.
- Independent code and security review before merging auth, mutation and real-time work.
- Public repository: never commit secrets or random-looking secret literals in tests (build them at runtime). Local/CI PostgreSQL uses trust auth for that reason.
- Design: follow `DESIGN.md` and the direction contract; light and dark, WCAG 2.2 AA, no sidebar, light type weights. Re-shoot screens with `CAPTURE=1 pnpm e2e e2e/capture.spec.ts`.

## Owner tasks (cannot be done from the repository)

1. ~~**Deploy** on Coolify~~: done 2026-11-06. Keep `APP_URL` set to the real https domain.
2. **Backups** (owner: next session): daily schedule, S3 off-VPS destination, retention, failure alerts on the PostgreSQL resource (`docs/backups.md`); run the first production restore drill and note the date here.
3. **Proxy check in production** (live updates look fine in use, script not run yet): start an order on your phone, then `SALO_ORDER=<order link> SALO_CODE=<join code> node scripts/sse-proxy-check.mjs https://salo.thekovie.com 75` (the bot check blocks the script from creating its own order; it joins yours as "Proxy check" and removes its test dishes).
4. **Real phones** (Android done 2026-11-08; iPhone and screen reader spot check still open): try a full order on Android and iPhone over mobile data (QR join, live updates, waiter ticket in sunlight and in a dim place, screen reader spot check with TalkBack/VoiceOver).
5. ~~**Link previews**~~: done 2026-11-07, confirmed by the owner in the Sharing Debugger and in Messenger. Invites live at `/i/<code>` (`/j/` redirects); the history is in `docs/deployment.md` → Link previews.
6. **Usability test** (one run done on the pre-November-8 UI; repeat on the current UI) against Notes with a real table (brief 15.6): time to record ten dishes, mistakes, corrections, confidence.
7. ~~**PostHog**~~: done 2026-11-08; key set in Coolify, owner is monitoring (insight ideas: funnel order_started → dish_added → round_confirmed → order_ended; setup-guide funnel, still named `tour_*` events; rage/dead clicks by page).
8. ~~**Turnstile (bot check)**~~: done 2026-11-08, keys set in Coolify; confirmed by the owner on a phone browser and the installed PWA.
9. **KKB on real phones**: decimal keypad opens for prices, the inline price editor stays above the keyboard, service charge entry, a guest sees their share live.
10. **KKB pilot** with a real table of 7–12 doing KKB (see Next steps).
11. **KKB decisions**: whether Copy text / Save image should get an explicit "include prices" option (deferred); confirm the limits (₱99,999.99 per dish, ₱999,999.99 service charge); whether guests may rename themselves (endpoint is host-only today).

## Known limitations

- Rate limits, live-update fan-out and the 10-minute create/join replay memory live in one process: run one app instance (brief 7.7). They reset on restart. Move them to PostgreSQL before scaling out.
- Idempotency keys are bound to a change's kind and target, but not to its exact body. Clients generate a fresh key per change, so this only matters for a buggy client.
- Changes waiting on a phone are kept in that browser's `localStorage`. Clearing site data, or a private window, loses them; the page says when changes are waiting.
- Editing a dish changes its size, notes and who it's for; changing the dish itself is a remove-and-add, by design (dish identity drives consolidation).
- Join codes are 6 characters. Wrong codes are limited per address (40/hour) and across all addresses (2,000/hour), so a guessing attack from many addresses is capped. The price: during such an attack, invite pages wait out the hour.
- A large table behind one shared carrier address (some mobile networks) shares the 30 joins per hour.
- Removing a guest also takes them out of their groups, so a shared group dish lists only the remaining members in "Who ordered what".
- Performance numbers in `docs/testing.md` are local measurements, not production benchmarks.
- KKB: prices appear only in the KKB tab; Items' Copy text and Save image stay price-free (an explicit "include prices" option is a later step built on `buildKkb`). Every member sees everyone's prices. Limits: ₱99,999.99 per dish, ₱999,999.99 service charge. A shared dish goes to one payer (Bill to) or stays unallocated; no splitting. Guests can't rename themselves yet (the endpoint is host-only).

## Next steps

KKB pilot (owner): a real table of 7–12 doing KKB. Watch whether the host can price the receipt and enter the service charge quickly, whether diners find their own totals, whether "Not yet allocated" reasons make sense, and record any difference from the receipt against the table's usual Notes/calculator.

Re-check the UI after visual changes with `UX_REVIEW=1 pnpm e2e e2e/ux-review.spec.ts` (screenshots and a report in `.impeccable/review/ux`). Consider a Traefik rate limit in front of the app as a backstop.

After the owner tasks: watch logs and metrics for a week (`docs/deployment.md` → Operations), then consider: per-event client patches instead of snapshot refetch if orders get large, offline service worker (installable today, but needs network), and the ceiling ideas from the finish review (stacked carbon copies, pad-style index tabs).
