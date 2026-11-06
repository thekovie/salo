# Salo

**One table. Everyone's order.** Salo collects a restaurant table's order in one place, merges identical dishes into exact counts (keeping every variant and instruction), and gives the waiter one clear ticket. No restaurant integration, no menus, no accounts.

- Product brief: [`docs/brief.md`](docs/brief.md) (the approved specification)
- Current state and next steps: [`HANDOFF.md`](HANDOFF.md)
- Decisions and per-PR record: [`PROJECT_LOG.md`](PROJECT_LOG.md)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL 17 · Drizzle ORM · postgres.js · Zod · Vitest · Playwright. Self-hosted with Docker on Coolify.

## Prerequisites

- Node 22 (`.nvmrc`) and pnpm (version pinned in `package.json`, `corepack enable`)
- Docker (for the local PostgreSQL)

## Development

```bash
cp .env.example .env
pnpm install
pnpm db:up        # PostgreSQL on 127.0.0.1:5433
pnpm dev          # http://localhost:3000 (migrations run at startup)
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build / server |
| `pnpm typecheck` | Route types + `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit + integration tests (needs the local PostgreSQL; creates `salo_test`) |
| `pnpm e2e` | Playwright end-to-end tests (builds and starts the app on port 3100) |
| `pnpm db:generate` | Generate a migration after editing `src/server/db/schema.ts` |
| `docker compose --profile app up --build` | Run the production image with its own PostgreSQL |

## Documentation

`docs/` describes implemented behaviour only: [architecture](docs/architecture.md), [data model](docs/data-model.md), [API](docs/api.md), [UX specification](docs/ux-specification.md), [real time](docs/realtime.md), [security](docs/security.md), [testing](docs/testing.md), [deployment](docs/deployment.md). Design system: [DESIGN.md](DESIGN.md). More documents are added as each phase ships (see HANDOFF.md).
