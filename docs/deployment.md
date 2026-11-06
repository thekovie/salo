# Deployment

Salo runs as two independent resources on the Coolify VPS (brief 13.2). Never point Salo at Coolify's own `coolify-db`.

## Resource B first: PostgreSQL

1. *New resource → Database → PostgreSQL 17*. Name it `salo-db`; Coolify generates a user and password.
2. Leave **"Make it publicly available" off**: no public port 5432. The app reaches it over Coolify's internal network.
3. Memory limit: 512 MiB to start (a starting value to observe, not a measured optimum). Persistent volume: Coolify creates one.
4. Copy the **internal** connection URL (`postgres://user:password@<internal-host>:5432/postgres`); change the database name to `salo` and create it once (*Terminal*: `psql -U <user> -d postgres -c 'CREATE DATABASE salo'`), or use the default database name throughout.
5. Backups: see [backups.md](backups.md).

## Resource A: the app

1. *New resource → Application → Public repository* (`https://github.com/thekovie/salo`), branch `main`, build pack **Dockerfile**.
2. Port **3000**. Domain: e.g. `https://salo.example.com` (Coolify issues the certificate).
3. Environment (untick "Available at Buildtime" for `DATABASE_URL`):

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Internal URL of `salo-db`, database `salo`. |
| `APP_URL` | yes | The public https address, exactly as people open it. Invite links, QR codes, link previews, and the CSRF origin check all use it. |
| `CLOSED_RETENTION_DAYS` | no (7) | Days a closed order stays readable before deletion. |
| `POSTHOG_KEY` | no | PostHog (US cloud) project API key, `phc_…`. Set it to turn on analytics and session replay (sent through `/ingest` on this domain). Unset: no analytics at all. |
| `NEW_ORDERS_PER_HOUR` | no (20) | New orders one client address may start per hour. Leave it in production; the e2e suite raises it. |
| `INACTIVE_RETENTION_DAYS` | no (30) | Days without activity before an unclosed order is deleted. |

4. Health check: the image has one (`GET /api/health`: 200 when the database answers, 503 otherwise). Coolify's own health check may point at the same path.
5. Memory limit: 512 MiB for the running app. The **build** needs more (Next.js); if builds are killed, raise the build limit or build in GitHub Actions.
6. Restart policy: "unless stopped" (default).

### What happens at startup
Migrations run automatically, then the server starts, then the hourly cleanup job runs once and every hour after. A bad setting or unreachable database stops the container with `salo could not start` in the log, naming the problem (Coolify shows this only as "unhealthy": read the container log).

## Live updates behind Coolify's proxy

Coolify routes traffic through Traefik. Salo's event stream works through it without extra labels:
- `scripts/sse-proxy-check.mjs` runs the app behind Traefik v3 (`docker compose --profile proxy`, see below) in CI: events arrive in well under a second (75 ms locally), 20-second heartbeats keep an idle stream open past 75 s, and reconnecting with `Last-Event-ID` replays missed events.
- Each stream ends after 15 minutes on purpose; browsers reconnect at once and lose nothing. Redeploys drop streams the same way.
- After the first deploy, run the check against production: `node scripts/sse-proxy-check.mjs https://salo.example.com 75` (it creates a throwaway order; it is deleted after 30 days like any quiet order).
- Rate limits key on the **last** `X-Forwarded-For` hop, which Traefik appends. Do not expose the container port directly, and revisit `src/server/auth/client-ip.ts` before putting a CDN in front (behind Cloudflare every visitor would share the edge address: key on `CF-Connecting-IP` instead).

## Operations

| Watch | Where | Act when |
|---|---|---|
| App health | Coolify status, `/api/health` | 503 or "unhealthy" for more than a few minutes: read the container log. |
| Container restarts | Coolify resource events | Repeated restarts: usually `salo could not start` (settings, database). |
| RAM / disk | Coolify server metrics | Sustained > 80 % (brief 13.6: alert on sustained pressure, not spikes). |
| Database | `salo-db` status, backups tab | Backup failed notification; volume near full. |
| Errors | Container log (JSON lines; `"level":"error"`) | `request failed`, `realtime listen failed`, `session cleanup failed`. |
| Live updates | Container log `event stream read failed`; user reports of "Reconnecting…" | Check database health; streams recover on their own. |

Logs are one JSON object per line with secrets redacted (`src/lib/logger.ts`).

## Local production-like runs

```bash
docker compose --profile app up --build                                    # app on 127.0.0.1:3000 + PostgreSQL
SALO_APP_URL=http://localhost:8080 docker compose --profile proxy up --build # app behind Traefik on 127.0.0.1:8080
node scripts/sse-proxy-check.mjs http://localhost:8080 75
```

`compose.yaml` is for local runs and CI only; production uses the two Coolify resources above.
