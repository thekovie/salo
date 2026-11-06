# Handoff

Read this first when resuming. Specification: `docs/brief.md`. Decisions per PR: `PROJECT_LOG.md`.

## Status

| Milestone | Brief phase | State |
|---|---|---|
| M0 Foundation | 0 | Merged (PR #2) |
| M1 Standalone ordering | 1 | Merged (PR #3) |
| M2 Collaboration (QR, SSE) | 2 | Merged (PR #4) |
| M3 Groups & hybrid | 3 | In review (`feat/m3-groups-hybrid`) |
| M4 Review, confirm, rounds | 4 | Not started |
| M5 Hardening | 5 | Not started |

## Working rules

- One branch per milestone, PR into `main`, merge only after typecheck, lint, tests, build and CI pass and the owner says go.
- Conventional commits; no co-author or tool attribution anywhere.
- Independent code and security review before merging auth, mutation and real-time work.
- Public repository: never commit secrets or random-looking secret literals in tests (build them at runtime).
- Design: follow `PRODUCT.md` and the direction contract in `.impeccable/surfaces/src-app.md`; light and dark, WCAG 2.2 AA, no sidebar, light type weights.

## Local setup

`cp .env.example .env && pnpm install && pnpm db:up && pnpm dev`. Tests need the local PostgreSQL (`pnpm db:up`).

## Known limitations

- SSE has not yet been tested through Coolify's real proxy (Phase 5).
- Backups, cleanup job, rate limits on endpoints and SSE proxy testing are Phase 5 items.

## Next steps

M4: review screen (duplicates, sync issues, readiness), waiter view from review, host-only "Confirmed with waiter" with revision check and immutable snapshot, new rounds (carbon-copy colours, CONFIRMED stamp), corrections, End session + read-only view, Rounds tab.
