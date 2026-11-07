# Architecture

One Next.js 16 application (App Router) and one dedicated PostgreSQL database. No Redis, no worker process.

## Layers

| Layer | Where | Responsibility |
|---|---|---|
| Pages | `src/app/**/page.tsx` | Server-render the first view from the database (`loadSessionForPage`), then hand a snapshot to client components. |
| Client state | `src/hooks/use-session.ts` | Holds the last committed snapshot plus pending changes; draws pending changes on top, marked as pending; refetches the snapshot after each committed change. |
| UI | `src/components/**` | Presentation only. Business rules live in `src/lib` and `src/server`. |
| API | `src/app/api/**/route.ts` | Thin: identity (`requireActor`), idempotency key, Zod body, then a service inside `runMutation`. |
| Services | `src/server/orders`, `src/server/sessions` | The rules: permissions, round state, limits, attribution, soft delete. |
| Mutation runner | `src/server/mutations.ts` | One transaction per change: lock the session row, replay a known idempotency key, apply, bump `sessions.revision`, append `session_events`, `pg_notify`, record the key. |
| Pure logic | `src/lib/consolidate.ts`, `dish-name.ts`, `permissions.ts`, `join-code.ts` | Shared by server and browser; unit-tested. |
| Database | `src/server/db/schema.ts`, `drizzle/` | Constraints and triggers that the application cannot break (see data-model.md). |

## Data flow: adding a dish

1. Composer → `useSession.mutate({kind:"add"})`: a pending line appears immediately (dimmed, "Saving…"), the sync pill says Saving.
2. `POST /api/sessions/:id/entries` with a fresh `Idempotency-Key`.
3. `runMutation` locks the session, finds the draft round, upserts the dish by normalized name, inserts a batch (attribution) and the entry, bumps the revision, writes the event and the idempotency record, commits.
4. The client refetches `/sync`, replaces its snapshot (never with an older revision) and drops the pending line. A failure keeps the change visible with Retry and Discard.

## Real time

Events are already written durably per revision and announced with `pg_notify('salo_events', '<session>:<revision>')`. The SSE stream delivers them to other devices (`docs/realtime.md`). Also in the app: product analytics (`src/lib/analytics.ts`, PostHog through `/ingest`, only when `POSTHOG_KEY` is set), and the hourly retention cleanup (`src/server/maintenance/cleanup.ts`). On the client, the change queue's rules live in `src/lib/queue.ts`: strict order, conflict-safe revisions, and saved across reloads.

## Security boundaries

`src/proxy.ts` (CSP nonce for pages, Origin check for API mutations), `src/server/http.ts` (identity, body limits, error envelope), `src/lib/permissions.ts` (role × action). See api.md.
