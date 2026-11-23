# Golden contract: `PUT /api/sessions/:id/prices` (KKB table price)

Sources: **P** = docs/plans/salo-v1-3.md (A8, A9, D2, D3, Pinned details), **A** = docs/api.md, **S** = docs/security.md, **D** = docs/data-model.md, **R** = docs/realtime.md, **B** = the testing brief.
Suite: `pnpm vitest run tests/contract-table-prices.test.ts` (46 scenarios, real Postgres `salo_test`, real route handler, faked cookie jar). HTTP wiring: `node scripts/contract/table-prices-http.mjs` (needs a dev server on :3000, `NEW_ORDERS_PER_HOUR=1000 POSTHOG_KEY= pnpm dev`; creates only its own orders).
Body: `{ dishId: uuid, variant: string|null (<=40, no NUL), unitCentavos: int 0..9,999,999 | null, expectedRevision: int>=0, clearEntryId?: uuid }`. Success: `200 { data: { result, revision, replayed } }`. Failure: `{ error: { code, message } }` (A).

Every refusal row also means: session revision, events, table prices and line prices are unchanged (asserted by a before/after fingerprint).

## Set, key, revision
| # | Scenario | Input | Expected | Side effects | Source |
|---|---|---|---|---|---|
| T01 | Host sets price | dish Katsu "Large", 12000, rev 0 | 200, replayed false, revision = session revision +1 | one `price.defaultSet` event; `defaults["<dish>|large"] = {12000, rev 1}` | A, P A8/A9 |
| T02 | Key = dish + normalized size | "Extra Large", "  extra   LARGE ", "extra large"; "" / null / "   "; other dish | same size spellings are one key; empty size its own key; other dish untouched; 2nd write with stale rev 409 | one entry per key | P D2, A |
| T03 | Bounds | 0 and 9,999,999 | 200 both; 0 is a real price | revision +1 each | B, D |
| T04 | Clear | unitCentavos null | 200; price gone; revision still increases; setting again later yields revision > any seen before | one event, session rev +1 | B ("always increases, even across a clear") |
| T05 | Clear with no price | null, rev 0 | 200, no price | - | A |
| T06 | Stale revision | rev 0 after rev 1; rev 5 (future) | 409 CONFLICT; fresh rev 200 | none on refusal | A, B |
| T07 | ABA across clear | set(1) -> clear -> set; then write with rev 1 | 409 CONFLICT | price unchanged | B |

## Idempotency
| # | Scenario | Expected | Source |
|---|---|---|---|
| T08 | Same key, same body twice | 200 both; second `replayed: true`, same revision; one event, one bump | A |
| T09 | Replay after price moved on | returns first result, does not roll back | A |
| T10 | Key reused on another kind (service-charge) | 422 IDEMPOTENCY_KEY_REUSED, nothing applied | A |
| T11 | Key reused on another dish | 422 (key bound to kind and target, "e.g. `entry.update:<id>`"); must not report success for a change not made | A |
| T12 | Missing/short/odd-char/101-char key | 400 IDEMPOTENCY_KEY | A |

## Validation (422 INVALID unless noted)
| # | Input | Source |
|---|---|---|
| T13 | unitCentavos -1, 10,000,000, 1.5, "100", true, [], {}, missing | B, D, A |
| T14 | expectedRevision -1, 0.5, "0", null, true, missing | A |
| T15 | dishId non-uuid/empty/null/number/missing; variant number/bool/object/41 chars/NUL; 40 chars ok | A, S (text limits) |
| T16 | clearEntryId non-uuid | A |
| T17 | `{not json` 400 BAD_JSON; `[]`, `"text"`, empty 422; >8 KB 413 TOO_LARGE | A |

## Authorization and tenancy
| # | Scenario | Expected | Source |
|---|---|---|---|
| T18 | Guest (also one who submitted the dish) set or clear | 403 FORBIDDEN | B, P permissions (`price.default` host only), S |
| T19 | No cookie / garbage cookie | 404 NOT_FOUND | A identity |
| T20 | Other order's host token, both directions | 404; neither order changed | S, A |
| T21 | Removed guest | 403 REMOVED or 404 | S |
| T22 | No / foreign Origin on non-GET /api | 403 FORBIDDEN_ORIGIN (proxy); own origin passes | A CSRF |

