# Testing

| Suite | Command | Needs | What it covers |
|---|---|---|---|
| Unit + integration | `pnpm test` | local PostgreSQL (`pnpm db:up`); creates `salo_test` | Pure logic (normalization, consolidation, ticket text, permissions, join codes, env, CSP, logger, rate limiter, origin check) and services against real PostgreSQL (session creation, credentials, idempotent retries, concurrent adds, optimistic locking, soft delete/restore, guest ownership, cross-session ids, closed sessions, database integrity rules). |
| End to end | `pnpm e2e` | local PostgreSQL; builds and starts the app on port 3100 | Brief scenarios 2 (QR/code collaboration with two browsers), 4 (hybrid: host and guest entries consolidate live), 12 (network recovery both ways), invite preview leaks no dishes, 1 (host-only ordering), 5 (similar dish consolidation), 6 (variants), 7 (Undo), 8 (duplicate submission), 9 (waiter view), strangers get 404, axe WCAG 2.2 AA scan of landing, workspace (light and dark) and waiter ticket. |
| CI | GitHub Actions | — | Migration drift check, `pnpm audit`, typecheck, lint, tests, build, e2e, Docker image smoke test. |

Integration also covers joining (codes, duplicate names, closed orders, table cap), event replay and resync, and the live stream delivering commits to several subscribers. Scenarios 3, 10, 11, 13 and 14 arrive with M3–M5.
