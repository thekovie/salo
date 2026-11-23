# Golden contract: `PUT /api/sessions/:id/participants/:pid/cohost` (co-hosts)

Sources: **P** = docs/plans/salo-v1-4.md (Slice 3: F04, D17-D21), **A** = docs/api.md, **S** = docs/security.md, **D** = docs/data-model.md, **R** = docs/realtime.md.
Suite: `pnpm vitest run tests/contract-cohosts.test.ts` (14 scenarios, real Postgres `salo_test`, real route handler, faked cookie jar). What a co-host may do on `/serving` is in docs/contracts/serving.md (H01-H07); the notification text and targets are also in docs/contracts/notifications.md (E13).
Body: `{ cohost: boolean }`. Success: `200 { data: { result, revision, replayed } }`. Failure: `{ error: { code, message } }` (A). Host only; a co-host is a guest who may also update served counts and nothing else.

| # | Scenario | Expected | Source |
|---|---|---|---|
| C01 | Host makes a guest a co-host | 200; `cohost_at` set; every snapshot shows `participants[].cohost` (and the guest's `me.cohost`); event `participant.cohostSet` carries ids only | P, A, R |
| C02 | Revoke | mark cleared; `participant.cohostRevoked` | P |
| C03 | Same value again | 200 no-op: same event type, no second notification, the mark keeps its time | P (D21) |
| C04 | A guest or a co-host assigns | 403 FORBIDDEN; nothing changes | P, S |
| C05 | The host as target | 409 NOT_A_GUEST | A |
| C06 | A removed guest | 409 ALREADY_REMOVED (never a 500 from the CHECK) | A, D |
| C07 | Unknown or foreign person, bad uuid | 404 PERSON_NOT_FOUND | A |
| C08 | Body not `{ cohost: boolean }`; no cookie | 422; 404 | A |
| C09 | Closed order | 409 SESSION_CLOSED; the mark stays | A |
| C10 | Retried idempotency key | applied once, replays | A |
| C11 | Remove a co-host; Undo | mark cleared on removal; Undo brings back a plain guest | P, D |
| C12 | Direct insert of a co-host who is the host or removed | rejected by the `participants_cohost_ck` CHECK | D |
| C13 | Co-host events | non-ticket: a pending Confirm stays fresh | P, R |
| N01 | Notifications | only that guest, with the host's name; assigning again after a revoke tells again | P (D18) |

## Result
All 14 vitest scenarios pass.
