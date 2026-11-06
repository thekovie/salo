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

All 14 brief end-to-end scenarios are covered by Playwright (see `docs/testing.md`).

## Deployment

- **Deployed on Coolify by the owner on 2026-11-06.** `main` at `8e0c088` (PR #16) is the latest build; redeploy from `main` to get everything above.
- Database migrations run when the app starts. The latest is `0005_participant_removal` (from PR #14). Check the first start after deploying it logs no migration error.
- Environment: `APP_URL` must be the real https domain (invite links, QR codes, link previews and the CSRF origin check depend on it). Optional: `NEW_ORDERS_PER_HOUR` (default 20; leave it in production), `CLOSED_RETENTION_DAYS` (default 7). See `docs/deployment.md`.
- After each deploy, a quick smoke check:
  - `/api/health` returns 200;
  - start an order on a phone, and join it from a second phone by QR;
  - confirm a round, end the order, and check that "Who ordered what" opens.

## Working rules

- One branch per change, PR into `main`, merge only after typecheck, lint, tests, build and CI pass and the owner says go.
- Conventional commits; no co-author or tool attribution anywhere.
- Independent code and security review before merging auth, mutation and real-time work.
- Public repository: never commit secrets or random-looking secret literals in tests (build them at runtime). Local/CI PostgreSQL uses trust auth for that reason.
- Design: follow `DESIGN.md` and the direction contract; light and dark, WCAG 2.2 AA, no sidebar, light type weights. Re-shoot screens with `CAPTURE=1 pnpm e2e e2e/capture.spec.ts`.

## Owner tasks (cannot be done from the repository)

1. ~~**Deploy** on Coolify~~: done 2026-11-06. Keep `APP_URL` set to the real https domain.
2. **Backups**: daily schedule, S3 off-VPS destination, retention, failure alerts on the PostgreSQL resource (`docs/backups.md`); run the first production restore drill and note the date here.
3. **Proxy check in production**: `node scripts/sse-proxy-check.mjs https://<domain> 75`.
4. **Real phones**: try a full order on Android and iPhone over mobile data (QR join, live updates, waiter ticket in sunlight and in a dim place, screen reader spot check with TalkBack/VoiceOver).
5. **Link previews**: resolved on 2026-11-06; nothing to change on the server. See `docs/deployment.md` → Link previews. To do: once Facebook has re-read robots.txt (about a day), press **Scrape Again** in the Sharing Debugger on an invite link and confirm the card.
6. **Usability test** against Notes with a real table (brief 15.6): time to record ten dishes, mistakes, corrections, confidence.
7. **PostHog**:
   - In Coolify, set `POSTHOG_KEY` to the US project's `phc_…` key and redeploy.
   - In PostHog project settings, turn on Session replay (sample rate 100%), Heatmaps, Autocapture and Exception autocapture. Consider "Discard client IP data", which the privacy policy allows for but doesn't promise.
   - Suggested insights:
     - funnel order_started → dish_added → round_confirmed → order_ended;
     - tour_offer_shown → tour_started → tour_completed;
     - rage clicks and dead clicks by page.

## Known limitations

- If a guest's join request succeeds but the response is lost, retrying creates a second guest with the same name (harmless; shows twice in People).
- Reusing one idempotency key for a different target by the same participant returns the earlier result (only affects that participant's own retries).
- Rate limits and live-update fan-out live in one process: run one app instance (brief 7.7). Counters reset on restart. Move limits to PostgreSQL before scaling out.
- Join codes are 6 characters. Wrong codes are limited per address (40/hour) and across all addresses (2,000/hour), so a guessing attack from many addresses is capped. The price: during such an attack, invite pages wait out the hour.
- A large table behind one shared carrier address (some mobile networks) shares the 30 joins per hour.
- Removing a guest also takes them out of their groups, so a shared group dish lists only the remaining members in "Who ordered what".
- Performance numbers in `docs/testing.md` are local measurements, not production benchmarks.

## Next steps

Re-check the UI after visual changes with `UX_REVIEW=1 pnpm e2e e2e/ux-review.spec.ts` (screenshots and a report in `.impeccable/review/ux`). Consider a Traefik rate limit in front of the app as a backstop.

After the owner tasks: watch logs and metrics for a week (`docs/deployment.md` → Operations), then consider: per-event client patches instead of snapshot refetch if orders get large, offline service worker (installable today, but needs network), and the ceiling ideas from the finish review (stacked carbon copies, pad-style index tabs).
