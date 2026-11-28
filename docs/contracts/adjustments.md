# Golden contract: `PUT|DELETE /api/sessions/:id/adjustments/:adjustmentId`, billing after End (D1), snapshot `settlement.adjustments`

Sources: **P** = docs/plans/salo-v1-4.md (slice 2: ask ledger S2.x, Approach, Pinned details, D1), **A** = docs/api.md, **D** = drizzle/0013_adjustments.sql, **R** = receipt-total contract convention (events carry ids only), **B** = brief docs/plans/salo-v1-4-brief.md F02/F03.
Suites: `tests/contract-adjustments.test.ts` (66 scenarios), `tests/contract-billing-after-end.test.ts` (34 scenarios); pure math stays in `tests/adjustments.test.ts`. Real Postgres `salo_test`, real route handlers, faked cookie jar.
PUT body: `{ expectedRevision: int >= 0, direction: discount|charge, category: senior|pwd|privilege|promo|other, note?: string(40), amountCentavos 1..99,999,999 | percentBps 1..10000 (exactly one), method: proportional|equal|individual|manual|unallocated, shares: [{ participantId | billToLabel(1..40), amountCentavos? }] (max 30) }`. DELETE body: `{ expectedRevision: int >= 1 }`. Success: `200 { data: { result: { adjustmentId, revision }, revision, replayed } }`. The id is client chosen (uuid) so a retry never duplicates; `expectedRevision 0` creates.
Every refusal row also means: session revision, events, adjustment rows, share rows, receipt total and service charge are unchanged (asserted by a before/after fingerprint).
Interpretations the spec leaves open (suite accepts either): a removed guest gets 403 REMOVED or 404; an edit (rev > 0) after a concurrent delete is 404 and a delete after a concurrent edit is 409 (order dependent); an add by a guest after End is 403 or 409.

## Adjustments route
| # | Scenario | Expected | Source |
|---|---|---|---|
| J01 | Host creates, edits (switching method replaces shares), deletes | 200 each; revision 1, 2; snapshot shows it to host and guest | P, A |
| J02 | Guest PUT or DELETE | 403 | P |
| J03 | Stale revision, or create (rev 0) over an existing id | 409 CONFLICT | A |
| J04 | Unknown id, non-uuid id, id of another order (PUT edit, PUT create, DELETE) | 404 ADJUSTMENT_NOT_FOUND; other order's row untouched | A, P |
| J05 | Person from another order | 404 PERSON_NOT_FOUND; trigger rejects a direct insert | D |
| J06 | Manual shares not adding up; percent with manual or unallocated; both or neither of amount/percent; no people; unallocated with people; amount 0 | 422 | P |
| J07 | Same key twice | `replayed: true`, applied once | A |
| J08 | 21st adjustment | 400 TOO_MANY_ADJUSTMENTS | P |
| J09 | Ended order (a round was confirmed) | 200 for create, edit, delete | P D1 |
| J10 | Cancelled order (closed, nothing confirmed) | 409 SESSION_CLOSED on create, edit and delete; earlier row stays | P |
| J11 | Events `adjustment.set` / `adjustment.removed` | non-ticket: Confirm with the earlier revision still passes | P |
| J12 | Approving a claim | typed-name shares become the guest's `participant_id` | P |
| V01 | Amount 0, -5, 1.5, "5000", 100,000,000; percent 0, 10001, -1, 12.5; note 41 chars; bad direction, category, method; bad share shapes; bad expectedRevision; each required field missing | 422 INVALID, nothing stored | P, D |
| V02 | Percent+manual/unallocated, individual with 0 or 2, unallocated with people, equal/proportional with none, amounts on non-manual, manual without amounts or negative, duplicate person, duplicate name (case/space), 31 people | 422 | P |
| V03 | Boundaries: percent 1 and 10000, amount 1 and 99,999,999, 40-char note and name, 30 people, manual sum exact, percent proportional, charge + other + unallocated | 200 | P, D |
| V04 | Note `"  Lola   birthday "` stored tidied; blank note stored none; a note that grows past 40 characters after NFKC tidying | 200 tidied; 200 null; **422, never 5xx** | D (CHECK 1..40), P (pinned: length checked again after tidying) |
| V05 | Typed name tidied; a name that grows past 40 after tidying | stored tidied; 422 | P |
| V06 | NUL in note or name | 422 | A |
| V07 | Extra fields (revision, sessionId, role, id) | ignored | S |
| V08 | DELETE body with expectedRevision 0, -1, 1.5, "1", missing, `[]`, `null` | 422 | A |

