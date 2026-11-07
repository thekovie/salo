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

## Link previews (Messenger, Viber, WhatsApp…)
- Every shared link shows a card: the landing page, invites (`/j/<code>`, with the order's name), and room links (`/s/<id>`, which redirect to the invite). Cards never show dishes or people.
- `robots.txt` blocks only `/api/`, and search engines are kept out with `noindex`. Previews need crawlers to be allowed in, which is why robots.txt is not used for that (fixed in PR #13).
- **Invites live at `/i/<code>` (2026-11-07).** Even after robots.txt changed and noindex was removed for Meta's crawlers, the Sharing Debugger kept returning 403 for `/j/…` while `/privacy` worked. Meta kept the old `Disallow: /j/` rule cached and wouldn't re-read it. New invite links use `/i/`, a path Meta never saw blocked; `/j/<code>` redirects (308) to `/i/<code>`, so old links and QR codes still work.
- **Root cause found (2026-11-07):** Meta's Sharing Debugger treats a page's `noindex`/`nofollow` (the `X-Robots-Tag` header or the robots meta tag) as a robots block and reports **403, "could be due to a robots.txt block"**. `/privacy`, which has no noindex, scraped fine while invites got 403. Invite and order pages therefore skip noindex for Meta's crawlers only (`facebookexternalhit`, `Facebot`, `meta-externalagent`; see `src/lib/crawlers.ts`). Every other client, search engines included, still gets `noindex, nofollow`. The card never shows dishes or people.
- **Facebook / Messenger caches robots.txt and each link's card**, for up to about a day. After a robots.txt change, or for a link first seen while it was blocked, the Sharing Debugger (developers.facebook.com/tools/debug) reports *403, "could be due to a robots.txt block"* even though the server returns 200 to everyone. Wait for Facebook to re-read robots.txt, then press **Scrape Again**.
- How to tell a cache problem from a real block:
  - Run `curl -A "facebookexternalhit/1.1" -o /dev/null -w "%{http_code}" https://<domain>/j/<code>` and check opengraph.xyz.
  - If both are fine, it's Facebook's cache.
  - If the server really blocks, the proxy logs show Facebook's requests failing, or show none at all (then it's the hosting network).
- Diagnosed on 2026-11-06, with every check passing:
  - Facebook, Facebot, meta-externalagent, Viber, WhatsApp and Telegram user agents get 200 with tags in `<head>`; the image returns 200 PNG.
  - Facebook-style requests (HTTP/1.1, byte range) also work.
  - No IPv6 record; consistent DNS (Cloudflare, DNS-only); valid TLS chain.
  - opengraph.xyz renders every platform. Only the debugger's cached robots.txt said 403.

## Local production-like runs

```bash
docker compose --profile app up --build                                    # app on 127.0.0.1:3000 + PostgreSQL
SALO_APP_URL=http://localhost:8080 docker compose --profile proxy up --build # app behind Traefik on 127.0.0.1:8080
node scripts/sse-proxy-check.mjs http://localhost:8080 75
```

`compose.yaml` is for local runs and CI only; production uses the two Coolify resources above.
