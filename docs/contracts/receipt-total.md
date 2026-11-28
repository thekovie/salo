# Golden contract: `PUT /api/sessions/:id/receipt-total` and the reconciliation it feeds

Sources: **P** = docs/plans/salo-v1-3.md (A17, A18, A19, D6, D18, Pinned details "NON_TICKET_EVENTS" and "Permissions", M4-3, M4-4), **A** = docs/api.md (route row and shared conventions), **D** = docs/data-model.md, **S** = docs/security.md, **R** = docs/realtime.md, **U** = docs/ux-specification.md (KKB tab, "Check against the receipt"), **B** = the testing brief, **C** = the coordinator's review note (pending cancellation).
Suite: `pnpm vitest run tests/contract-receipt-total.test.ts` (114 scenarios, real Postgres `salo_test`, real route handlers, faked cookie jar). HTTP wiring: `node scripts/contract/receipt-total-http.mjs` (26 checks; needs a dev server on :3000; creates only its own orders).
Body: `{ centavos: int 0..99,999,999 | null, expectedRevision: int >= 0 }`. Success: `200 { data: { result: { revision }, revision, replayed } }` (`result.revision` is the receipt total's own revision, `revision` the session's). Failure: `{ error: { code, message } }` (A).
Revision: `sessions.receipt_total_revision`, 0 on a fresh order, +1 on every applied write (a clear included). A stale or future `expectedRevision` is `409 CONFLICT`. Snapshot: `settlement.receiptTotal = { centavos, revision }`, `null` = not entered, `0` = an entered PHP 0 (D, A).
Every refusal row also means: session revision, events, receipt row and snapshot settlement are unchanged (asserted by a before/after fingerprint).

Interpretations the spec leaves open (suite accepts either): a removed guest gets 403 REMOVED or 404 (S says 403 REMOVED); replaying an applied key after the order closed is 200 or 409 but never re-applies; an exponent integer such as `1e2` is 200 or 422.

## Route: happy path, revision, replay
| # | Scenario | Input | Expected | Side effects | Source |
|---|---|---|---|---|---|
| R01 | Host sets | 160000, rev 0 | 200, result.revision 1, session revision +1, replayed false | one `session.receiptTotal` event; row and snapshot agree | A |
| R02 | Empty order | 12345, rev 0 | 200 | | A |
| R03 | Revision walk | 100, 200, null, then 300 at stale 0, then at 3 | revisions 1, 2, 3; stale 409; then 4 | | A, D |
| R04 | null clears | null | 200, stored NULL (not 0) | | A |
| R05 | Fresh order | | snapshot `{null, 0}` | | D |
| R06 | PHP 0 | 0 | 200, stored 0, snapshot 0 | | A, B |
| R07 | Bounds | 0 and 99,999,999 | 200 | | D (CHECK) |
| R08 | Event payload | | no amount in payload | | R (ids only) |
| R09 | Realtime | | `pg_notify` on `salo_events` within 15 s | | R |
| R10 | Other state | | readiness, entries, rounds, prices, service charge unchanged | | P |

## Conflicts and idempotency
| # | Scenario | Expected | Source |
|---|---|---|---|
| C01 | stale (behind or ahead) rev | 409 CONFLICT, nothing changes | A |
| C02 | After a service-charge change | receipt revision still 0 -> 1 (separate counters) | D |
| I01 | Same key, same body twice | 200 both; second replayed true, same result; applied once; one event | A |
| I02 | Replay after value moved on | first result, no re-apply | A |
| I03 | Same key at once | 200 both, exactly one replayed, applied once | A |
| I04 | Key already used by service-charge | 422 IDEMPOTENCY_KEY_REUSED | A |
| I05 | Receipt key reused on service-charge | 422 IDEMPOTENCY_KEY_REUSED | A |
| I06 | Same key, different body | first result, replayed true, nothing changes | A |
| I07 | Missing / short / space / slash / 101 chars / empty key | 400 IDEMPOTENCY_KEY | A |
| I08 | 8 and 100 char keys | 200 | A |

## Validation (422 INVALID unless noted)
| # | Input | Source |
|---|---|---|
| N01 | centavos -1, -99,999,999, 100.5, 0.1, 99,999,999 + 1, 2^31, 2^53, "100", "₱100.00", "", true, [100], {} | A, D (CHECK) |
| N02 | centavos missing (not a clear) | A |
| N03 | expectedRevision missing, -1, 0.5, "0", null, false, 2^53 | A |
| N04 | `{not json` 400 BAD_JSON; empty body, `[]`, `"text"`, `null`, `{}`, `42` 422; > 8 KB 413 TOO_LARGE | A |
| N05 | `1e400` 422; `1e2` 200 or 422, never 5xx | A |
| N06 | extra fields (revision, role, sessionId) ignored | S |
| N07 | DB CHECK: amount -1 and 100,000,000 rejected; revision -1 rejected; 0 and 99,999,999 accepted | D |

## Authorization and tenancy
| # | Scenario | Expected | Source |
|---|---|---|---|
| A01 | Guest (also with entries) | 403 FORBIDDEN | A, P (`receipt.set` host only) |
| A02 | No cookie, garbage cookie | 404 NOT_FOUND | A identity |
| A03 | Other order's host (also token planted under this order's cookie name) | 404; both orders untouched | S, A |
| A04 | Removed guest | 403 REMOVED or 404 | S |
| A05 | No / foreign / look-alike Origin on PUT /api | 403 FORBIDDEN_ORIGIN (proxy); own origin passes | A CSRF |
| A06 | Unknown or malformed session id | 404 | A |
| C03 | Ended order (a round was confirmed), set or clear | 200; the host can still fix the bill. A cancelled order (nothing confirmed) is 409 SESSION_CLOSED | A |
| C04 | Closed order | host and guest still read the last value | A, U |
| C05 | Replay of applied key after close | 200 or 409, nothing re-applied | A |

