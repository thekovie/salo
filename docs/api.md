# API

JSON over HTTPS. Implemented in `src/app/api/**` with shared helpers in `src/server/http.ts`.

## Conventions

- **Envelope**: success `{ "data": … }`; failure `{ "error": { "code": "…", "message": "…" } }`. Messages are written for people; codes are stable.
- **Identity**: an HttpOnly cookie per session (`salo_s_<sessionId>`) holding a random token; the server stores only its SHA-256. The role (HOST/GUEST) comes from that credential, never from the request body. A request without a valid credential for the session gets `404 NOT_FOUND` (no hint that the order exists).
- **CSRF**: cookies are `SameSite=Lax`, and every non-GET `/api` request must carry an `Origin` equal to the app's own origin (`src/proxy.ts`), otherwise `403 FORBIDDEN_ORIGIN`.
- **Idempotency**: every mutation needs an `Idempotency-Key` header (8–100 characters `[A-Za-z0-9_-]`). Retrying with the same key returns the first result (`replayed: true`) and changes nothing. Keys are scoped to (session, participant).
- **Validation**: Zod at the boundary (`src/server/orders/validation.ts`). Bodies over 8 KB get `413 TOO_LARGE`; invalid input `422 INVALID` with the first problem in `message`.
- **Limits**: 120 changes per minute per participant (`429 RATE_LIMITED`); 300 active entries, 1,000 entries ever and 300 distinct dishes per session; text may not contain NUL. Reusing an idempotency key for a different kind of change → `422 IDEMPOTENCY_KEY_REUSED`.
- **Mutation result**: `{ "data": { "result": …, "revision": <session revision>, "replayed": <bool> } }`.

## Endpoints (implemented)

| Method & path | Who | Body | Notes |
|---|---|---|---|
| `POST /api/sessions` | anyone | `{ "title"?: string }` | Creates session, host, host credential (cookie) and draft Round 1. `201 { id }`. Rate limit 20/hour per client address → `429 RATE_LIMITED`. |
| `GET /api/sessions/:id` | participant | — | Session snapshot (same as `/sync`). |
| `PATCH /api/sessions/:id` | host | `{ "title": string \| null }` | Rename (optional name, ≤ 60). |
| `GET /api/sessions/:id/sync` | participant | — | Authoritative snapshot at one revision (repeatable read). |
| `POST /api/sessions/:id/entries` | participant | `{ dishName, quantity, variant?, instructions?, attribution? }` | `attribution`: `{type:"UNASSIGNED"}` (default), `{type:"TABLE"}`, `{type:"INDIVIDUAL", label?, participantId?}`, `{type:"GROUP", label}`. Quantity 1–99, dish ≤ 60, variant ≤ 40, instructions ≤ 140. Max 300 active entries per session. |
| `PATCH /api/sessions/:id/entries/:entryId` | host, or the guest who added it | `{ expectedRevision, quantity?, variant?, instructions? }` | Optimistic locking: a stale `expectedRevision` → `409 CONFLICT`. |
| `DELETE /api/sessions/:id/entries/:entryId` | host, or the guest who added it | — | Soft delete (reversible). |
| `POST /api/sessions/:id/entries/:entryId/restore` | host, or the guest who added it | — | Undo a removal. Deviation: the brief lists no restore endpoint; Undo needs one. |
| `POST /api/sessions/:id/join` | anyone with the code | `{ code, displayName }` | Creates a guest and their cookie. The code must belong to `:id`. `404 INVITE_NOT_FOUND`, `409 SESSION_CLOSED`, `422 TABLE_FULL` (30 people). Rate limit 30/hour per client address. |
| `PUT /api/sessions/:id/readiness` | participant | `{ ready }` | "I'm ready" for the open round. Advisory; reset automatically when that person later changes their own entries. |
| `PUT /api/sessions/:id/groups` | participant | `{ label, memberIds }` | Optional members of a collective group, matched by label (case and spacing ignored). Replaces the member list. Only the host or whoever set the group up may change it (`403`); 30 groups per order (`422 TOO_MANY_GROUPS`). |
| `POST /api/sessions/:id/claims` | guest | `{ batchId }` | "That's mine" for a dish the host added (for this guest by name, or for nobody). Not for other guests' dishes or dishes marked for someone else. `409 CLAIM_PENDING`, `409 ALREADY_YOURS`. |
| `POST /api/sessions/:id/claims/:claimId/approve` | host | — | The dish becomes the guest's own (owner and "for" both change); other pending claims on it close. Refused if the dish was removed (`409 ENTRY_REMOVED`) or is now marked for someone else (`409 CLAIM_STALE`). |
| `POST /api/sessions/:id/claims/:claimId/reject` | host | — | Declines; nothing changes. `409 CLAIM_RESOLVED` when already answered. |
| `GET /api/sessions/:id/rounds` | participant | — | Rounds, confirmed tickets and corrections (also in the snapshot). |
| `POST /api/sessions/:id/rounds` | host | — | Start the next round after the last one was confirmed. `409 ROUND_OPEN`. |
| `POST /api/sessions/:id/rounds/:roundId/confirm` | host | `{ expectedRevision }` | "Confirmed with waiter". Refused if the session revision moved since the host looked (`409 STALE_REVISION`), if the round is not the open one (`409 ROUND_NOT_OPEN`), or if it has no dishes and no corrections (`422 EMPTY_ROUND`). Stores an immutable ticket snapshot, freezes the round's entries, closes pending claims on it. |
| `POST /api/sessions/:id/corrections` | host | `{ sourceEntryId, type: "QUANTITY" \| "REPLACE", quantity?, replacement?, explanation? }` | A change to a confirmed dish, carried by the open round's ticket. `QUANTITY` cancels 1…entry quantity; `REPLACE` needs `replacement`. `409 NO_OPEN_ROUND`, `409 NOT_CONFIRMED`. |
| `DELETE /api/sessions/:id/corrections/:correctionId` | host | — | Take a correction back before its round is confirmed. |
| `POST /api/sessions/:id/participants/:pid/remove` | host | `{ reason? }` (≤140) | Remove a guest: their own open-round entries are soft-deleted, pending claims rejected, readiness and group memberships cleared. `409 CANNOT_REMOVE_HOST`, `409 ALREADY_REMOVED`. The reason is stored for that guest only, never in events. |
| `POST /api/sessions/:id/participants/:pid/restore` | host | — | Undo a removal: the guest and the entries that left with them come back if their round is still open. |
| `GET /api/sessions/:id/summary?date=<label>` | anyone in the order | — | "Who ordered what" as a PNG (confirmed rounds, corrections applied). `date` is a short label formatted on the device (letters, digits, spaces, commas, dots; else an ISO date). Same per-person limit as `/sync`; `413 TOO_LONG` for very large orders (use the text copy); `Cache-Control: private, no-store`. |
| `POST /api/sessions/:id/close` | host | — | End session: read-only, invite stops working, deleted after `CLOSED_RETENTION_DAYS` (7). |
| `GET /api/sessions/:id/events` | participant | — | Server-Sent Events; see realtime.md. `503 TOO_MANY_STREAMS`. |
| `GET /api/health` | anyone | — | `200 { ok, database }` or `503`. |

