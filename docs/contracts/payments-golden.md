# Golden contract: payment tracking (v1.4 slice 5, F07), independent of the implementer's contract

Sources: **P** = docs/plans/salo-v1-4.md "Slice 5" (Approach, D27-D31, Done when), **B** = docs/plans/salo-v1-4-brief.md:531-579 (F07), **R** = docs/contracts/receipts.md and tests/contract-receipts.test.ts (status-code conventions), **H** = src/server/http.ts (ZodError is 422 `INVALID`, bad JSON 400, missing key 400, non-member 404).
Suite: `perl -e 'alarm 600; exec @ARGV' -- pnpm vitest run tests/contract-slice5-golden.test.ts` after `pnpm db:up` (no gtimeout on this Mac). Each request is raced against a 15 s deadline naming the scenario.

Body of `PUT /api/sessions/:id/payments/:paymentId`: `{ payer: {participantId}|{label}, payee: {participantId}|{label}|null, amountCentavos, method: cash|gcash|maya|bank|other|null, note? }`. `DELETE`: no body. Snapshot: `settlement.payments[] = { id, payer, payee, amountCentavos, method, note, createdAt }` oldest first (P Approach, Snapshot).
"Nothing changes" = session revision, event count, payment rows and notification rows identical before and after.

| # | Scenario | Input | Expected | Source |
|---|---|---|---|---|
| G01 | Host records; any member reads it | PUT valid, payer Ana | 200 `replayed:false`; snapshot and `/sync` of a guest list the payment (D28) | P Approach, D28 |
| G02 | Payee kinds, optional fields, no card check | participant payee, typed payee, typed payer `"  Lola  "`, method null, note omitted, payer with no dish | 200 each; typed names tidied; note null; order = record order | P Approach, Validation, B |
| G03 | All methods; amount bounds | 5 methods; 1; 99,999,999 | 200 | P Approach (CHECK) |
| G04 | 40-char note and labels | 40 chars | 200 | P Approach |
| G05 | Bad amount | 0, -1, 100,000,000, 1.5, "500", null, MAX_SAFE_INTEGER, missing | 422 `INVALID`, nothing changes | P (CHECK 1..99,999,999), H |
| G06 | Bad text/method | method "venmo" or 5; note 41; typed payer/payee label 41; blank label | 422 `INVALID`, nothing changes | P, H |
| G07 | Bad shapes | payer missing, `{}`, non-uuid id, array, string, null; payee `{}`, string, non-uuid | 422, nothing changes | H |
| G08 | Payee == payer | same participant; `Lola` vs ` lola `; host to host | 422 each; host payer + null payee 200 | P Validation |
| G09 | Protocol | broken JSON; no Idempotency-Key; body is a string | 400; 400; 422; nothing changes | H |
| G10 | Cross-order and unknown people | random uuid or another order's participant as payer or payee | 404; nothing changes; other order gets no row | P Validation, R R06/R10 |
| G11 | Removed people | removed payer; newly added removed payee; earlier payment of people who left | payer 200 and no notice; payee 404 `PERSON_NOT_FOUND`; old payment stays | P Validation, Done when |
| G12 | Guest / co-host | PUT and DELETE by guest, co-host | 403; nothing changes; payment still there | P Routes, S5.6, Assumptions |
| G13 | Self-marking | guest records own payment (ref and typed) | 403 | B Safeguards |
| G14 | No identity | no cookie; another order's host; removed guest | 404; 404; 403; nothing changes | H |
| G15 | Same id, same body, new key | PUT twice | 200 both; one row; one notice | P Routes |
| G16 | Same id, different body | amount, method, method null, note, note omitted, payee, payer | 409 `CONFLICT`; row unchanged | P Routes |
| G17 | Same key replay | PUT twice, same key | second `replayed:true`; one row, notice, event | H, R R03 |
| G18 | Replay after delete | record, delete, replay the record key | `replayed:true`; payment not resurrected; no notice | H (idempotency) |
| G19 | Other order's id | PUT same id and body in order B; DELETE in B | 404 `PAYMENT_NOT_FOUND`; A untouched | P Routes |
| G20 | Non-uuid id | `nope`, `../../x` | 404 | R R07 |
| G21 | Race: same id and body at once | 2 parallel PUTs | 200, 200; one row, one notice | P Routes |
| G22 | Race: same id, 2 bodies | 2 parallel PUTs | one 200, one 409; one row | P Routes |
| G23 | Race: delete vs re-record | parallel | no 5xx | robustness |
| G24 | Delete | DELETE; again; same key | 200 gone for all; 404; `replayed:true`; one `payment.deleted` | P Routes |
| G25 | Delete unknown id | valid uuid | 404 `PAYMENT_NOT_FOUND`; nothing changes | P Routes |
| G26 | Delete one of two | | only that one goes; record again 200 | P |
| G27 | After End | record, delete | 200 | P Routes (`allowClosed`) |
| G28 | Cancelled order | record | 409; nothing changes | P Routes |
| G29 | Cancelled order delete (spec silent) | DELETE | not 5xx | gap |
| G30 | Limit 200 | 199 + 1, then 1 more, delete, again | 200th 200; 201st 400 `TOO_MANY_PAYMENTS`; slot frees | P Validation, R R07 |
| G31 | Limit is per order | other order full | 200 | P |
| G32 | Race at 199 | 2 parallel | one 200 one 400; total 200 | P |
| G33 | Events | record, delete | `payment.recorded`/`payment.deleted` in `NON_TICKET_EVENTS`; payloads carry no amount, method or note | P Events |
| G34 | Confirm stays fresh | record + delete after host looked | `confirmRound` with old revision succeeds | P Events |
| G35 | Notice to participant payer | payer Ana | exactly one `payment.recorded` for Ana, none for others; subject has `centavos`; target kkb; text names the amount | D30, P Notification |
| G36 | No notice | typed payer; host paying for self; removed payer | 0 notices | D30 |
| G37 | Delete retracts | 2 payments, delete one | only that notice goes; payer's `/sync` shows one | D31 |
| G38 | Delete retracts a read notice | | gone | D31 |
| G39 | Same amount twice | | 2 notices (dedup per payment) | D30 dedup key `payment:<id>` |
| G40 | Claim re-keys | typed payer Rafa, typed payee `RAFA`, unrelated typed names | become claimant; others stay | P Claim |
| G41 | Claim makes payee == payer (owner follow-up 2) | Ana pays typed Rafa; Ana claims Rafa | approval succeeds; row kept (only the payee re-keyed); snapshot `needsReview: true` | P Addendum |
| G42 | Re-key is silent | | no notice to claimant | D30 |
| G43 | DB guards | cross-order payer/payee/creator, amount 0 / too big, bad method, note 41, two payers, both payee kinds | insert rejected | P Migration |
| G44 | Cascade | delete order | payments gone | P Migration |
| G45 | Host notice | Ana pays typed Rafa; Ana claims Rafa; replay the approval key | host has exactly 1 `payment.needsReview` (subject `name`, `centavos`; target kkb); replay adds none; claimant none | Addendum, D32 |
| G46 | No flag while the name has food | Rafa still has another dish when Ana claims | payment stays on Rafa; unflagged; no notice | Addendum |
| G47 | Payer-side variant | typed Rafa pays Ana; Ana claims Rafa | flagged; 1 host notice | Addendum |
| G48 | PATCH payee | `{payee:null}` on a flagged payment; same key again | 200; flag clears; notice gone; payer's `payment.recorded` stays; one `payment.updated`; replay `replayed:true` | Addendum, D35 |
| G49 | PATCH refusals | unflagged; payee == payer; guest; co-host; no cookie; extra field; unknown id | 409 `NOT_NEEDS_REVIEW`; 422; 403; 403; 404; 422; 404; nothing changes | Addendum |
| G50 | Orphan flagged | payer removed after the claim | PATCH 200 and DELETE 200 still work | Addendum |
| G51 | Delete and End | delete a flagged payment; PATCH after End | both its notices gone, the other payment's stay; PATCH 200 after End | Addendum |

Not covered (needs the browser or `buildKkb`, which runs on the client): chips, "Left to pay", Overpaid, drawer prefill, `kkbText` byte-identity. `e2e/payments.spec.ts` and `tests/payments.test.ts` own those.
