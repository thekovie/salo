# Handoff

Read this first when resuming. Specification: `docs/brief.md`. Decisions per PR: `PROJECT_LOG.md`.

## Status

| Milestone | Brief phase | State |
|---|---|---|
| M0 Foundation | 0 | Merged (PR #2) |
| M1 Standalone ordering | 1 | In review (`feat/m1-standalone-ordering`) |
| M2 Collaboration (QR, SSE) | 2 | Not started |
| M3 Groups & hybrid | 3 | Not started |
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

- Other devices see changes only after a reload until SSE lands (M2). Guests cannot join yet (M2).
- Backups, cleanup job, rate limits on endpoints and SSE proxy testing are Phase 5 items.

## Next steps

M2: invite sheet (QR, link, code) with the invite-link preview card, guest join, SSE stream with Last-Event-ID replay and resync, pending-change queue with retry/backoff, reconnecting state.
