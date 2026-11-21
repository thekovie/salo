// HTTP contract checks for PUT /api/sessions/:id/receipt-total against a running dev server. Golden contract: docs/contracts/receipt-total.md.
// Usage: BASE=http://localhost:3000 node scripts/contract/receipt-total-http.mjs
// Creates only its own orders (never truncates). Exit 1 on any failed check.
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3000";
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
  if (!ok) failed++;
};
const within = (p, what) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`deadline ${what}`)), 15000))]);
async function call(method, path, { cookie, body, origin = BASE, idem = randomUUID(), raw } = {}) {
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
const snap = async (cookie) => (await call("GET", `/api/sessions/${sid}/sync`, { cookie })).json?.data;
const joined = await call("POST", `/api/sessions/${sid}/join`, { body: { code: (await snap(host)).session.joinCode, displayName: "Ana" } });
check("guest joins", joined.status === 200 || joined.status === 201, joined.text);
const guest = cookieOf(joined);
const put = (o = {}) => call("PUT", `/api/sessions/${sid}/receipt-total`, o);
const rev = async () => (await snap(host)).settlement.receiptTotal;

check("fresh snapshot null/0", JSON.stringify(await rev()) === JSON.stringify({ centavos: null, revision: 0 }));
let r = await put({ cookie: host, body: { centavos: 123456, expectedRevision: 0 }, idem: "http-rt-key-0001" });
check("host sets 200 replayed false", r.status === 200 && r.json?.data?.replayed === false && r.json.data.result.revision === 1, r.text);
r = await put({ cookie: host, body: { centavos: 123456, expectedRevision: 0 }, idem: "http-rt-key-0001" });
check("replay 200 replayed true", r.status === 200 && r.json?.data?.replayed === true, r.text);
check("applied once (revision 1)", (await rev()).revision === 1);
check("guest sees the value", (await snap(guest)).settlement.receiptTotal.centavos === 123456);
r = await put({ cookie: host, body: { centavos: 1, expectedRevision: 0 } });
check("stale -> 409 CONFLICT", r.status === 409 && r.json?.error?.code === "CONFLICT", r.text);
r = await put({ cookie: guest, body: { centavos: 1, expectedRevision: 1 } });
check("guest -> 403 FORBIDDEN", r.status === 403 && r.json?.error?.code === "FORBIDDEN", r.text);
r = await put({ body: { centavos: 1, expectedRevision: 1 } });
check("no cookie -> 404", r.status === 404 && r.json?.error?.code === "NOT_FOUND", r.text);
const other = await call("POST", "/api/sessions", { body: {} });
r = await put({ cookie: cookieOf(other), body: { centavos: 1, expectedRevision: 1 } });
check("other order's host -> 404", r.status === 404, r.text);
r = await put({ cookie: host, body: { centavos: 1, expectedRevision: 1 }, origin: null });
check("no Origin -> 403 FORBIDDEN_ORIGIN", r.status === 403 && r.json?.error?.code === "FORBIDDEN_ORIGIN", r.text);
r = await put({ cookie: host, body: { centavos: 1, expectedRevision: 1 }, origin: "https://evil.example" });
check("foreign Origin -> 403 FORBIDDEN_ORIGIN", r.status === 403 && r.json?.error?.code === "FORBIDDEN_ORIGIN", r.text);
for (const [name, body] of [["negative", { centavos: -1, expectedRevision: 1 }], ["fractional", { centavos: 1.5, expectedRevision: 1 }], ["over cap", { centavos: 100000000, expectedRevision: 1 }], ["string", { centavos: "5", expectedRevision: 1 }], ["no revision", { centavos: 5 }], ["no centavos", { expectedRevision: 1 }]]) {
  r = await put({ cookie: host, body });
  check(`${name} -> 422 INVALID`, r.status === 422 && r.json?.error?.code === "INVALID", r.text);
}
r = await put({ cookie: host, raw: "{nope" });
check("bad JSON -> 400", r.status === 400 && r.json?.error?.code === "BAD_JSON", r.text);
r = await put({ cookie: host, body: { centavos: 1, expectedRevision: 1 }, idem: "short" });
check("short key -> 400 IDEMPOTENCY_KEY", r.status === 400 && r.json?.error?.code === "IDEMPOTENCY_KEY", r.text);
const k = randomUUID();
await call("PUT", `/api/sessions/${sid}/service-charge`, { cookie: host, body: { centavos: 100, expectedRevision: 0 }, idem: k });
r = await put({ cookie: host, body: { centavos: 5, expectedRevision: 1 }, idem: k });
check("key from service-charge -> 422 IDEMPOTENCY_KEY_REUSED", r.status === 422 && r.json?.error?.code === "IDEMPOTENCY_KEY_REUSED", r.text);
r = await put({ cookie: host, body: { centavos: null, expectedRevision: 1 } });
check("clear (null) 200", r.status === 200, r.text);
check("cleared snapshot null rev 2", JSON.stringify(await rev()) === JSON.stringify({ centavos: null, revision: 2 }));
await call("POST", `/api/sessions/${sid}/close`, { cookie: host });
r = await put({ cookie: host, body: { centavos: 5, expectedRevision: 2 } });
check("closed -> 409 SESSION_CLOSED", r.status === 409 && r.json?.error?.code === "SESSION_CLOSED", r.text);
process.exit(failed ? 1 : 0);
