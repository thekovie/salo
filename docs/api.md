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
| `GET /api/health` | anyone | — | `200 { ok, database }` or `503`. |

## Error codes

`NOT_FOUND`, `ENTRY_NOT_FOUND`, `FORBIDDEN`, `FORBIDDEN_ORIGIN`, `SESSION_CLOSED`, `NO_OPEN_ROUND`, `ROUND_CONFIRMED`, `ENTRY_REMOVED`, `CONFLICT`, `UNKNOWN_PERSON`, `TOO_MANY_ENTRIES`, `TOO_MANY_DISHES`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_KEY`, `BAD_JSON`, `TOO_LARGE`, `INVALID`, `RATE_LIMITED`, `INTERNAL`.

Endpoints for joining, events, rounds, claims and corrections arrive with M2–M4.