## Error codes

`NOT_FOUND`, `ENTRY_NOT_FOUND`, `FORBIDDEN`, `FORBIDDEN_ORIGIN`, `SESSION_CLOSED`, `NO_OPEN_ROUND`, `ROUND_CONFIRMED`, `ENTRY_REMOVED`, `CONFLICT`, `UNKNOWN_PERSON`, `TOO_MANY_ENTRIES`, `TOO_MANY_DISHES`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_KEY`, `BAD_JSON`, `TOO_LARGE`, `INVALID`, `RATE_LIMITED`, `INVITE_NOT_FOUND`, `CLAIM_PENDING`, `ALREADY_YOURS`, `CLAIM_NOT_FOUND`, `CLAIM_RESOLVED`, `STALE_REVISION`, `ROUND_NOT_OPEN`, `ROUND_OPEN`, `EMPTY_ROUND`, `NOT_CONFIRMED`, `CORRECTION_NOT_FOUND`, `TABLE_FULL`, `TOO_MANY_STREAMS`, `ROUND_CLOSED` (an add aimed at a round confirmed meanwhile), `ROUND_NOT_FOUND`, `REMOVED` (a guest the host removed), `ALREADY_REMOVED`, `CANNOT_REMOVE_HOST`, `PERSON_NOT_FOUND`, `CLAIM_STALE`, `TOO_LONG` (summary image), `TOO_MANY_ROUNDS`, `TOO_MANY_CORRECTIONS`, `TOO_MANY_GROUPS`, `ALREADY_CANCELLED`, `INTERNAL`.

Idempotency: every change carries `Idempotency-Key`, bound to the change's kind *and target* (e.g. `entry.update:<id>`). Starting and joining an order accept one too, and a retry within 10 minutes gets the same order or guest. `POST …/entries` takes an optional `roundId` (refused with `ROUND_CLOSED` if that round is no longer open), and `PATCH …/entries/:id` takes `quantity`, `variant`, `instructions` and `attribution`. Bodies are capped at 8 KB while being read.



## Pages

| Path | Notes |
|---|---|
| `/` | Landing page (scenes, start, resume, join by code). |
| `/s/:id` | The order (members). Someone not in it is sent to the invite while it's open; a removed guest sees why; otherwise 404. |
| `/s/:id/waiter` | Full-screen waiter ticket. |
| `/privacy`, `/cookies` | Policies, plus the analytics switch. |
| `/ingest/*` | Rewrite to PostHog US (analytics), only used when `POSTHOG_KEY` is set. |
| `/j/:code` | Invite page. Server-rendered metadata and an Open Graph image (`/j/:code/opengraph-image`) with the order's name only; "This order has ended" when closed. Visitors who already belong to the order go straight to it. |
