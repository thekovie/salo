# Golden contract: v1.4 slice 3 (co-hosts and safe serving), independent suite

Sources: **P** = docs/plans/salo-v1-4.md "Slice 3" (Approach, States, D17-D21, Assumptions), **B** = docs/plans/salo-v1-4-brief.md F04 (:382-440) and F12 (:762-800), **A** = docs/api.md. Derived from the spec, not the code. The per-endpoint contracts remain docs/contracts/serving.md and docs/contracts/cohosts.md; this file is the black-box golden set that must keep passing.
Suite: `perl -e 'alarm shift; exec @ARGV' 300 pnpm vitest run tests/contract-slice3-golden.test.ts` (37 scenarios, real route handlers, real Postgres `salo_test`, per-request cookie jar so two people call at once; exit 142 = timeout = FAIL). Every refusal row also asserts a before/after fingerprint: session revision, events, `served_counts`, `food.served` notifications unchanged.
"Between auth and the lock" is simulated with real concurrent transactions: a holder takes the session row lock, the route call passes `requireActor` and queues behind it (confirmed via `pg_stat_activity` lock wait), the holder changes the row and commits.

## POST /api/sessions/:id/serving  `{roundId, lineKey, delta, expectedServed}`
| # | Scenario | Expected | Side effects | Source |
|---|---|---|---|---|
| S01 | Co-host serves +2 (saw 0) | 200 `{served:2, applied:true}` | `updated_by` = co-host; event `serving.updated {roundId, actorId}` | P S3.1, S3.10, B |
| S02 | Guest, also with a stale count | 403 FORBIDDEN | nothing changes | P S3.2, B table |
| S03 | Revoked co-host | 403 FORBIDDEN | nothing changes | P S3.6, B |
| S04 | Revoke commits between auth and lock | 403 FORBIDDEN | nothing changes | P S3.6, D20, B F12 |
| S05 | Promotion commits between auth and lock | 200 (fresh role decides serving) | row written | P D20 |
| S06 | Removed co-host; then Undo | 403 REMOVED; after Undo 403 FORBIDDEN (plain guest) | | P Assumptions |
| S07 | Co-host calls close, open round, service charge, remove, assign, revoke self, confirm | 403 each | nothing changes; marks unchanged | B table, P S3.2 |
| S08 | Other order's host/guest/co-host token (both directions); assign across orders | 404 (422 allowed for a foreign round id) | no rows, no mark | security |
| P01 | Two co-hosts, same seen count 0, parallel | both 200; exactly one `applied:true`; other `applied:false` with current count | row `served 1, revision 1, updated_by` winner | P S3.7, D3, B F12 |
| P02 | Five parallel taps by three servers, all saw 0 | all 200, one applies, all answers 1 | row revision 1 | P S3.7 |
| P03 | Stale tap | 200 `applied:false`, `served` = current, row revision = row's | row identical; session rev +1; one event | P Approach (D3) |
| P04 | Stale tap whose delta would complete the line | `applied:false` | no `food.served` notification | P Approach |
| P05 | Replay of an applied key after the count moved | 200 `replayed:true`, stored result | count not re-applied | P S3.9, B |
| P06 | Replay of a stale batch after the count matches what it saw | `replayed:true`, `applied:false` | nothing applied | P S3.9 |
| P07 | Same key, same body, 3 at once | 200 x3, 2 replayed | applied once | B |
| P08 | Clamping: +99, -99, +1 at max, -1 at 0 | 5, 0, 5, 0 with `applied:true` | row within 0..expected | P S3.8, B |
| P09 | `expectedServed` above expected | `applied:false` (not a clamp) | nothing | P Approach |
| P10 | `expectedServed` missing, -1, 0.5, "0", null, [0] | 422 INVALID | nothing changes | P Assumptions |
| P11 | Closed order, host and co-host | 409 SESSION_CLOSED | nothing changes | A |
| P12 | Serving, stale serving, and co-host events after the host looked | host's Confirm with the older revision still 200 | | P Approach (NON_TICKET_EVENTS) |

## Every other mutation: role guard (D20)
| # | Scenario | Expected | Source |
|---|---|---|---|
| R01 | Role moves (host demoted, guest promoted) between auth and lock; guest `PUT readiness` | 403 ROLE_CHANGED; no mutation record | P D20 |
| R02 | Co-host mark removed between auth and lock; same guest write | 200 (mark is not a role) | P D20 |
| R03 | Replay of an earlier write, role moved meanwhile | 200 `replayed:true` (replay precedes the guard) | P Approach "Lock re-check" |

## PUT /api/sessions/:id/participants/:pid/cohost  `{cohost: boolean}`
| # | Scenario | Expected | Side effects | Source |
|---|---|---|---|---|
| C01 | Host assigns | 200 `{cohost:true}`, `replayed:false` | mark set; everyone's snapshot shows `participants[].cohost`; `me.cohost` only for that guest; event `participant.cohostSet {participantId}` | P S3.3, S3.11, B |
| C02 | Revoke | 200 | mark null; `participant.cohostRevoked`; plain guest | P |
| C03 | Same value again, new keys (assign, revoke, revoke of a never co-host) | 200 no-op | mark keeps its time; no second notification | P Approach |
| C04 | Guest or co-host caller | 403 FORBIDDEN | nothing changes | B table |
| C05 | Target host (both values); removed; unknown, other order's person, bad uuid | 409 NOT_A_GUEST; 409 ALREADY_REMOVED; 404 PERSON_NOT_FOUND | nothing changes | P Approach |
| C06 | Closed order, assign and revoke | 409 SESSION_CLOSED | marks stay and stay visible | P Assumptions |
| C07 | Body `{}`, "yes", null, 1, [], "x"; no cookie; no idempotency key | 422; 404; 400 IDEMPOTENCY_KEY | nothing changes | A |
| C08 | Remove co-host, Undo, re-assign | removal clears mark; Undo = plain guest; re-assign notifies | 2 notifications total | P Approach, Assumptions |
| C09 | Assign, revoke, assign | 3 notifications to that guest only, exact D18 copy | host and others get none | P D18 |
| C10 | Retried key | applied once, replays | one event, one notification | A |
| C11 | 4 racing assigns; 4 racing mixed assign/revoke | all 200; one notification; final mark matches the last event | | B F12 |
| C12 | Assign racing removal of the same guest | assign 200 or 409, removal 200; never a 5xx | no removed co-host | P Approach (CHECK) |
| C13 | Co-host removed between auth and lock of a serving write | 403 REMOVED | no served row | P S3.6 |
| C14 | Revoke racing the co-host's serve | serve 200 or 403 (never 5xx); afterwards serving refused | row 1 iff serve was 200 | B F12 |

## Result
37/37 pass on branch feat/v1-4-slice3-cohosts (3 consecutive runs; the existing contract-serving and contract-cohosts suites, 73 tests, also pass).