## Scoping and DB guards
| # | Scenario | Expected | Source |
|---|---|---|---|
| T23 | Dish of another session, or random uuid; set and clear | refused (404/422); other order's price untouched | B |
| T24 | Cancelled order (nothing confirmed) | 409 SESSION_CLOSED; price stays. An ended order with a confirmed round still takes the host's price | B, A |
| T25 | Direct SQL: foreign-session dish, price 10,000,000 / -1, revision -1 | rejected by DB (trigger/CHECK) | D |
| T26 | Delete session | `shared_prices` rows cascade away | P Tests (cascade per new table), D |

## clearEntryId
| # | Scenario | Expected | Source |
|---|---|---|---|
| T27 | Entry with own price 5000, set 12000 with clearEntryId | 200; line own price null; table 12000; one revision bump, one event; KKB line = 12000 `table` | A, P A9 |
| T28 | Entry of other size / other dish / other session / unknown | refused (404/409/422); neither table nor line price changes (atomic) | B |
| T29 | Stale table revision + clearEntryId | 409; line keeps its price | A |
| T30 | Entry without own price ok; replayed key later does not wipe a newer line price | 200; replay no-op | A |
| T31 | Guest + clearEntryId | 403; line price kept | B |
| T46 | Line price changed (by its guest) after host looked, then clearEntryId | 409 CONFLICT, or at least the newer price survives | S "every write checks the row's own revision" (see Spec gap) |

## KKB via snapshot
| # | Scenario | Expected | Source |
|---|---|---|---|
| T32 | own > table > null (never 0); table never overwrites a line's own price; clearing a line price returns to table; clearing table returns to null | B, P pinned |
| T33 | Notes ignored (same size, different notes share price); table price 0 is a price | P D2 |
| T34 | Confirmed replacement line | never inherits (unitCentavos null, source null) | P pinned |
| T35 | Guest `/sync` carries `settlement.defaults` | A, S |

## Ticket, invite, confirm
| # | Scenario | Expected | Source |
|---|---|---|---|
| T36 | Stored ticket snapshot, `/sync` tickets, invite lookup, event payload | contain no price (77777.. never appears) | S, R, B |
| T37 | Set/change/clear/clearEntryId after host looked, then confirm with the old revision | confirm succeeds (not STALE_REVISION) | P NON_TICKET_EVENTS, A |
| T38 | Control: add a dish after host looked | STALE_REVISION | A |
| T39 | Readiness after set + clear | unchanged | A ("Never resets readiness") |
HTTP script also: waiter page `/s/:id/waiter` and invite `/j/:code` HTML carry no price; preview image renders.

## Concurrency, realtime, limits
| # | Scenario | Expected | Source |
|---|---|---|---|
| T40 | Two writers, same rev | one 200, one 409, state = winner, one row | A |
| T41 | Same idempotency key sent twice at once | both 200, exactly one `replayed`, applied once | A |
| T42 | Three writers on different keys | all 200 (per-key revisions), +3 | A |
| T43 | "Every here" races the line's own edit | one coherent price (12000 or 6000) | B |
| T44 | Commit rings `pg_notify salo_events` within 15 s | R |
| T45 | >120 changes/min by one participant | 429 RATE_LIMITED | A |

## Disagreements between sources
1. D says "clearing deletes the row"; A says revision is "0 when none"; B and the plan say "revision always increases, even across a clear". The implementation keeps a tombstone row (price null, revision kept) and shows it in `defaults`. This satisfies B and T07 but contradicts D. The suite accepts the tombstone (T04/T05 count only priced rows). Docs need updating.
2. Spec gap (T46): A's body has no field for the line's own revision, yet S says every KKB write checks the row's own revision. A client therefore cannot protect a line price it has not seen. T27 and T46 cannot both hold without a new body field (for example the line's revision); fixing T46 means changing T27 to send it.
