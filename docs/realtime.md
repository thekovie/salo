# Real time

Authenticated HTTP mutations + Server-Sent Events + PostgreSQL (brief 7.4–7.8). One app instance; no Redis.

## Write path
Every change runs in `runMutation` (`src/server/mutations.ts`), joining runs in `joinSession`. In one transaction: lock the session row, apply the change, `sessions.revision += 1`, insert a `session_events` row with that revision, `pg_notify('salo_events', '<sessionId>:<revision>')`. NOTIFY is delivered only if the transaction commits, so no event is ever announced for a change that did not happen. Revisions are gap-free per session.

## Stream: `GET /api/sessions/:id/events`
- Authenticated with the session cookie; strangers get `404`.
- Starts after a cursor: the `Last-Event-ID` header (sent by the browser on reconnect) or `?after=<revision>` (the revision the page was rendered at); without either, the current revision.
- First frame `retry: 3000`. Then every event after the cursor is replayed from `session_events`, and new ones follow as NOTIFY arrives (`src/server/realtime/hub.ts` keeps one LISTEN connection per process and fans out; each stream re-reads the log, so a lost notification costs latency, not data).
- Event frame: `id: <revision>`, `event: change`, `data: {"id","sessionId","type","revision","at","payload"}`. Types so far: `session.created`, `session.renamed`, `entry.added`, `entry.updated`, `entry.removed`, `entry.restored`, `participant.joined`, `readiness.changed`, `group.updated`, `claim.requested`, `attribution.changed`. Payloads carry ids only.
- `event: resync` (with the current revision as its id) when the history after the cursor is missing or longer than 200 events.
- Heartbeat comment `: ping` every 20 s, which also re-reads the log (so a failed read heals itself). Each stream ends after 15 minutes; the browser reconnects immediately with `Last-Event-ID`, which re-checks the credential and caps. Caps: 500 per instance, 12 per client address, 4 per participant (`503 TOO_MANY_STREAMS`). Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. Closing the connection unsubscribes immediately.

## Client (`src/hooks/use-session.ts`)
- `EventSource` with `?after=<rendered revision>`; the browser reconnects by itself and sends `Last-Event-ID`.
- A `change` newer than the local snapshot, or a `resync`, schedules one snapshot fetch (`GET /sync`); bursts collapse into at most one extra fetch. Snapshots older than the one shown are ignored, so duplicate or out-of-order events cannot move totals backwards.
- After a dropped connection reopens, the snapshot is fetched once more. If the server refused the stream outright, a fresh stream is opened with backoff (5 s doubling to 60 s). A failed snapshot fetch retries every 3 s until it succeeds, because the event that triggered it will not be replayed.
- Sync pill: Saving… / Saved / Reconnecting… / Offline · not saved yet / Changed elsewhere / Not saved.

## Pending changes
Own changes queue on the device and go to the server one at a time, in order, each with its idempotency key; repeated taps on one stepper collapse into the final number; network failures retry automatically with backoff (2 s doubling to 30 s) and resume when the browser comes back online. A change leaves the screen only when a snapshot containing it has arrived; refused changes are listed by name with the reason.

## Proxy
Coolify's Traefik does not buffer streamed responses by default; the 20 s heartbeat keeps idle connections below common proxy timeouts. After a redeploy the stream drops, the browser reconnects with `Last-Event-ID`, and missed events replay. Verify on the real proxy before launch (Phase 5).
