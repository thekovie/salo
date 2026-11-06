# Handoff

Read this first when resuming. Specification: `docs/brief.md`. Decisions per PR: `PROJECT_LOG.md`.

## Status

| Milestone | Brief phase | State |
|---|---|---|
| M0 Foundation | 0 | Merged (PR #2) |
| M1 Standalone ordering | 1 | Merged (PR #3) |
| M2 Collaboration (QR, SSE) | 2 | Merged (PR #4) |
| M3 Groups & hybrid | 3 | Merged (PR #5) |
| M4 Review, confirm, rounds | 4 | In review (`feat/m4-rounds`) |
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

M5: retention cleanup job (closed +7 d, inactive +30 d) and scenario 14, backups and restore doc, SSE through the real Coolify proxy, full accessibility pass (keyboard, screen reader), performance check with 20 people / 100 entries, remaining docs, final design review.
