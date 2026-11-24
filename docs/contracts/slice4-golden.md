# Golden contract: v1.4 slice 4 (extra receipts and shared-dish splits), independent suite

Sources: **P** = docs/plans/salo-v1-4.md "Slice 4" (Approach, States, D22-D26, Assumptions, Done when), **B** = docs/plans/salo-v1-4-brief.md F05/F06 (:449-530), **D** = drizzle/0015_receipts_splits.sql. Derived from the spec, not the code. docs/contracts/receipts.md is the implementer's own contract; this file is the black-box set that must keep passing.

Suite: `TEST_DATABASE_URL=postgres://salo@localhost:5433/salo_test_slice4 perl -e 'alarm shift; exec @ARGV' 420 pnpm vitest run tests/contract-slice4-golden.test.ts` (53 scenarios; the dedicated database is created and migrated by tests/global-setup.ts, because every suite truncates `sessions` and a second vitest run on the shared `salo_test` deletes this suite's orders mid-test; real route handlers, real Postgres, per-request cookie jar via AsyncLocalStorage; each scenario has a 15 s deadline; exit 142 = timeout = FAIL). Every refusal row also asserts a before/after fingerprint: session revision, events, mutation records, receipts, receipt_people, entry_payers, entry_settlements unchanged.

## PUT /api/sessions/:id/receipts/:receiptId  `{expectedRevision, label?, totalCentavos, people:[{participantId}|{label}]}`
| # | Scenario | Expected | Side effects | Source |
|---|---|---|---|---|
| RC01 | Host creates (rev 0) with a person and a typed name | 200 `{receiptId, revision:1}`, `replayed:false` | snapshot `settlement.receipts` for any member; event `receipt.set {receiptId}`; session revision +1 | P Receipts API |
| RC02 | No label, `totalCentavos` null / 0 / 99999999; 100000000 | 200; 422 | refusal changes nothing | P Receipts API, D |
| RC03 | Label "  Senior   citizen  "; 40 chars; 41; "   " | tidied; 200; 422; label null | | P Approach |
| RC04 | 18 malformed bodies (no people, wrong types, negative or fractional total, bad revision, group / table as person, 31 people, array body); bad JSON | 422 INVALID; 400 BAD_JSON | nothing changes | P Receipts API |
| RC05 | No cookie; guest; co-host; other order's host; removed guest; missing / bad idempotency key | 404; 403; 403; 404; 403 REMOVED; 400 IDEMPOTENCY_KEY | nothing changes | P "host only" |
| RC06 | rev>0 on missing; rev 0 on existing; replace rev 1; stale replace | 404 RECEIPT_NOT_FOUND; 409; 200 revision 2; 409 | | P |
| RC07 | Person (id or typed name, any case) already on another receipt, on create and on edit | 409 ALREADY_ON_RECEIPT; keeping your own people is 200 | nothing half-applied | P S4.5 |
| RC08 | Same person twice: id, Lola/lola, spacing, NFKC twin | 422 | nothing changes | P Receipts API |
| RC09 | Newly added removed / unknown / other-order person; stored left person stays on edit | 404 PERSON_NOT_FOUND; 200 | | P |
| RC10 | 10 receipts ok; 11th; edit at the limit; delete frees a slot; other order unaffected | 200; 400 TOO_MANY_RECEIPTS; 200; 200; 200 | | P |
| RC11 | Replay same key + body; same key for another receipt | `replayed:true`, one row, one event; 422 IDEMPOTENCY_KEY_REUSED | | P Keys |
| RC12 | Ended order create / edit / delete; guest after End; cancelled order (nothing confirmed) | 200; 403; 409 SESSION_CLOSED | | P D1 |
| RC13 | Three receipts then Confirm with the older revision; snapshot order | Confirm 200; order = creation order | | P NON_TICKET_EVENTS |

## DELETE /api/sessions/:id/receipts/:receiptId  `{expectedRevision}`
| # | Scenario | Expected | Side effects | Source |
|---|---|---|---|---|
| RD01 | Host deletes | 200 `{receiptId}` | gone from snapshot; people freed (can join another receipt); event `receipt.removed` | P |
| RD02 | Stale; revision 0; empty body; unknown id; non-uuid; guest; no cookie; other order (DELETE and PUT); second delete | 409; 422; 422; 404 RECEIPT_NOT_FOUND x2; 403; 404; 404; 404 | nothing changes | P |
| RD03 | Replay of an applied delete key | 200 `replayed:true` | | P |

## Receipts: concurrency (RX)
| # | Scenario | Expected | Source |
|---|---|---|---|
| RX01 | Two creates for one person at once | one 200, one 409 ALREADY_ON_RECEIPT; one receipt | P |
| RX02 | Same id, both rev 0 | one 200, one 409 | P |
| RX03 | Three creates at nine receipts | one 200, two 400 TOO_MANY_RECEIPTS; ten rows | P |
| RX04 | Edit races delete on one revision | exactly one 200, no 5xx, no orphan people | P |
| RX05 | Add a person while the host removes them | 200 or 404, never 5xx | P |

## Claim approval with receipts (RA), via `POST /claims` and `POST /claims/:id/approve`
| # | Scenario | Expected | Source |
|---|---|---|---|
| RA01 | Claimant already on another receipt, typed name on a different one | 200; the typed name's row goes, claimant stays | P Claim approval |
| RA02 | Claimant and typed name on the same receipt | 200; one row for the claimant | P |
| RA03 | Claimant on no receipt | 200; typed name's row becomes the claimant | P |
| RA04 | Typed name is still a split payer | 200; name stays a typed name on the receipt | P labelHasFood |

## PUT /api/sessions/:id/entries/:entryId/settlement with `splitAmong`
| # | Scenario | Expected | Side effects | Source |
|---|---|---|---|---|
| SP01 | Host splits a shared dish between two | 200 `{entryId, revision:1}` | everyone's snapshot lists `splitAmong` (participantId, label), `billTo` null; event `entry.settled`; confirmed round snapshots and order entries byte-identical | P S4.12, S4.14 |
| SP02 | Person + typed name "  Lola   Maria "; 41-char name | tidied; 422; `splitAmong` key absent on entries without a split | | P Split API |
| SP03 | 15 bad bodies (one person, empty, null, non-array, billTo with split incl. billTo null, duplicates by id / case / spacing / NFKC, empty name, group, 31, no revision, nothing to change); 30 typed names | 422 each; 200 | nothing changes | P Split API |
| SP04 | Personal line (person's, host's, typed name's) | 422 | nothing changes | P Split API |
| SP05 | Guest, co-host, dish owner, no cookie, other order, removed guest | 403, 403, 403, 404, 404, 403 REMOVED | nothing changes | P Split API |
| SP06 | Stale revision; unknown / non-uuid / other order's entry; soft-removed dish | 409; 404 ENTRY_NOT_FOUND x3; 409 ENTRY_REMOVED | nothing changes | P |
| SP07 | split -> one payer -> split -> clear | revisions 2, 3, 4, 5; rows and cards show one mode only; four `entry.settled` events | | P S4.14 |
| SP08 | Replace the set | exactly the new people | | P |
| SP09 | A person who left stays and keeps their share; adding a left / unknown / other-order person; Bill to other-order person | 200 with share 45000 each; 404 PERSON_NOT_FOUND x4 | | P Decisions |
| SP10 | Ended order host / guest; cancelled order | 200; 403; 409 | | P D1 |
| SP11 | Price-only changes (78000, 78001, 100003, null) | split kept; shares sum to price; null price gives two null shares | | P S4.15 |
| SP12 | Replay a split key | `replayed:true`, 2 payer rows | | P |
| SP13 | Three racing writes (split, Bill to, other split) on one revision, three rounds | one 200, two 409; never both modes; revision +1 | | P S4.14 |

## GET /api/sessions/:id/sync (snapshot)
| # | Scenario | Expected | Source |
|---|---|---|---|
| SN01 | Fresh order; stranger / no cookie | `receipts: []`, no `splitAmong` key anywhere; 404 | P Snapshot |
| SN02 | Ended order, guest | receipts and splits still visible | P |

## Math (pure `buildKkb`, `reconcileReceipts`, `kkbText` fed by the real snapshot)
| # | Scenario | Expected | Source |
|---|---|---|---|
| MX01 | 2-7 payers; 10001, 3333, 78001 centavos; shuffled pick order | shares sum to the price; spread <= 1; odd centavos go to payer keys in sort order; order-independent | P S4.17, allocate |
| MX02 | 3 x 100.01 among 3 | 30003 | P |
| MX03 | Unpriced split of qty 2 among 3, service charge entered | one `unpriced` blocker with units 2, no `unbilled`; one "no price" line and one "Not yet settled"; `priceCompleteness` 1 dish; payer cards each show unpriced; receipts all "incomplete"; after pricing charge allocated and cards sum to food + service | P Split math |
| MX04 | Split + 10% service (138) + 20% senior of Bo's food + proportional discount 100 | Host 330, Ana 539, Bo 649 (pesos); adjusted 1518, 1400, 1300; cards sum to adjusted total; all adjustments applied | P S4.18 |
| MX05 | Bo on a receipt of 531, Main 869; then a 600 discount that exceeds Bo's balance | Main expects 869 and matches, extra 531 matches, overall 1400 matches; flagged discount lands on Bo's receipt (531 - 600) and Main stays 869 | P Receipt math |
| MX06 | Bill to alone; extras absent; extra covering Cy (nothing on the bill) | `reconcileReceipts` null; Bill to share on payer card with `billedFrom` "Whole table", `splitWays` null; flag "Cy has nothing on the bill" | P S4.9, States |
| MX07 | Quantity correction 3 -> 2 on a split dish, confirmed | effective quantity 2, shares sum 20002 | P S4.16 |
| MX08 | Replacement dish: split via entry route, price via correction route | 200s; both shares carry the replacement label, sum 60001; switching to Bill to moves the whole line | P D25 |
| MX09 | Export text of a split dish | no "split" wording; shared section keeps one listed line "Ana, Bo" | P S4.12, kkbText |
| MX10 | Pending correction on a split dish | one `pending` blocker with count 1 | P Split math |
| MX11 | Group dish split; participant "Ana" plus typed "Ana" | 200; 200 (documented, see follow-up) | P |

## Database backstops (D)
| # | Scenario | Expected |
|---|---|---|
| DB01 | entry_payers: no who, both who, duplicate person, duplicate label by case, person or entry from another session, 41-char label | rejected |
| DB02 | receipts: revision 0, total -1 or 100000000, empty label; receipt_people duplicate person or label by case across receipts; cascades on receipt, entry and session delete | rejected / cascaded |

## Result
53/53 pass (3 consecutive runs); full `pnpm test` 51 files, 881 tests pass. No blocking bugs found. Follow-ups are listed in the verify report.