## Transport, auth and tenancy
| # | Scenario | Expected | Source |
|---|---|---|---|
| T01 | `{not json` / body over 8 KB / empty / `[]` / `null` | 400 BAD_JSON / 413 TOO_LARGE / 400 or 422 / 422 / 422 | A |
| T02 | Idempotency-Key missing, short, with space or slash, 101 chars, empty (PUT and DELETE); 8 chars | 400 IDEMPOTENCY_KEY; 200 | A |
| T03 | Missing or foreign Origin on PUT and DELETE | 403 FORBIDDEN_ORIGIN (proxy); own origin passes | A |
| T04 | Malformed or unknown session id | 404 | A |
| Z01 | No cookie, garbage cookie | 404, nothing stored | A |
| Z02 | Another order's host (also its token under this order's cookie) on create, edit, delete | 404; both orders untouched | S |
| Z03 | Guest PUT create, edit, DELETE | 403 FORBIDDEN, state unchanged | P |
| Z04 | Guest after End | 403 | P |
| Z05 | Removed guest | 403 or 404 | S |
| Z06 | Another order's adjustment id | 404 ADJUSTMENT_NOT_FOUND | P |

## Revision, idempotency, side effects
| # | Scenario | Expected | Source |
|---|---|---|---|
| R01 | Create, edit, delete | session revision +1 each; events set, set, removed; payload has ids only | A, R |
| R02 | Revision walk; stale edit 409; stale delete 409; delete of a deleted id | 1, 2; 409; 409; 404 | P |
| R03 | Failed edit (422, 409, 404 person) | stored amounts and shares unchanged | A |
| R04 | Same key replays a DELETE | 200 replayed, one `adjustment.removed` | A |
| R05 | Key reused for another id, or for the DELETE of the same id | 422 IDEMPOTENCY_KEY_REUSED | A |
| R06 | Same key, different body | first result, replayed, nothing changes | A |
| R07 | Replay after End | 200 replayed, no re-apply | A |
| R08 | Delete frees the id and removes the shares | 0 rows | P |
| R09 | Adjustment writes | receipt total, service charge, entries, tickets, rounds unchanged (receipt never reduced) | P S2.3, S2.5 |

## Races
| # | Scenario | Expected | Source |
|---|---|---|---|
| K01 | 8 creates, same id, rev 0, different keys | one 200, seven 409, one row, one event | A |
| K02 | Same key 6 times at once | all 200, one fresh, applied once | A |
| K03 | 25 creates of different ids | exactly 20 land, 5 are 400 TOO_MANY_ADJUSTMENTS | P |
| K04 | Edit vs delete at the same revision | one wins; state agrees | A |
| K05 | Two edits at the same revision | one 200, one 409; shares match the winner | A |
| K06 | Adjustment vs Confirm of the open round | both succeed | P NON_TICKET |
| K07 | Adjustment vs End (nothing confirmed) | 200 or 409 SESSION_CLOSED, never 5xx, rows match | P |

## Order state
| # | Scenario | Expected | Source |
|---|---|---|---|
| S01 | Made while open, edited and deleted after End | 200; shares follow the edit | P D1 |
| S02 | After End | status, closedAt and expiresAt unchanged; guest sees it | P D1 ("retention unchanged") |
| S03 | Cancelled order | create, edit, DELETE 409 SESSION_CLOSED | P |
| S04 | Past deletion date | 404, nothing written | mutations.ts contract (A) |
| S05 | Limit at 20: edit allowed, delete frees a slot | | P |
| S06 | Limit is per order | | P |

## Snapshot (`GET /sync`, `GET /sessions/:id`)
| # | Scenario | Expected | Source |
|---|---|---|---|
| G01 | No adjustments | `settlement.adjustments = []` for host and guest, both routes | P |
| G02 | Two adjustments | each carries id, direction, category, note, amountCentavos, percentBps, method, revision, shares[{participantId,label,amountCentavos}]; creation order; same to guest | P |
| G03 | Edit keeps place; delete removes; late joiner sees current | | P |
| G04 | Stranger / other order's host | 404, no list in body | S |
| G05 | Removed guest's share | stays in the list | P ("participants are soft-removed ... share stays") |

