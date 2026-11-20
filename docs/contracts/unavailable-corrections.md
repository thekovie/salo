# Golden contract: Mark unavailable and batch corrections

Sources: **P** = docs/plans/salo-v1-3.md (A10-A12, D4/D4b, Pinned details), **A** = docs/api.md, **S** = docs/security.md, **D** = docs/data-model.md, **R** = existing rounds/corrections behaviour.
Suite: `pnpm vitest run tests/contract-unavailable-corrections.test.ts` (71 scenarios, real Postgres `salo_test`, real route handlers, faked cookie jar). HTTP wiring: `node scripts/contract/unavailable-corrections-http.mjs` (needs a dev server on :3000; creates only its own orders).
Endpoints: `POST /api/sessions/:id/dishes/:dishId/unavailable` body `{ replacement?: <=60, note?: <=140 }`; `POST /api/sessions/:id/corrections` batch body `{ entries: [{ sourceEntryId, quantity? }] (1..100, unique), type: QUANTITY|REPLACE, replacement?, explanation? }`, old body `{ sourceEntryId, type, quantity?, replacement?, explanation? }`; `DELETE /api/sessions/:id/corrections/:id`.
Every refusal row also means: session revision, events, correction rows, entries and snapshots are unchanged (before/after fingerprint). Status of a successful unavailable is not stated in A; the suite expects 200 (corrections: 201).

## Unavailable: effects
| # | Scenario | Expected | Source |
|---|---|---|---|
| U01 | Sisig in round 1 (confirmed, 2 people) and round 2 (draft, two sizes) | 200; draft entries (all sizes, case-insensitive dish) soft-removed and listed in `removedEntryIds`; one UNAVAILABLE QUANTITY row per confirmed entry for its remaining quantity, targeting its own confirmed round, one shared group; one revision bump; event `dish.unavailable`; KKB, Items (`dishRemaining`, `preparationsOfRound`) show 0 at once; other dishes untouched | P A10/D4/D4b, A |
| U02 | Round 1 ticket and snapshot | byte-identical (snapshot JSON in the DB, `tickets[r1]`, `snapshotText`) | task brief, P pinned details |
| U03 | Told rows | `correctionRows` told + unavailable, never pending; absent from next round's live ticket and confirmed snapshot; round 1's own ticket still lists Sisig | P pinned ("told derived from target round status") |
| U04 | Empty next round after unavailable | confirm still 422 EMPTY_ROUND | A (EMPTY_ROUND) |
| U05 | No draft entry removed | event `dish.unavailableTold`; a confirm made with the revision seen before is NOT stale (200) | P NON_TICKET_EVENTS |
| U06 | A draft entry removed | event `dish.unavailable`; a confirm with the earlier revision is 409 STALE_REVISION | P (draft bulk-remove stays a ticket event) |
| U07 | No open round | 200, told event, billing applies; next opened round carries no rows | P D4 |
| U08 | Draft-only dish | removed, no correction rows, `dish.unavailable`; restore (Undo) brings an entry back | P A10 |
| U09 | `replacement` + `note` | confirmed entries get REPLACE rows (no quantity delta) with the text and note, one group, target own round; draft entries still removed; KKB shows "Sisig -> Pork Belly" lines, nothing pending | A, P D4b |
| U10 | Dish in rounds 1, 2 (confirmed) and 3 (draft) | each entry's row targets and sources its own round; one group; snapshots unchanged | A ("targeting its own confirmed round") |
| U11 | Entry partly cancelled (told) | only the remainder is cancelled; total = ordered | brief, A |
| U12 | Pending cancel on the dish's entries | dropped; total per entry = ordered; other dishes' pending rows kept | A ("Pending corrections ... are dropped") |
| U13 | Pending REPLACE on an entry | dropped; entry ends with one told row | A |
| U14 | Removed guest's confirmed entries | still corrected | D (billing counts them) |
| U15 | Per-person summary | no longer lists the dish | A (summary applies corrections) |
| U16 | Entries with other sizes and notes | every preparation goes | P D4b |
| X01 | Pending batch across two dishes | only the unavailable dish's row dropped; the other row stays removable | A |
| X02 | Guest adds the dish while host marks it unavailable | no 5xx; per-entry totals intact | brief (concurrency) |

