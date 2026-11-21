# Golden contract: `POST /api/sessions/:id/serving` (food tracker served counts)

Sources: **P** = docs/plans/salo-v1-3.md (A15, A16, D9, D10, D16, Pinned details "Served counts", NON_TICKET_EVENTS, Permissions, Tests), **A** = docs/api.md (route row and shared conventions), **S** = docs/security.md, **D** = docs/data-model.md, **R** = docs/realtime.md, **B** = the testing brief.
Suite: `pnpm vitest run tests/contract-serving.test.ts` (52 scenarios, real Postgres `salo_test`, real route handler, faked cookie jar). HTTP wiring: `node scripts/contract/serving-http.mjs` (needs a dev server on :3000; creates only its own orders; ends with the limiter, so run it on its own).
Body: `{ roundId: uuid, lineKey: string (1..600), delta: int, delta != 0 }`. Success: `200 { data: { result: { served, revision }, revision, replayed } }` (`result.revision` is the served row's own revision, `revision` the session's). Failure: `{ error: { code, message } }` (A).
Line key (D, P D9/D16): a preparation = `JSON.stringify([dishId, normalizedSize, normalizedNotes])`, or after a told swap `to:<normalized replacement text>`. A line lives in its source entry's confirmed round.
Expected (never stored): sum of `effectiveEntry` quantities of the line's confirmed entries; only corrections told to the waiter (target round CONFIRMED) count (D, P).
Write rule (A): stored = `clamp(min(served, expected) + delta, 0, expected)`.

Every refusal row also means: session revision, events, served rows and the snapshot's `servedCounts` are unchanged (asserted by a before/after fingerprint).

Interpretations the spec leaves open (suite accepts either, never a 5xx): unknown `roundId` or another order's round is 404 or 422; the `delta` bound is not documented, so only "huge" (>= 1,000,000, 2^53, 1e21) is asserted as refused; a line whose expected fell to 0 or whose original was swapped away is either 404 LINE_NOT_FOUND or 200 with served 0; a clamped no-op write is not asserted to bump or not bump the revision.

## Happy path and clamping
| # | Scenario | Input | Expected | Side effects | Source |
|---|---|---|---|---|---|
| V01 | Host serves one | Katsu line (2 + 3), +1 | 200, `{served:1, revision:1}`, session rev +1, replayed false | one `serving.updated` event; snapshot `servedCounts` = raw row | A |
| V02 | Top clamp | +3, +99, +1; Gyoza (1) +7 | 3, 5, 5; 1 | raw row 5 | A, P |
| V03 | Bottom clamp | -1 at 0; +3 then -999 | 200 with 0; 3; 0 | row never < 0 | A, P |
| V04 | Arithmetic | +2, +1, -1 | 2, 3, 2; row revision rises each change | | A, D |
| V05 | Line identity | size case/spacing, notes case, other size, second round | same size/notes = one line (sum); other notes/size = other line; round 2 same preparation = own line | | D, P D9 |
| V06 | Pending corrections | open round 2 holds a cancel (3) and a swap | expected still 5 (+99 -> 5); swap line `to:pork katsu` is 404 LINE_NOT_FOUND | | B, P D5 |
| V07 | Told cancellation below served | served 5, cancel 3 told in round 2 (expected 2) | snapshot keeps raw 5; Items shows 2; next -1 -> 1 (stored 1); then +5 -> 2 | | P, D, B |
| V08 | Same, +1 | raw 5, expected 2, +1 | 200, served 2, stored 2 | | A |
| V09 | Told replacement (unavailable with replacement) after 2 of 5 were served (D21) | "Pork  KATSU" | own line `to:pork katsu`, starts at 0, clamps at 3 (5 - 2 already served); original line 404 or 200/0 | | P, D16, D21, D |
| V10 | Two swaps, same text | both Katsu entries -> "Pork Katsu"; key spelled `"  pork   KATSU "` normalized | one line, expected 5 | one served row | P, D |
| V11 | Swap told in round 2 for a round 1 dish | | line lives in round 1 (404 in round 2); untouched Katsu entry stays its own line (3) | | D19, D |
| V12 | Guest `/sync` | | `servedCounts` raw, visible | | P (guests read-only) |
| V13 | Clamped no-op | at 5, +1 | 200, served 5, stored 5 | | A |

## Idempotency
| # | Scenario | Expected | Source |
|---|---|---|---|
| I01 | Same key, same body twice | 200 both; second `replayed:true`, same result and revision; applied once; one event | A |
| I02 | Replay after the count moved on | returns first result; no re-apply, no rollback | A |
| I03 | Same key twice at once | 200 both, exactly one replayed; applied once | A |
| I04 | Same key on another line | 422 IDEMPOTENCY_KEY_REUSED, nothing applied (key bound to round + line) | A |
| I05 | Same key already used by service-charge | 422 IDEMPOTENCY_KEY_REUSED | A |
| I06 | Missing / short / space / slash / 101-char key | 400 IDEMPOTENCY_KEY | A |

