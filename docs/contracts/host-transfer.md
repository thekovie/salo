# Golden contract: `PUT /api/sessions/:id/host` (hand the order to another guest)

Sources: **P** = docs/plans/salo-v1-4.md (Slice 6: F09), **A** = docs/api.md, **S** = docs/security.md, **D** = docs/data-model.md, **R** = docs/realtime.md.
Suite: `pnpm vitest run tests/contract-host-transfer.test.ts` (14 scenarios, real Postgres `salo_test`, real route handler, faked cookie jar). Notification text: docs/contracts/notifications.md (E16).
Body: `{ participantId: string, displayName?: string }`. Success: `200 { data: { result: { hostId }, revision, replayed } }`. Failure: `{ error: { code, message } }` (A). Host only.

| # | Scenario | Expected | Source |
|---|---|---|---|
| H01 | Host hands to a guest (a co-host) | 200; roles swap, one HOST, both co-host marks clear; snapshot shows the new roles; event `host.transferred` carries ids only and is non-ticket | P, A, D, R |
| H02 | Guest or co-host hands over | 403 FORBIDDEN; nothing changes | P, S |
| H03 | To yourself | 422 ALREADY_HOST | A |
| H04 | A removed guest | 409 ALREADY_REMOVED (never a CHECK error) | A, D |
| H05 | Unknown, foreign or typed person | 404 PERSON_NOT_FOUND | A |
| H06 | Bad body; no cookie | 422; 404 | A |
| H07 | Ended order | 409 SESSION_CLOSED | A |
| H08 | Retried idempotency key | applied once, replays, one notice | A |
| H09 | Old host writes afterwards | 403 FORBIDDEN | S |
| H10 | Write in flight from the old host while a transfer lands | 403 ROLE_CHANGED; the new host's write lands | S (D20) |
| H11 | Two transfers at once | exactly one wins, the other 403 ROLE_CHANGED; one HOST | D |
| H12 | `displayName` given | old host renamed (trimmed), notice uses it; over 40 chars 422 | P |
| H13 | New host had pending claims | closed (rejected) | P |
| N01 | Notification | only the new host: "<old host> made you the host." | P |

## Result
All 14 vitest scenarios pass.

## Adversarial additions (D38 and host transfer)
Suite: `pnpm vitest run tests/contract-host-transfer-adversarial.test.ts` (50 scenarios). Every failed request also asserts the fingerprint (session row, events, mutation records, notifications, participants, claims) is unchanged. Race scenarios hold the session lock and fire requests in a known queue order (`holdLock`).

| # | Scenario | Expected | Source |
|---|---|---|---|
| A01-A03 | Hand over to a guest / a co-host / back and forth | 200 `{hostId}`; one HOST; both co-host marks null; revision +1; one event `{fromId,toId}`; each hand-over notifies the new host once | P S6.10, S6.12, S6.15, D40 |
| B01-B04 | Guest or co-host caller; no/garbage/foreign cookie; removed caller; foreign Origin | 403 FORBIDDEN; 404; 403 or 404; proxy 403 FORBIDDEN_ORIGIN; nothing changes | P S6.11, S |
| C01-C04 | Self (with a displayName); removed; unknown, foreign, non-uuid, SQL-ish id; ended order | 422 ALREADY_HOST (before rename); 409 ALREADY_REMOVED; 404 PERSON_NOT_FOUND; 409 SESSION_CLOSED | P, A, D41 |
| D01-D06 | Wrong-typed or missing body, malformed JSON; no Idempotency-Key; displayName trimmed, empty, blanks, 41 chars, exactly 40, null; extra fields | 4xx never 5xx; 400; rename before demotion and notice uses it; 422 and no transfer; 40 accepted | P, A |
| E01-E02 | Replay of the key; the same key for another target | replayed, one event, one notice; never hands over to the second person | P States "Two transfers" |
| E03-E05 | Two transfers in flight; unsynchronised concurrent; transfer racing a hand-back | first wins, second 403 ROLE_CHANGED (queued) or ROLE_CHANGED/FORBIDDEN (unsynchronised); always one HOST, one event | P S6.12 |
| E06-E09 | Old host writes after commit (rename, title, confirm, price, close, transfer); in flight (rename, confirm); raw role swap under a queued transfer | 403 FORBIDDEN, nothing lands; 403 ROLE_CHANGED, nothing lands, new host's write lands at once | P S6.14 |
| E10 | Demoted host reads | 200, `me.role` GUEST; new host HOST | P S6.10 |
| Q01-Q03 | Target removed / made co-host / order closed while the transfer waits for the lock | 409 ALREADY_REMOVED; 200 with mark cleared; 409 SESSION_CLOSED | P S6.12 |
| F01-F05 | Target's pending claims; NON_TICKET event (new host's confirm with the old revision, with a stale control); notice recipients/text/target; failed transfers; event payload | claim REJECTED with resolved time, another's stays PENDING; 200 (control 409 STALE_REVISION); only the new host, "Kovie made you the host.", target order; no rows; ids only | P S6.13, S6.15 |
| G01-G15 | D38 readiness notice: passive guest; nobody ordering; ready-without-ordering; table/unassigned dishes; typed name match; dish for someone else; typed stranger; group members; per round and round number; dish added for a passive guest; old host after transfer; host's own tap; deleted dish and confirmed round; ready row of the new host; bad bodies | fires once, host only, "Everyone who’s ordering is ready for round n"; never with nobody ordering; table/unassigned and deleted/old-round dishes do not make anyone ordering | P D38 |

Notes: the notice copy uses a typographic apostrophe (`who’s`), the plan's text uses `who's`; the golden follows the code and the neighbouring notices.
