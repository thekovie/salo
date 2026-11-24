# Golden contract: extra receipts and shared-dish splits (v1.4 slice 4)

Sources: **P** = docs/plans/salo-v1-4.md (slice 4), **A** = docs/api.md, **D** = drizzle/0015_receipts_splits.sql.
Suite: `pnpm vitest run tests/contract-receipts.test.ts tests/receipts.test.ts tests/splits.test.ts` (real Postgres, real route handlers, faked cookie jar). Browser: `e2e/receipts-splits.spec.ts`.

Body of `PUT /receipts/:receiptId`: `{ expectedRevision, label?, totalCentavos, people: [{participantId} | {label}] }`. Body of `DELETE`: `{ expectedRevision }`. Snapshot: `settlement.receipts[] = { id, label, totalCentavos, people, revision }`, `settlement.entries[id].splitAmong`.

## Receipts route
| # | Scenario | Expected | Source |
|---|---|---|---|
| R01 | Host creates (rev 0), edits, deletes | 200 each; snapshot follows; second delete 404 | P, A |
| R02 | Guest writes | 403, nothing changes | A |
| R03 | Stale revision on PUT or DELETE; replay of the same key | 409; replay applies once | A |
| R04 | A person on two receipts | 409 `ALREADY_ON_RECEIPT` | P |
| R05 | Same person twice (Lola, lola) | 422 | P |
| R06 | Newly added person who left | 404 `PERSON_NOT_FOUND` | P |
| R07 | Eleventh receipt; non-uuid id | 400 `TOO_MANY_RECEIPTS`; 404 | A |
| R08 | After End; on a cancelled order | 200; 409 | P D1 |
| R09 | Events `receipt.set`, `receipt.removed` | In `NON_TICKET_EVENTS`; Confirm stays fresh | P |
| R10 | Another order's receipt id; person from another order inserted directly | 404; trigger rejects | D |
| R11 | Claim approved while the claimant is already on another receipt | No error; the typed name's row goes | P |

## Splits (`PUT /entries/:id/settlement` with `splitAmong`)
| # | Scenario | Expected | Source |
|---|---|---|---|
| S01 | Host splits a shared dish between 2 or more | 200; snapshot lists the people; bill to cleared | P |
| S02 | One person; billTo together with splitAmong; duplicate person; personal line | 422 each | P |
| S03 | Guest | 403 | A |
| S04 | Switch split to Bill to (and back) | One settlement revision step; payers replaced | P |
| S05 | Person who left stays in a split; a newly added removed person | 200; 404 | P |

## Math (`tests/splits.test.ts`, `tests/receipts.test.ts`)
Shares add up to the dish subtotal for 2 to 7 people at odd centavos; an unpriced split counts once in blockers and "Not yet settled"; price and quantity changes recompute; service charge and a proportional discount still sum to the adjusted total. A receipt expects its people's card totals plus their flagged adjustments; Main expects the adjusted total minus the extras; no extras leaves `reconcile` unchanged.
