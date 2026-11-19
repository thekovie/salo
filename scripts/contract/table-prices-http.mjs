// HTTP contract checks for PUT /api/sessions/:id/prices against a running dev server (route wiring, cookies, Origin).
// Usage: BASE=http://localhost:3000 node scripts/contract/table-prices-http.mjs
// Creates only its own orders (never truncates). Exit code 1 on any failed check. See docs/contracts/table-prices.md.
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ORIGIN = process.env.APP_ORIGIN ?? BASE;
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
  if (!ok) failed++;
};
const within = (p, what) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`deadline ${what}`)), 15000))]);

async function call(method, path, { cookie, body, origin = ORIGIN, idem = randomUUID(), raw } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  if (idem && method !== "GET") headers["idempotency-key"] = idem;
  const res = await within(fetch(BASE + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: "manual" }), `${method} ${path}`);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie?.() ?? [] };
}
const cookieOf = (r) => r.setCookie.map((c) => c.split(";")[0]).join("; ");

await within(fetch(`${BASE}/api/health`), "health").then((r) => r.json()).then((j) => check("health", j.ok === true)).catch((e) => { console.log("server not reachable", e.message); process.exit(2); });

const created = await call("POST", "/api/sessions", { body: {} });
check("start order 201", created.status === 201, created.text);
const sid = created.json.data.id;
const host = cookieOf(created);
const sync = (await call("GET", `/api/sessions/${sid}/sync`, { cookie: host })).json.data;
const joined = await call("POST", `/api/sessions/${sid}/join`, { body: { code: sync.session.joinCode, displayName: "Ana" } });
check("guest joins", joined.status === 200 || joined.status === 201, joined.text);
const guest = cookieOf(joined);
const add = await call("POST", `/api/sessions/${sid}/entries`, { cookie: host, body: { dishName: "Katsu", quantity: 2, variant: "Large", attribution: { type: "TABLE" } } });
check("add dish", add.status === 200 || add.status === 201, add.text);
const snap = (await call("GET", `/api/sessions/${sid}/sync`, { cookie: host })).json.data;
const entry = snap.entries[0];
const dishId = entry.dishId;
const PRICE = 7777701; // shows as 77,777.01
const body = (over = {}) => ({ dishId, variant: "large", unitCentavos: PRICE, expectedRevision: 0, ...over });
const put = (o) => call("PUT", `/api/sessions/${sid}/prices`, o);

// CSRF / Origin (docs/api.md conventions)
let r = await put({ cookie: host, body: body(), origin: null });
check("no Origin -> 403 FORBIDDEN_ORIGIN", r.status === 403 && r.json?.error?.code === "FORBIDDEN_ORIGIN", r.text);
r = await put({ cookie: host, body: body(), origin: "https://evil.example" });
check("foreign Origin -> 403 FORBIDDEN_ORIGIN", r.status === 403 && r.json?.error?.code === "FORBIDDEN_ORIGIN", r.text);
// auth
r = await put({ body: body() });
check("no cookie -> 404 NOT_FOUND", r.status === 404 && r.json?.error?.code === "NOT_FOUND", r.text);
r = await put({ cookie: guest, body: body() });
check("guest -> 403 FORBIDDEN", r.status === 403 && r.json?.error?.code === "FORBIDDEN", r.text);
const other = await call("POST", "/api/sessions", { body: {} });
r = await put({ cookie: cookieOf(other), body: body() });
check("another order's host cookie -> 404", r.status === 404, r.text);
r = await put({ cookie: host, body: body(), idem: null });
check("missing Idempotency-Key -> 400 IDEMPOTENCY_KEY", r.status === 400 && r.json?.error?.code === "IDEMPOTENCY_KEY", r.text);
r = await put({ cookie: host, body: body({ unitCentavos: 10000000 }) });
check("out-of-range price -> 422 INVALID", r.status === 422 && r.json?.error?.code === "INVALID", r.text);
r = await put({ cookie: host, raw: "{nope" });
check("bad JSON -> 400 BAD_JSON", r.status === 400 && r.json?.error?.code === "BAD_JSON", r.text);
r = await put({ cookie: host, body: body({ variant: "x".repeat(9000) }) });
check("9 KB body -> 413 TOO_LARGE", r.status === 413 && r.json?.error?.code === "TOO_LARGE", r.text);
// happy path + replay
const idem = randomUUID();
r = await put({ cookie: host, body: body(), idem });
check("host sets price 200 envelope", r.status === 200 && r.json?.data?.replayed === false && Number.isInteger(r.json?.data?.revision), r.text);
const r2 = await put({ cookie: host, body: body(), idem });
check("retry same key -> replayed:true, same revision", r2.status === 200 && r2.json?.data?.replayed === true && r2.json.data.revision === r.json?.data?.revision, r2.text);
r = await put({ cookie: host, body: body({ unitCentavos: 1 }) });
check("stale expectedRevision -> 409 CONFLICT", r.status === 409 && r.json?.error?.code === "CONFLICT", r.text);
// snapshot as guest
const gsnap = (await call("GET", `/api/sessions/${sid}/sync`, { cookie: guest })).json.data;
check("guest /sync shows table price", gsnap.settlement.defaults[`${dishId}|large`]?.unitCentavos === PRICE, JSON.stringify(gsnap.settlement.defaults));
// confirm with the revision seen BEFORE the price; must not be stale
const confirm = await call("POST", `/api/sessions/${sid}/rounds/${snap.activeRoundId}/confirm`, { cookie: host, body: { expectedRevision: snap.session.revision } });
check("confirm with pre-price revision is not STALE_REVISION", confirm.status === 200, confirm.text);
// no price on waiter ticket, invite page, invite preview
const leak = (t) => /77,?777|7777701/.test(t);
const waiter = await fetch(`${BASE}/s/${sid}/waiter`, { headers: { cookie: host } }).then((x) => x.text());
check("waiter page has no price", !leak(waiter) && waiter.length > 500, "leak or empty page");
const invite = await fetch(`${BASE}/j/${sync.session.joinCode}`).then((x) => x.text());
check("invite page has no price", !leak(invite));
const og = await fetch(`${BASE}/j/${sync.session.joinCode}/opengraph-image`).then((x) => x.status);
check("invite preview image renders (no price data path)", og === 200 || og === 404, String(og));
// close, then refuse
await call("POST", `/api/sessions/${sid}/close`, { cookie: host });
r = await put({ cookie: host, body: body({ unitCentavos: 5, expectedRevision: r2.json.data.revision }) });
check("closed order -> 409 SESSION_CLOSED", r.status === 409 && r.json?.error?.code === "SESSION_CLOSED", r.text);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
