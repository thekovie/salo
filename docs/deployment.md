# Deployment

Salo runs as two independent resources on the Coolify VPS (brief 13.2). Never point Salo at Coolify's own `coolify-db`.

## Resource A: the app (Dockerfile)

- Build pack: **Dockerfile** (repository root). Multi-stage, Node 22 slim, Next.js standalone output, runs as the non-root `node` user.
- Port 3000. Health check built into the image: `GET /api/health` returns 200 when the database is reachable, 503 otherwise.
- Migrations apply automatically at startup; a bad setting or unreachable database stops the container with a log line `salo could not start` naming the problem.
- Suggested memory limit: 512 MiB (a starting value to observe, not a measured optimum).

### Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://user:password@<internal-host>:5432/salo` using the Coolify-internal hostname of Resource B. |
| `APP_URL` | yes | Public https address. Invite links, QR codes and link previews are built from it. |
| `CLOSED_RETENTION_DAYS` | no (7) | Days a closed session stays readable before deletion. |
| `INACTIVE_RETENTION_DAYS` | no (30) | Days without activity before an unclosed session is deleted. |

Rate limits identify clients by the **last** `X-Forwarded-For` entry, which assumes exactly one trusted reverse proxy (Coolify's) appends it. Never expose the container port directly, and do not put a CDN in front without revisiting `src/server/auth/client-ip.ts`.

Untick "Available at Buildtime" for `DATABASE_URL` (it is a secret and is only needed at runtime).

## Resource B: PostgreSQL

- Create a Coolify **PostgreSQL** database resource (17), with its own user, password and persistent volume.
- Do not publish its port (no public 5432); the app reaches it over Coolify's internal network.
- Backups: to be configured and documented in Phase 5 (daily, off-VPS destination, restore test).

## Local production-like run

```bash
docker compose --profile app up --build   # app on 127.0.0.1:3000 with its own PostgreSQL
```

`compose.yaml` is for local runs and CI only; production uses the two Coolify resources above.
