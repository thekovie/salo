# Real time

Authenticated HTTP mutations + Server-Sent Events + PostgreSQL (brief 7.4–7.8). One app instance; no Redis.

## Write path
Every change runs in `runMutation` (`src/server/mutations.ts`), joining runs in `joinSession`. In one transaction: lock the session row, apply the change, `sessions.revision += 1`, insert a `session_events` row with that revision, `pg_notify('salo_events', '<sessionId>:<revision>')`. NOTIFY is delivered only if the transaction commits, so no event is ever announced for a change that did not happen. Revisions are gap-free per session.

## Stream: `GET /api/sessions/:id/events`
- Authenticated with the session cookie; strangers get `404`.
- Starts after a cursor: the `Last-Event-ID` header (sent by the browser on reconnect) or `?after=<revision>` (the revision the page was rendered at); without either, the current revision.
- First frame `retry: 3000`. Then every event after the cursor is replayed from `session_events`, and new ones follow as NOTIFY arrives (`src/server/realtime/hub.ts` keeps one LISTEN connection per process and fans out; each stream re-reads the log, so a lost notification costs latency, not data).
- Event frame: `id: <revision>`, `event: change`, `data: {"id","sessionId","type","revision","at","payload"}`. Types so far: `session.created`, `session.renamed`, `entry.added`, `entry.updated`, `entry.removed`, `entry.restored`, `participant.joined`, `readiness.changed`, `group.updated`, `claim.requested`, `attribution.changed`, `round.confirmed`, `round.opened`, `correction.recorded`, `correction.removed`, `session.closed`, `participant.removed`, `participant.restored`, `entry.settled`, `receipt.set`, `receipt.removed`, `correction.priced`, `session.serviceCharge`, `session.receiptTotal`, `participant.renamed`, `price.defaultSet`, `dish.unavailable`, `dish.unavailableTold`, `serving.updated`, `participant.cohostSet`, `participant.cohostRevoked`, `payment.recorded`, `payment.updated`, `payment.deleted`, `host.transferred`. `session.receiptTotal` (the receipt's printed total) is a non-ticket event like the service charge. `serving.updated` (the served tally, payload `{ roundId, actorId }`) the two co-host events, `host.transferred` (payload `{ fromId, toId }`) and the three payment events never touch the ticket either, so it doesn't make a confirmation stale. Of the first set, the five before `dish.unavailable` and `dish.unavailableTold` never touch the waiter's ticket, so they don't make a host's confirmation stale. `dish.unavailable` (open-round entries were removed, or pending corrections on the dish were dropped) is a ticket event and does; `dish.unavailableTold` (only already-told rows were written) is not. A removed guest's open stream gets the `participant.removed` event about them and then ends. Payloads carry ids only.
- `event: resync` (with the current revision as its id) when the history after the cursor is missing or longer than 200 events.
- Heartbeat comment `: ping` every 20 s, which also re-reads the log (so a failed read heals itself). Each stream ends after 15 minutes; the browser reconnects immediately with `Last-Event-ID`, which re-checks the credential and caps. Caps: 500 per instance, 64 per client address (a whole restaurant shares one Wi-Fi address), 4 per participant (`503 TOO_MANY_STREAMS`). A phone turned away, or with its stream down, polls `/sync` every 10 s until live updates come back, and its connection pill says "Reconnecting…". Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. Closing the connection unsubscribes immediately.

## Client (`src/hooks/use-session.ts`)
- `EventSource` with `?after=<rendered revision>`; the browser reconnects by itself and sends `Last-Event-ID`.
- A `change` newer than the local snapshot, or a `resync`, schedules one snapshot fetch (`GET /sync`); bursts collapse into at most one extra fetch. Snapshots older than the one shown are ignored, so duplicate or out-of-order events cannot move totals backwards.
- After a dropped connection reopens, the snapshot is fetched once more. If the server refused the stream outright, a fresh stream is opened with backoff (5 s doubling to 60 s). A failed snapshot fetch retries every 3 s until it succeeds, because the event that triggered it will not be replayed.
- Sync pill: Saving… / Saved / Reconnecting… / Offline · not saved yet / Changed elsewhere / Not saved.

## Notifications
Updates ride in each person's own snapshot (`notifications`: latest 50 plus the unread count), never in another participant's. Writing one adds no event of its own; it arrives with the change that caused it. `POST /notifications/read` bumps no revision and emits no event, so the client updates locally at once and refetches; snapshots at an equal revision still apply, which is how the badge follows the server.

## Pending changes
Own changes queue on the device and go to the server one at a time, in order, each with its idempotency key; repeated taps on one stepper collapse into the final number; network failures retry automatically with backoff (2 s doubling to 30 s) and resume when the browser comes back online. A change leaves the screen only when a snapshot containing it has arrived; refused changes are listed by name with the reason.

## Proxy
Coolify's Traefik does not buffer streamed responses by default; the 20 s heartbeat keeps idle connections below common proxy timeouts. After a redeploy the stream drops, the browser reconnects with `Last-Event-ID`, and missed events replay. CI runs the proxy check (`scripts/sse-proxy-check.mjs`) through Traefik; the production check stays an owner task.

## Reliability scenarios (F12)
What happens, and what pins it. Serving, price and adjustment races are cited, not repeated.

| Scenario | Behaviour | Pinned by |
|---|---|---|
| Stream drops, device reconnects | `Last-Event-ID` replays the durable log; a gap or more than `REPLAY_LIMIT` events sends `resync` and the client fetches a snapshot. Stale snapshots are ignored by revision | `tests/realtime.test.ts` (replay, resync, several corrections then reconnect) |
| Changes made offline | Queue in `localStorage` `salo:queue:<id>`, sent in order with keys, retried on `online` | `tests/queue.test.ts`, `e2e/offline.spec.ts` |
| Direct saves (prices, adjustments, receipts, payments) offline | Sheet shows Not saved; retried on `online` with the same key | `e2e/reliability.spec.ts` (offline payment), `e2e/reconnect-retry.spec.ts` |
| Save committed, response lost | A retry from the same open sheet reuses its key and replays: one row, no conflict | `e2e/reliability.spec.ts` (adjustment, receipt, payment) |
| Served taps and a reload | Unsent, failed or unanswered taps are kept in `localStorage` `salo:served:<id>` with their key and expected count, and resent on load; a stale expected count applies nothing | `tests/served-edits.test.ts`, `e2e/reliability.spec.ts` |
| Order ends with changes queued | Replays of earlier changes still resolve by key; a fresh queued add is refused and listed under Not saved with Discard | `tests/contract-billing-after-end.test.ts`, `e2e/reliability.spec.ts` |
| Two co-hosts serve at once, revoke during an update | Serving is clamped and re-checks the role under lock | `tests/contract-serving.test.ts`, `e2e/cohosts.spec.ts` |
| Two devices edit prices or the bill | Revision check gives CONFLICT; the latest value is shown | `tests/contract-table-prices.test.ts`, `e2e/adjustments.spec.ts` |

Ceiling (accepted): the idempotency id of an adjustment, receipt or payment is minted when its sheet opens. If the response is lost and the person closes or reloads and saves again, the new id makes a second row; the first is visible in the list through the stream. Fixing it needs a persisted id per sheet.

Notification read state is refresh-only across one person's devices (`src/server/notifications.ts`): a read on one phone shows on another after a reload.