## Races
| # | Scenario | Expected | Source |
|---|---|---|---|
| K01 | Two keys, same expectedRevision | one 200, one 409 CONFLICT; one event; revision 1 | A |
| K02 | Eight writers at rev 0 | one 200, seven 409, no 5xx | A |
| K03 | Race with a service-charge write | both 200, both values stored | D |
| K04 | Race with the confirm of the open round | both succeed | P NON_TICKET |

## NON_TICKET and leaks
| # | Scenario | Expected | Source |
|---|---|---|---|
| L01 | Set / change / clear after the host looked, then confirm with the earlier revision | confirm succeeds | P NON_TICKET_EVENTS, R |
| L02 | Control: ticket-changing edit after the host looked | 409 STALE_REVISION | A |
| L03 | Stored ticket snapshots, live tickets, rounds, entries, corrections, invite lookup, Items summary and text, ticket copy text | none carries the amount or "receipt" | S, U |
| L04 | Set and clear | tickets, rounds, entries, Items, stored snapshots byte-identical | S |
| L05 | Set | KKB sections, per-person totals and service charge split unchanged (never distributed) | P A17 |
| V01 | Host and guest `/sync` and `GET /sessions/:id` | both carry `settlement.receiptTotal` | P Permissions |
| V02 | Late joiner; cleared value | sees current value at once; null after clear | P |
| V03 | Stranger / other order's host | 404; invite lookup has no amount | S |
| V04 | Removed guest | 403 or 404, no amount in the body | S |

## Reconciliation (`priceCompleteness`, `saloTotal`, `reconcile`)
| # | Scenario | Expected | Source |
|---|---|---|---|
| Q01 | food 160000 + service 16000 | Salo total 176000 | P A17 |
| Q02-Q05 | receipt = / +3600 / -6000 / +-1 centavo | matches / more 3600 / less 6000 / more or less 1 | P A17, U |
| Q06 | PHP 0 receipt vs 176000 | less by 176000 (an entered 0) | B |
| Q07 | PHP 0 receipt, free dish, charge 0 | matches | B |
| Q08, Q09 | Service charge unset, or 0 | Salo total = food; receipt = food matches, +1 more | P A17 |
| Q10 | Change charge after receipt | Salo total and verdict move | P |
| Q11-Q14 | Any unpriced dish (also receipt = priced food, also charge entered) | `incomplete {unpriced: n}`, never matches; pricing it gives a real verdict | P A17, U |
| Q15, Q16 | 3 x 33.33 + 0.01; uneven split | exact centavos; per-person totals add to Salo total | B, D |
| Q17 | 99 x 99,999.99 vs max receipt | exact, no drift | B |
| Q18 | Charge entered, change pending | Salo total still food + charge | P A17 |
| Q19, Q20 | Priced / unpriced unbilled shared dish | in food / incomplete | P A18 |
| Q21 | Unpriced draft dish | not counted | P |
| Q22 | Removed guest's confirmed dishes | still counted | D |
| Q23 | A cancellation pending with the waiter, charge 0 and entered | verdict is not "matches" | U (pending = reason a total can't be final), C |

## Completeness (A18)
| # | Scenario | Expected | Source |
|---|---|---|---|
| P01 | Same preparation from two people | one dish | P A18 |
| P02 | One of two people's Katsu priced | dish not priced; priced after both | P A18 |
| P03 | Table price | resolves every entry of dish + size | U |
| P04 | Table price for Large | does not resolve Small or plain | U |
| P05 | Table price plus own price; table price removed | priced; then the other entry is unresolved | U |
| P06 | Case/spacing in size and notes | one line; different notes = another | P A18, D |
| P07 | PHP 0 price | priced | B |
| P08 | Shared dish billed to someone | counted once | P A18 |
| P09 | Told replacement | own line, never inherits a table price; priced via correction price | P Pinned (shared prices) |
| P10 | Dish cancelled to nothing | no longer a dish to price | P |
| P11 | No confirmed dishes | 0 of 0 | |
| P12 | `first` | first unpriced line | P A18 |

## Copy summary (`kkbText`, A19, D6)
| # | Scenario | Expected | Source |
|---|---|---|---|
| S01, S02 | All priced, charge split | per person food + service = total; `Total` = Salo total = sum of people; every amount is a KKB amount | P A19, U |
| S03 | Charge not entered | `Total not final`, says not entered | U |
| S04 | Charge 0, all priced | `Total` = food | U |
| S05 | Unpriced dish | `Total not final: 1 dish no price`; listed under Not yet settled | U, P M4-4 |
| S06 | Charge entered, cancellation pending | not final | U |
| S07 | Priced shared dish with no payer | listed; not final | U, P M4-4 |
| S08 | Receipt entered | text never mentions it | U (kkbText body) |
| S09 | Nothing confirmed | no fabricated amount | |
| S10 | Items copy | price-free | P D6 |
| S11 | Charge 0 and a cancellation pending | `Total not final`, no `Total ₱` line | U, C (same rule as S06) |

## Limits
| # | Scenario | Expected | Source |
|---|---|---|---|
| M01 | > 120 changes a minute by one participant | 429 RATE_LIMITED after 100..120 successes; nothing applied after | A |

## Result
112 of 114 vitest scenarios pass; 26 of 26 HTTP checks pass. Two scenarios fail on one bug (pending cancellation with service charge 0 or entered): Q23 and S11. Spec disagreement (not a test): docs/ux-specification.md line 10 says the landing "Copy text" also mentions KKB prices, the service charge and the receipt check, while P D6, S and U line 63 say Items copy is price-free and `kkbText` has no receipt input.
