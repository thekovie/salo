# Golden contract: `PUT /api/sessions/:id/menu` (restaurant menu link)

Sources: **P** = docs/plans/salo-v1-4.md (Slice 8a: F16), **A** = docs/api.md, **D** = docs/data-model.md, **R** = docs/realtime.md.
Suite: `pnpm vitest run tests/contract-menu-link.test.ts tests/menu-url.test.ts` (real Postgres `salo_test`, real route handler, faked cookie jar).
Body: `{ url: string | null, label?: string | null }` (`null` url removes the link and its label). Success: `200 { data: { result: { changed }, revision, replayed } }`. Failure: `{ error: { code, message } }`. Host only.

| # | Scenario | Expected | Source |
|---|---|---|---|
| M01 | Host sets (scheme added), edits the label, drops the label, removes | 200 each; snapshot `session.menu` `{ url (normalised), label (tidied), domain }` then `null`; four `session.menuSet` events; non-ticket | P, A, R |
| M02 | Guest | 403 FORBIDDEN; nothing changes | P |
| M03 | `http:`, `javascript:`, IP address, credentials, over 2048 chars, label over 40, empty url, missing url | 422 with the reason copy; nothing stored | P |
| M04 | Label that grows past 40 when tidied (NFKC) | 422 | P |
| M05 | Same url and label again; removing when there is none | 200 `changed: false`; no event, revision unchanged | P, A |
| M06 | Ended order | snapshot `menu: null`; PUT 409 SESSION_CLOSED | P (D50) |
| M07 | 11th change in 10 minutes | 429 RATE_LIMITED "Too many changes. Wait N seconds." (N ≤ 90) or "Wait about M minutes."; guest 403s and replays of a key do not count | P |
| V01 | Validator cases (`tests/menu-url.test.ts`) | schemes, http, credentials, IP encodings, local/single-label hosts, hostname shape, ports, trailing dot, normalised-length cap | P |

E2E: `e2e/menu-link.spec.ts` (live guest row, `target`/`rel`, report mailto, edit/remove, focus after live removal, ended order, axe light and dark).

## Golden contract (verify round)

Suite: `tests/contract-menu-link-golden.test.ts` (148 tests). Run from a clean seed on an isolated database (the shared `salo_test` is truncated by any concurrent `pnpm test`):
`TEST_DATABASE_URL=postgres://salo@localhost:5433/salo_test_menu_golden perl -e 'alarm 300; exec @ARGV' npx vitest run tests/contract-menu-link-golden.test.ts` (exit 142 = hung = failure).
Sources: **P** = plan Slice 8a (Approach / Pinned details / D49-D53 / Done when), **B** = brief F16 (`salo-v1-4-brief.md:1400-1532`), **A** = docs/api.md:42, **R** = docs/realtime.md.
Envelope: success `200 { data: { result: { changed }, revision, replayed } }`; failure `{ error: { code, message } }`.