## Unavailable: state, idempotency, scoping, validation, auth
| # | Scenario | Expected | Source |
|---|---|---|---|
| U17 | Second call (new key) | 409 NOTHING_LEFT | A |
| U18 | Second call after a REPLACE | 409 NOTHING_LEFT: an entry with a told swap no longer counts as that dish; no new rows | A, D13 |
| U19 | Same key replayed | 200 `replayed: true`, same result and revision, nothing more written | A |
| U20 | Same key on another dish | 422 IDEMPOTENCY_KEY_REUSED, other dish untouched | A ("bound to the dish") |
| U21 | Key from a correction | 422 IDEMPOTENCY_KEY_REUSED | A |
| U22 | Missing/short/odd/101-char key | 400 IDEMPOTENCY_KEY | A |
| U23 | Unknown uuid, non-uuid, another order's dish | 404 DISH_NOT_FOUND; other order untouched | A |
| U24 | Dish with only removed drafts | 404 or 409 | A |
| U25 | replacement/note wrong type, too long (61/141), NUL, body `[]`/string/number/null | 422 INVALID; `{not json` 400 BAD_JSON; >8 KB 413 TOO_LARGE | A, S |
| U26 | 60/140 chars; blank replacement | 200; blank never yields a REPLACE row | A, S |
| U27 | Empty body | same as `{}` | A (readJson) |
| U28-U33 | Guest 403 FORBIDDEN; no/garbage cookie 404 NOT_FOUND; other tenant 404; removed guest 403/404; Origin missing/foreign 403 FORBIDDEN_ORIGIN; closed 409 SESSION_CLOSED | refusals with nothing changed | A, S, P Permissions (`dish.unavailable` host-only) |

## Unavailable: permanence, retention, realtime, limits, races
| # | Scenario | Expected | Source |
|---|---|---|---|
| U34 | Delete a told row | API 409 ROUND_CONFIRMED; SQL DELETE/UPDATE rejected | P pinned, D (freeze trigger) |
| U35 | `reason` | NULL or UNAVAILABLE only (CHECK) | D |
| U36 | Session delete | told rows cascade away | P Tests ("cascade per new table"), D |
| U37 | Commit | pg_notify on `salo_events` within 15 s | R |
| U38 | >120 changes/min | 429 RATE_LIMITED | A, S |
| U39 | Race with a draft entry edit | no 5xx; entry ends removed; the edit never resurrects it | brief |
| U40 | Race with a batch correction | totals never exceed ordered; no pending rows for the dish survive | brief |
| U41 | Two unavailable, different keys | exactly one 200, one 409 NOTHING_LEFT; one row per entry | A |
| U42 | Same key twice at once | one applied, one replay, one bump | A |

## Batch corrections
| # | Scenario | Expected | Source |
|---|---|---|---|
| C01 | Batch across Host and Ana | 201 `{correctionIds, groupId}`; one row per entry, shared group, target open round, reason null; event `correction.recorded`; shown as one row; billing flags, not applies | A, P A11/A12 |
| C02 | Old single body QUANTITY and REPLACE | 201 `{correctionId}`; same row shapes | A |
| C03 | REPLACE batch | replacement required (422); all rows carry it | A |
| C04 | One-entry batch | one row | A |
| C05 | Confirm next round | lines appear on that ticket; rows become told; billing applies; delete 409 ROUND_CONFIRMED | R, A |
| C06 | Entries from two confirmed rounds | rows keep own `sourceRoundId` (or clean refusal) | R |
| C07 | No open round | 409 NO_OPEN_ROUND, nothing written | A |
| C08 | Caps | quantity > remaining (pending counts) 422 INVALID, fully cancelled 409 ALREADY_CANCELLED, whole batch atomic | A, S |
| C09 | Quantity missing/0/-1/1.5/"1"/null/100/true | 422 INVALID | A |
| C10 | Empty/duplicate/non-uuid/non-array/101 entries, bad type, long or NUL text, bad JSON, >8 KB | 422 / 400 / 413 | A, S |
| C11 | Unknown, foreign-order, draft, removed entry beside a good one | 404 ENTRY_NOT_FOUND / 409 NOT_CONFIRMED; nothing applied | A |
| C12 | 100-row cap | 99 + batch of 2 writes none (422 TOO_MANY_CORRECTIONS); 100th fits; 101st refused | A, P pinned, S |
| C13 | Two 60-row batches race | one 201, one 422; 60 rows | A |
| C14 | At the cap, unavailable on a 110-entry dish | refused 422 TOO_MANY_CORRECTIONS (no partial group); never above 100 rows | S |
| C15 | Delete one row of a batch | whole group removed, one `correction.removed` event; single rows only themselves | A, P A12 |
| C16 | Delete scoping | unknown/non-uuid/foreign 404 CORRECTION_NOT_FOUND; guest 403; stranger 404 | A, S |
| C17-C18 | Replay / concurrent same key | applied once | A |
| C19 | Two batches race for the same quantity | one 201, one 409; cancelled = ordered | S ("cancellations never exceed what was ordered") |
| C20-C22 | Guest 403, strangers 404, removed 403/404, Origin, closed 409 SESSION_CLOSED (POST and DELETE) | refusals, nothing changed | A, S |
| C23-C25 | Cascade, realtime bell, 429 | as above | D, R, A |
| X03 | REPLACE (single or batch) aimed at an entry already fully told-cancelled | 409 ALREADY_CANCELLED, nothing written | R, brief |
| F01 | Seeded random 60-step sequence of adds, confirms, opens, unavailable, batch and single corrections | no 5xx; no entry cancelled above its quantity; at most two UNAVAILABLE rows per entry (a cancel and a swap); every QUANTITY delta negative; no negative KKB line; confirmed snapshots never change | brief invariants |