## Claims and names
| # | Scenario | Expected | Source |
|---|---|---|---|
| C01 | Claim rejected | label share stays | P |
| C02 | Name differs by case, spacing, width forms | matched like dish names, becomes the guest | P (`normalizeText`) |
| C03 | Different name | untouched | P |
| C04 | Guest already on it, manual | one share, amounts added | P (same-person never listed twice) |
| C05 | Several adjustments name the person | all adopt | P |

## Database guards
| # | Scenario | Expected | Source |
|---|---|---|---|
| D01 | Direct insert: both/neither amount and percent, amount 0, percent 10001, percent+manual, bad enums, note 41 chars or empty | rejected | D |
| D02 | Share with both or neither of person and name, name 41, amount -1, missing adjustment | rejected | D |
| D03 | `updated_by` from another order | rejected by trigger | D |
| D04 | Share whose session differs from its adjustment | rejected by trigger | D |
| D05 | Delete the order | adjustments and shares cascade | D |

## Billing after End (D1), `tests/contract-billing-after-end.test.ts`
Routes: `PUT /prices`, `PUT /service-charge`, `PUT /receipt-total`, `PUT /receipts/:id` (E01-E05 run for each), `PUT /entries/:id/settlement`, `PUT /corrections/:id/price`.
| # | Scenario | Expected | Source |
|---|---|---|---|
| E01 | Ended order: host write; guest write | 200 applied, status CLOSED, closing date unchanged; guest 403, state unchanged | P D1 |
| E02 | Replay of the key after End | 200 replayed, no re-apply | A |
| E03 | Cancelled order (nothing confirmed), host | 409 SESSION_CLOSED, nothing written | P |
| E04 | Past deletion date | 404, nothing written | A |
| E05 | Another order's host | 404, neither order moves | S |
| E06 | Service charge / receipt after End: walk revisions, stale 409, clear with null; guest snapshot shows them | | P |
| L01 | Host prices a guest's line after End | 200; guest sees it | P D1 |
| L02 | Guest prices own line after End | 403 FORBIDDEN, nothing written | P ("non-host price after End -> 403") |
| L03 | Guest clears own price, or price + Bill to after End | 403 | P |
| L04 | Guest Bill to after End 403; host Bill to (person, then typed name) 200 | | P |
| L05 | Stale rev 409 CONFLICT; unknown or non-uuid entry 404 ENTRY_NOT_FOUND | | A |
| L06 | Another order's entry id | 404 | S |
| L07 | Cancelled order, price and Bill to | 409 SESSION_CLOSED | P |
| L08 | Price bounds 0 and 9,999,999 ok; 10,000,000, -1, 1.5, "100" 422 | | A, D |
| L09 | Price after End | entries, rounds, tickets identical (content frozen) | P D1 |
| P01 | Correction price after End: host 200 (rev 1), stale 409, null clears; guest 403 | | P |
| P02 | Unknown, non-uuid, other order's correction | 404 CORRECTION_NOT_FOUND | A |
| P03 | Quantity correction | 422 | A |
| T01 | Table price after End | still notifies people with unpriced lines (`price.defaultSet`), deduped | P ("keep firing") |
| T02 | Unknown dish, other order's dish 404; stale 409 | | A |
| O01 | Host: add dish, open round, readiness, serving on an ended order | 409 SESSION_CLOSED, nothing written | P ("Ordering, serving ... stay refused") |
| O02 | Guest: add dish, readiness on an ended order | 403 or 409, nothing written | P |
| N01 | Guest snapshot after End | shows later price, service charge, receipt total | P |
| N02 | Billing write after End | creates no round | P |

## Result
See the verify report: 99 of 100 scenarios pass, plus 191 existing scenarios in the neighbouring suites (receipt-total, table-prices, settlement, receipt-total unit, adjustments math). One failing scenario, V04 (NFKC-expanding note gives 500 INTERNAL instead of 422).
