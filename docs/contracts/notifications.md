# Golden contract: notifications (recipient delivery, privacy, `POST /api/sessions/:id/notifications/read`)

Sources: **P** = docs/plans/salo-v1-3.md (A13, A14, D9, D12, Pinned "Notifications", Assumptions on events/recipients and mark-read), **A** = docs/api.md (read route row, shared conventions), **S** = docs/security.md (Notifications), **D** = docs/data-model.md, **R** = docs/realtime.md, **B** = the testing brief.
Suite: `pnpm vitest run tests/contract-notifications.test.ts` (43 scenarios, real Postgres `salo_test`, real route handlers, faked cookie jar, one raw LISTEN connection for pg_notify).
Read body: `{ ids: uuid[] (1..50) } | { all: true }`. Success: `200 { data: { marked } }` (A). Failure: `{ error: { code, message } }` (A). Delivery: `GET /sync` returns `notifications: { items: [{ id, type, subject, createdAt, readAt }] (latest 50, newest first), unread }` (A, P).
Interpretations the spec leaves open (suite accepts either, never a 5xx): `ids` with duplicates, an unknown extra key, the nil uuid, an uppercase uuid (200 or 422); a body over 8 KB is 413 or 422; a removed guest is 403 REMOVED or 404; `null` body is 422 or 400.
Test-only interpretations, flagged in the scenario name: E03 (each recipient's `subject` numbers are their own), E06b (a table-wide dish with that dish + size makes a price change reach every guest).

## Recipients (every row also means: the actor is never notified of their own action, and a removed guest gets nothing)
| # | Event | Setup | Expected recipients | Source |
|---|---|---|---|---|
| E01 | round confirmed | Ana's dish, Cy removed | Ana, Bea (`round.confirmed`, `subject.roundNumber` 1); not host, not Cy | P, B |
| E02 | round opened | after confirm | all three guests get `[round.opened, round.confirmed]` newest first; host none | P |
| E03 | dish unavailable, draft round | Ana katsu 2, Bea katsu 1, Cy gyoza, host katsu 4 | Ana (removed 2), Bea (removed 1); not Cy, not host | P |
| E04 | dish unavailable, confirmed | individual / table / unassigned / group dishes | individual: owner only; the other three: every guest; host never | P, B |
| E05 | order corrected, told when the round carrying it is confirmed (D22: recording notifies nobody) | one correction on an individual / table / unassigned / group dish; then a batch across Ana + Bea; then confirm | owner only / every guest / each owner; host never | P, A12 |
| E05b | Ana's correction recorded, then the round confirmed | Ana's correction | nobody has a correction update until confirm; then only Ana, once | P (recipients) |
| E06 | table price changed | Ana katsu large, Bea katsu small, Cy gyoza | price for "Large": Ana only; a second change: Ana has 2 (one per change, `subject.centavos` 15000 and 18000); the same price again: still 2 | P |
| E06b | same, table-wide katsu large | | every guest (interpretation) | P |
| E07 | food served | Ana katsu 2 + Bea katsu 1 (one line), Bea gyoza, Cy ramen | no row while partly served; when the line is full: Ana and Bea once, not Cy, not host; full -> not full -> full: still once; another line: its own row | P D9 |
| E08 | everyone who is ordering is ready (D38) | Ana and Bea order, Cy has nothing | host only, when the last guest with something in the round is ready (Cy saying ready or toggling changes nothing); text "Everyone who’s ordering is ready for round N"; toggling ready off/on: still 1; guests never told; next round: a second one | P |
| E08b | removed guest; nobody ordering | Cy removed; Ana ready with nothing ordered | no notice while nobody is ordering; host told once Ana and Bea are ready | P, B |
| E09 | order ended | Cy removed; guest tries to end it | guest close is 403 with no rows; then Ana and Bea get `order.ended`; not host, not Cy | P |
| E09b | order ended with nothing confirmed | | every guest | P |
| E10 | routine dish additions, edits, remove/restore, partial ready, by host and guests, all attribution kinds | | no notification rows at all | P, B |
| E11 | late joiner / removal | Dee joins after events; Cy removed, then another round confirmed and opened | Dee starts `{ items: [], unread: 0 }`; removing Cy writes no row; Cy gets nothing afterwards | P |
| E14 | payment recorded / deleted (D30, D31) | host records ₱500 from Ana (participant), then from a typed name, then deletes the first | Ana only: `payment.recorded`, target "kkb", text "<host> recorded ₱500.00 from you", dedup `payment:<id>`; none for the typed name or the host's own card; deleting the payment deletes the notice | S5 D30 D31 |
| E15 | claim leaves a payment paid to its own payer (S5 follow-up 2) | Ana pays typed Rafa; Ana claims Rafa; host fixes the payee | host only: `payment.needsReview`, target "kkb", text "<claimant>’s claim left a ₱500.00 payment paid to themself. Fix it on KKB.", dedup `payment-review:<id>`, source `payment:<id>` + `payment-review:<id>`; fixing the payee or deleting the payment deletes it; replaying the approval adds none | S5 addendum |
| E16 | host handed over (F09) | host hands to Jun | Jun only: `host.transferred`, text "<old host> made you the host."; not Liza, not the old host; a retried key adds none | S6 |
| E13 | co-host set / revoked (D18) | host sets Ana, again (no-op), revokes, sets again | Ana only: `participant.cohostSet` x2 and `participant.cohostRevoked` x1 (target "served" for set); text names the host; not Bea, Cy, host | S3 D18 |
| E12 | refused or rolled back change | stale confirm (409), guest marks unavailable (403), unknown dish (404) | no notification rows | P (same transaction), A14 |

## Undo
| # | Scenario | Expected | Source |
|---|---|---|---|
| U01 | Mark unavailable on draft dishes, mark the update read, restore both entries, do it again | the update is gone (read or not); the round confirmed/opened updates stay; the second time it is delivered again | P |
| U02 | Record a correction, take it back; a batch across Ana + Bea, take it back; confirm the round | no correction update exists at any point; confirming tells nobody | P |
| U03 | Serve to full, un-serve, serve again | "all served" stays and is not repeated | P D9 |

## Privacy
| # | Scenario | Expected | Source |
|---|---|---|---|
| P01 | each participant's snapshot | exactly their own rows (ids = DB rows of the recipient), unread = their unread, item keys `createdAt id readAt subject type`; no id appears in two snapshots; a replacement text only in the affected person's | S, A |
| P02 | Ana posts Bea's and host's ids; mixed with her own; Cy `all`; host posts Ana's ids | `{ marked: 0 }`, then `{ marked: 1 }`; nobody else's row changes | S, A, B |
| P03 | another order's ids with own token; both tokens on the other order's URL | `{ marked: 0 }`; 404 on read and sync; other order's data byte-identical | S, A |
| P04 | removed guest: sync, read `all`, read `ids` | 403/404, no data, rows and unread untouched; ending the order later writes nothing for them | S, B |
| P05 | event payloads, mutation results, invite lookup | contain no notification id, no notification text, no replacement text, no `subject`/`notifications` key | B, R |

## Cap, unread, dedup
| # | Scenario | Expected | Source |
|---|---|---|---|
| D01 | 60 rows for Ana, 3 for Bea | Ana: 50 items, the newest (60 down to 11), `unread` 60; Bea: 3; marking the 10 hidden oldest ids: `marked 10`; then `all`: 50 | A, P |
| D02 | same Idempotency-Key twice on mark unavailable | `replayed` true the second time, one row per recipient | A, P |
| D03 | ready toggled repeatedly | one `guests.ready` | P (dedup key) |

## `POST /notifications/read`
| # | Scenario | Input | Expected | Side effects | Source |
|---|---|---|---|---|---|
| M01 | ids | one unread id | 200 `{ data: { marked: 1 } }` | `readAt` set, `unread` 2, others unread | A |
| M02 | idempotent | same id again; unknown uuids; 50 ids; `all` twice; host `all` | `marked` 0 / 0 / 0 / 2 / 0 / 0 | `read_at` never moves | A, P |
| M03 | bad bodies | `{}`, `ids: []`, non-uuid, SQL-ish string, number, null, string; one valid + one bad; 51 ids; 200 ids; 1000 ids; `all` false/"true"/1/null; `[]`, `"text"`, `null`, `42` | 422 (413 for > 8 KB, 400 or 422 for `null`) with `error.message` | nothing changes | A |
| M03b | `ids` and `all` together | `{ ids: [id], all: true }`, `{ ids: [], all: true }` | 422 | nothing changes | A, B |
| M03c | not JSON / empty | `{not json`; `""` | 400 BAD_JSON; 422 | | A |
| M04 | identity | no cookie, garbage cookie, 64-char junk, a stranger's tokens | 404 NOT_FOUND | nothing changes | A |
| M05 | Origin | none / foreign / other port; own origin | 403 FORBIDDEN_ORIGIN (proxy); own passes | | A |
| M06 | closed order | after ending | readable in sync (`order.ended` first, unread 4); read works | | P, A |
| M07 | no revision, no event | 7 reads (ids, repeats, all, `{}` refusal, other participant, with an Idempotency-Key) | session revision, `session_events`, the session row and `mutation_records` unchanged; the only NOTIFY on `salo_events` is the control change's | | A, R, P |
| M08 | pending confirm | host looks, everyone reads, host confirms with the old revision | 200; control: a ticket change in between gives 409 STALE_REVISION | | P NON_TICKET, B |
| M09 | revision in the snapshot | read `all` | `session.revision` equal, `unread` 3 -> 0 | | R |
| M10 | rate limit | > 120 reads a minute by one participant | 429 RATE_LIMITED after 100..120 successes; a limited `all` marks nothing; another participant still works | | A |

## Database
| # | Scenario | Expected | Source |
|---|---|---|---|
| G01 | duplicate (session, recipient, dedup_key) | refused; other recipient or key fine | D |
| G02 | recipient from another order, on INSERT and UPDATE of `recipient_id` or `session_id` | refused by the trigger | D |
| G03 | delete session | its rows go, another order's stay | P Tests, D |
| G04 | delete participant | their rows go, others stay | D |

## Result
42 of 42 scenarios pass. M03b (`{ ids, all: true }`) was a bug and is fixed: both bodies are 422.