| ID | Scenario | Input | Expected | Side effects | Source |
|---|---|---|---|---|---|
| G01 | Host set, edit label, change url, remove | `{url:"ramennagi.com.ph/menu",label:"  Drinks   menu "}` then edits, then `{url:null}` | 200 `changed:true`, revision +1 each; snapshot `{url:"https://ramennagi.com.ph/menu",label:"Drinks menu",domain:"ramennagi.com.ph"}` for host and guest; `null` after remove | 4 `session.menuSet` events, payload `{}`; columns match | P Approach, A |
| G02-G05 | Label omitted / null / "" / blank; url edit without label; `url:null` with a label; HTML in label | see names | label null; PUT replaces both fields; null url clears label and ignores a sent label (200); HTML stored verbatim as text | no label without url | P Pinned |
| G06 | `GET /api/sessions/:id` | host and guest | `session.menu` is `null` before, the object after | none | P Snapshot |
| G10-G12 | Same normalised url+label (retyped differently); remove with no link; same url new label | | 200 `changed:false` and no event / no revision bump for the first two; third is a real change | event count unchanged | P Pinned (cohost no-op pattern), A |
| G13-G15 | Key replay; replay with different body; replayed no-op; key from another mutation type; missing/short/odd key | | replay: 200 `replayed:true`, same revision, one event, state untouched; reused key 422 `IDEMPOTENCY_KEY_REUSED`; bad key 400 `IDEMPOTENCY_KEY` | nothing stored on 400/422 | `mutations.ts:44-70`, P |
| G20-G26 | Guest set/remove/edit; no cookie; other order's host token; removed guest; co-host; after host transfer | | 403 FORBIDDEN (guest, co-host); 404 (no cookie, other tenant, also for the snapshot); 403 (removed); old host 403 and new host 200 | stored link, revision, events unchanged | P A10, B "host-only" |
| G30-G34 | Bad JSON; body > 8 KB; missing/wrong-typed url or label, non-object bodies; "" and blank url; NUL in label | | 400 BAD_JSON; 413 TOO_LARGE; 422 INVALID; "" / blank url 422 "That doesn't look like a web address." and an existing link survives | nothing stored | P Assumptions, `http.ts` |
| G50 (49 rows) | Rejected urls: http (D49 copy), javascript/data/file/ftp/intent/custom/mailto, credentials (3 forms), localhost / `localhost.` / `.localhost` / `.local` / `.internal` / `.home.arpa` (+ trailing dot), single label, `a..b`, `-a.com`, `a-.com`, `exa_mple.com`, `.com`, IPv4 (127.0.0.1, 2130706433, 0x7f.1, 0177.0.0.1, 127.1, full-width, 10.x, 172.16, 192.168, 169.254.169.254, public, 0.0.0.0, no-scheme), IPv6 (`[::1]`, `[::ffff:127.0.0.1]`, public, link-local), ports 8443 and 8080, empty host, spaces, href > 500 after normalisation (input ~220), 501, raw 2048 / 2049 / 5000 | | 422 INVALID with the exact reason copy from P Pinned "Reasons and copy" | nothing stored, no event | P, B 1-9 |
| G50b, G51, G55 | All-digit TLD; `localhost:3000` forms; 17 exotic hosts (`https://./`, `:0`, `[::1`, `%00`, `1.2.3`, `1.2.3.4.5`, `0x7f.0x0.0x0.0x1`, `[::]`, `[0:0:0:0:0:ffff:7f00:1]`, `a.localhost.`, ...) | | 422 (port, local or unparseable reason) | nothing stored | P Pinned |
| G52 (17 rows) | Accepted: plain, no scheme, bare host (`/` added), case + whitespace, `www.` kept, query + fragment kept, trailing dot stored dotless, `:443` dropped, IDN to punycode, already punycode, `https:example.com`, `https:/\evil.com`, `https://example.com\@evil.com` (domain example.com), `@` in path / fragment, tab/newline stripped, two-label host | | 200; stored = `url.href`; snapshot `domain` = full normalised hostname | | P Approach, Done when |
| G53, G54 | href of exactly 500 accepted, 501 refused; raw `" Example.COM:443 "` | | 200 stores `https://example.com/`; 501 is 422 "That link is too long. Try a shorter one." and the 500 link stays | | P Pinned Length |
| G60-G64 | Label 40 ok, 41 refused; NFKC `㍿`x15 (expands to 60) refused, `㍿`x10 (exactly 40) accepted; NFKC expansion with null url does not 500; rejected requests leave the link alone; whitespace tidied | | 422 "Keep it under 40 characters." (never 500); tidy label `Main menu` | nothing stored on refusal | P Pinned Server |
| G70, G71 | After End | | snapshot `menu:null` for host and guest, columns kept; PUT edit / same value / remove all 409 SESSION_CLOSED | stored link unchanged | P D50 |
| G80-G84 | 10 changes then the 11th; guest 403s, 422s, same-value no-ops, replays; at the limit; 429 retry; second order | | 11th real change 429 RATE_LIMITED "Too many changes. Wait N seconds." (N ≤ 90) or "Wait about M minutes."; the quota is untouched by guest 403, 422, no-op and replay; at the limit a same-value PUT is 200 `changed:false`, an old key still replays, a real remove is 429; 429 is not recorded against the key; limit is per host, not shared across orders | state and events unchanged by the 429 | P Pinned Server |
| G90-G93 | `session.menuSet` and the host's pending Confirm; control with a ticket event; NOTIFY bell; effect on entries | | in `NON_TICKET_EVENTS`; set / edit / remove after the host looked do not make confirm stale, a ticket event still does (`STALE_REVISION`); real change rings `salo_events` `<sessionId>:<revision>` within 15 s, a no-op does not; entries, rounds, readiness unchanged | | P A15, R |
| G100 | DB CHECKs | direct SQL | label without url, url 500+ chars, label 41 chars refused; 40 accepted | | P Server |
| G110-G113 | Two concurrent different PUTs; five concurrent same-key PUTs; twelve concurrent distinct changes; PUT racing End | | all 200, revision +2, 2 events; exactly one `replayed:false`, one event; exactly 10 x 200 and 2 x 429, 10 events; PUT is 200 or 409, never 500, snapshot menu null after | | `mutations.ts` lock |

### Disagreements between sources (not code bugs)

- Limiter key: P Approach says "10 / 10 min per session id"; P Pinned says "keyed by `actor.participantId`"; A says "per host". Code and golden tests follow Pinned (per participant). After a host handover the new host gets a fresh quota; the old host's hits do not carry over.
- Implementer's table above (M01-M07) is consistent with P; it omits 404 (no cookie / other order), 400 key errors, co-host 403, the 8 KB body cap, no-op-at-limit and the concurrency rows now covered by G-rows.
