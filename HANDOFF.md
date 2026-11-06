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
| M5 Hardening | 5 | In review (`feat/m5-hardening`) |

All 14 brief end-to-end scenarios are covered by Playwright (see `docs/testing.md`).

## Working rules

- One branch per change, PR into `main`, merge only after typecheck, lint, tests, build and CI pass and the owner says go.
- Conventional commits; no co-author or tool attribution anywhere.
- Independent code and security review before merging auth, mutation and real-time work.
- Public repository: never commit secrets or random-looking secret literals in tests (build them at runtime). Local/CI PostgreSQL uses trust auth for that reason.
- Design: follow `DESIGN.md` and the direction contract; light and dark, WCAG 2.2 AA, no sidebar, light type weights. Re-shoot screens with `CAPTURE=1 pnpm e2e e2e/capture.spec.ts`.

## Owner tasks (cannot be done from the repository)

1. **Deploy** on Coolify: PostgreSQL resource first, then the app (`docs/deployment.md`). Set `APP_URL` to the real https domain.
2. **Backups**: daily schedule, S3 off-VPS destination, retention, failure alerts on the PostgreSQL resource (`docs/backups.md`); run the first production restore drill and note the date here.
3. **Proxy check in production**: `node scripts/sse-proxy-check.mjs https://<domain> 75`.
4. **Real phones**: try a full order on Android and iPhone over mobile data (QR join, live updates, waiter ticket in sunlight and in a dim place, screen reader spot check with TalkBack/VoiceOver).
5. **Link previews**: paste an invite link in Messenger and Viber; use the Facebook Sharing Debugger if a preview is stale.
6. **Usability test** against Notes with a real table (brief 15.6): time to record ten dishes, mistakes, corrections, confidence.

## Known limitations

- If a guest's join request succeeds but the response is lost, retrying creates a second guest with the same name (harmless; shows twice in People).
- Reusing one idempotency key for a different target by the same participant returns the earlier result (only affects that participant's own retries).
- Rate limits and live-update fan-out live in one process: run one app instance (brief 7.7). Move limits to PostgreSQL before scaling out.
- Join codes are 6 characters with per-address throttling; a guessing attack spread across many addresses is only slowed.
- Performance numbers in `docs/testing.md` are local measurements, not production benchmarks.

## Next steps

After the owner tasks: watch logs and metrics for a week (`docs/deployment.md` → Operations), then consider: per-event client patches instead of snapshot refetch if orders get large, offline service worker (installable today, but needs network), and the ceiling ideas from the finish review (stacked carbon copies, pad-style index tabs).
