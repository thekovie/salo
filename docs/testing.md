# Testing

| Suite | Command | Needs | What it covers |
|---|---|---|---|
| Unit + integration | `pnpm test` | local PostgreSQL (`pnpm db:up`); creates `salo_test` | Pure logic (normalization, consolidation, ticket text, permissions, join codes, env, CSP, logger, rate limiter, origin check) and services against real PostgreSQL (session creation, credentials, idempotent retries, concurrent adds, optimistic locking, soft delete/restore, guest ownership, cross-session ids, closed sessions, database integrity rules). |
| End to end | `pnpm e2e` | local PostgreSQL; builds and starts the app on port 3100 | Brief scenarios 9 (review and waiter view), 10 (host-only confirmation; guests have no confirm), 11 (round 2 with only new dishes plus a correction; round 1 untouched), 13 (end session, read-only for guests), stale-revision confirmation refused, 3 (collective group with members), 4 (hybrid: claims with host approval, double-order hint, readiness reset), 2 (QR/code collaboration with two browsers), 4 (hybrid: host and guest entries consolidate live), 12 (network recovery both ways), invite preview leaks no dishes, 1 (host-only ordering), 5 (similar dish consolidation), 6 (variants), 7 (Undo), 8 (duplicate submission), 9 (waiter view), strangers get 404, axe WCAG 2.2 AA scan of landing, workspace (light and dark) and waiter ticket. |
| Proxy streaming | `node scripts/sse-proxy-check.mjs <url> <idle-s>` | app behind Traefik (`docker compose --profile proxy`) | Event latency through the proxy (< 1 s), heartbeats over a long idle, `Last-Event-ID` replay. Local run 2026-11-06: 75 ms, 3 heartbeats in 75 s, replay OK. |
| Backup drill | `scripts/backup-restore-drill.sh` | local PostgreSQL | Dump, restore into a scratch database, identical row counts, constraints present. Local run 2026-11-06: PASS. |
| CI | GitHub Actions | — | Migration drift check, `pnpm audit`, typecheck, lint, tests, build, e2e, Docker image smoke test, proxy streaming check (45 s idle). |

Integration also covers joining (codes, duplicate names, closed orders, table cap), event replay and resync, and the live stream delivering commits to several subscribers. Integration also covers readiness per round and its reset, claim rules (who may claim what, approval, decline, duplicates), and group members. axe scans include People and Groups for host and guest. Integration covers confirmation (host-only, stale revision, empty round, immutable snapshot, frozen entries, claims closed), rounds, corrections (limits, permissions, removal) and closing (read-only, 7-day expiry). Also: scenario 14 (an expired order's links and invite stop working; landing no longer offers it), keyboard-only use (add with Enter, focus returns, steppers, tabs with arrows/Home/End, dialogs open with Enter and close with Escape returning focus), 20 people adding at once give exact totals, and a load check with 100 entries for 20 people.

## Measurements (local, 2026-11-06, Apple silicon dev machine; not production benchmarks)

| What | Result | Brief 14 target |
|---|---|---|
| Add a dish (API, average of 100) | 21 ms | controls respond without noticeable delay |
| Reload a workspace with 100 entries / 20 people | 120 ms | no significant degradation at 100 entries |
| New dish visible after tapping Add | 63 ms (saved 97 ms) | no noticeable delay |
| Change visible on another device (through Traefik) | 75 ms | within 1 s |

Still to measure on the real VPS and phones (owner): the same numbers over mobile data, and a real-table usability comparison with Notes (brief 15.6).