## Validation (422 INVALID unless noted)
| # | Input | Source |
|---|---|---|
| N01 | delta 0, 1.5, -0.5, "1", null, true, [1], {}, missing, +/-1,000,000, 2^53, +/-1e21, MAX_SAFE_INTEGER, Infinity (null in JSON) | A (`int != 0`), B (non-integer or huge) |
| N02 | roundId "", non-uuid, null, number, missing, {}; lineKey "", null, number, missing, {}, []; lineKey 601 chars (404 or 422) | A |
| N03 | lineKey with NUL: 404 or 422, never 5xx, no row | A (text may not contain NUL) |
| N04 | `{not json` 400 BAD_JSON; `[]`, `"text"`, `{}` 422; > 8 KB 413 TOO_LARGE | A |
| N05 | +10 and -10 are valid and clamp | A |

## Authorization and tenancy
| # | Scenario | Expected | Source |
|---|---|---|---|
| A01 | Guest (also one with entries on the line), +1 and -1 | 403 FORBIDDEN | A, P Permissions (`serving.update` host only) |
| A02 | No cookie / garbage cookie | 404 NOT_FOUND | A identity |
| A03 | Other order's host token, both directions | 404 NOT_FOUND; neither order changed | S, A |
| A04 | Removed guest | 403 or 404 | S |
| A05 | No / foreign Origin on non-GET /api | 403 FORBIDDEN_ORIGIN (proxy); own origin passes | A CSRF |

## Scoping and state
| # | Scenario | Expected | Source |
|---|---|---|---|
| C01 | Closed order | 409 SESSION_CLOSED, count stays | A |
| C02 | DRAFT round (open one with dishes) | 409 ROUND_NOT_CONFIRMED (or 404 LINE_NOT_FOUND when the line is not in it) | A |
| C03 | First never-confirmed round | 409 ROUND_NOT_CONFIRMED | A |
| C04 | Unknown line: random text, other dish, other notes, other size, unknown `to:`, a round-1 line in confirmed round 2 | 404 LINE_NOT_FOUND | A |
| C05 | Round from another order (own valid line key and a foreign one), unknown round uuid | 404 or 422; other order's counts untouched | B |
| C06 | Line cancelled to 0 by Mark unavailable | 404 LINE_NOT_FOUND or 200 with served 0; never > 0 | P D16, B |

## Races and realtime
| # | Scenario | Expected | Source |
|---|---|---|---|
| K01 | 8 parallel +1 on a fresh line (no row yet), expected 5 | all 200 (no PK-conflict 500); answers sorted = 1,2,3,4,5,5,5,5; final 5; one row | P ("served <= expected under concurrency"), B |
| K02 | 4 parallel +1 | answers 1..4, final 4 | B |
| K03 | 8 parallel -1 from 5 | all 200; answers 0,0,0,0,1,2,3,4; final 0 | B |
| K04 | Mixed parallel deltas | all 200, every answer and the final in 0..5; snapshot = DB | B |
| K05 | Parallel writes on two lines | both land | B |
| K06 | A write racing the confirm of a told cancellation | both succeed; stored 2 or 5; next -1 -> 1 | P, B |
| K07 | Committed change | `pg_notify` on `salo_events` within 15 s | R |

## Isolation from ticket, KKB, Items, staleness
| # | Scenario | Expected | Source |
|---|---|---|---|
| L01 | Stored ticket snapshots, live `/sync` tickets, invite lookup | contain no `served`, `lineKey`, `serving`; `serving.updated` payload has no `served`/`delta` | P, R ("never touches the ticket") |
| L02 | Serve, serve, un-serve | KKB, Items, tickets, entries, corrections, settlement, readiness, stored snapshots byte-identical | B, P (A15 "independent from KKB") |
| L03 | Confirm of the open round with an earlier revision after three serving writes | succeeds | P NON_TICKET_EVENTS, R |
| L04 | Control: a ticket edit after the host looked | 409 STALE_REVISION | A |
| L05 | Serving | does not reset anyone's readiness | B |

## DB guards and retention
| # | Scenario | Expected | Source |
|---|---|---|---|
| G01 | Insert row for a round of another session; served -1; revision 0; duplicate key | rejected (trigger / CHECK / PK) | D, B |
| G02 | UPDATE moving a row to another session's round | rejected (trigger) | D |
| G03 | Delete session | its rows go; another order's stay | P Tests (cascade), D |
| G04 | Delete round | its rows go | D ("cascades from session and round") |

## Limits
| # | Scenario | Expected | Source |
|---|---|---|---|
| M01 | > 120 changes a minute by one participant | 429 RATE_LIMITED after 100..120 successes | A, P |

## Result
All 52 vitest scenarios and 22 HTTP checks pass; no bugs claimed.
