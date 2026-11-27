# Golden contract: payment tracking (v1.4 slice 5)

Sources: **P** = docs/plans/salo-v1-4.md (slice 5), **A** = docs/api.md, **D** = drizzle/0016_payments.sql.
Suite: `pnpm vitest run tests/contract-payments.test.ts tests/payments.test.ts` (real Postgres, real route handlers, faked cookie jar). Browser: `e2e/payments.spec.ts`.

Body of `PUT /payments/:paymentId`: `{ payer, payee | null, amountCentavos, method | null, note | null }`; `DELETE` has no body. Snapshot: `settlement.payments[] = { id, payer, payee, amountCentavos, method, note, createdAt }`.

## Payments route
| # | Scenario | Expected | Source |
|---|---|---|---|
| Y01 | Host records, then deletes; second delete | 200; snapshot follows for every viewer; 404 `PAYMENT_NOT_FOUND` | P, A |
| Y02 | Same id and body; same id, different body; another order's id | 200 no-op; 409; 404 | P |
| Y03 | Guest or co-host writes | 403, nothing written | P D27 |
| Y04 | Amount 0, over max, fractional; unknown method; note over 40; payee = payer | 422 each | P |
| Y05 | Payer who left; newly added payee who left; unknown payer | 200; 404; 404 | P |
| Y06 | 201st payment | 400 `TOO_MANY_PAYMENTS` | A |
| Y07 | After End; on a cancelled order | 200; 409 `SESSION_CLOSED` | P D1 |
| Y08 | Payer from another order inserted directly | trigger rejects | D |
| Y09 | Events `payment.recorded`, `payment.deleted` | In `NON_TICKET_EVENTS`; Confirm stays fresh | P |
| Y10 | Claim approved for a typed name that is a payer or payee | Rows re-keyed to the claimant | P |
| Y12 | Needs review: payer == payee after a claim (derived, `needsReview` in the snapshot) | Row kept; counted in no paid, left, chip or Collected; host gets one `payment.needsReview`; PATCH payee (flagged only) restores it and retracts the notice; delete removes both notices | P Addendum G41, G45-G51 |
| Y11 | Notice (`E14` in notifications.md) | participant payer only; deleted with the payment | P D30 D31 |

## Math (`tests/payments.test.ts`)
Unpaid, Partly paid, Paid, Overpaid; never Paid while the bill is not final; no chip for cards with no price or nothing owed; a price change recomputes what is left; the obligation includes service charge, adjustments and splits; Left to pay is the sum of each person's shortfall; payments of a removed person stay; payments with no card are listed apart; the copy-as-text export is byte-identical.
