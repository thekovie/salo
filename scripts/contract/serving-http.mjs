// HTTP contract checks for POST /api/sessions/:id/serving against a running dev server (route wiring, cookies, Origin, limiter).
// Usage: BASE=http://localhost:3000 node scripts/contract/serving-http.mjs
// Creates only its own orders (never truncates). Exit code 1 on any failed check. See docs/contracts/serving.md.
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
const sync = async (cookie) => (await call("GET", `/api/sessions/${sid}/sync`, { cookie })).json.data;
const joined = await call("POST", `/api/sessions/${sid}/join`, { body: { code: (await sync(host)).session.joinCode, displayName: "Ana" } });
check("guest joins", joined.status === 200 || joined.status === 201, joined.text);
const guest = cookieOf(joined);
const add = await call("POST", `/api/sessions/${sid}/entries`, { cookie: host, body: { dishName: "Katsu", quantity: 3, attribution: { type: "TABLE" } } });
check("add dish", add.status === 200 || add.status === 201, add.text);
let snap = await sync(host);
const draftRound = snap.activeRoundId;
const lineKey = JSON.stringify([snap.entries[0].dishId, "", ""]);
const serve = (o) => call("POST", `/api/sessions/${sid}/serving`, o);
const b = (over = {}) => ({ roundId: draftRound, lineKey, delta: 1, ...over });

let r = await serve({ cookie: host, body: b() });
check("draft round -> 409 ROUND_NOT_CONFIRMED", r.status === 409 && r.json?.error?.code === "ROUND_NOT_CONFIRMED", r.text);
const conf = await call("POST", `/api/sessions/${sid}/rounds/${draftRound}/confirm`, { cookie: host, body: { expectedRevision: snap.session.revision } });
check("confirm round 1", conf.status === 200, conf.text);

r = await serve({ cookie: host, body: b(), origin: null });
check("no Origin -> 403 FORBIDDEN_ORIGIN", r.status === 403 && r.json?.error?.code === "FORBIDDEN_ORIGIN", r.text);
r = await serve({ cookie: host, body: b(), origin: "https://evil.example" });
check("foreign Origin -> 403 FORBIDDEN_ORIGIN", r.status === 403 && r.json?.error?.code === "FORBIDDEN_ORIGIN", r.text);
r = await serve({ body: b() });
check("no cookie -> 404 NOT_FOUND", r.status === 404 && r.json?.error?.code === "NOT_FOUND", r.text);
r = await serve({ cookie: guest, body: b() });
check("guest -> 403 FORBIDDEN", r.status === 403 && r.json?.error?.code === "FORBIDDEN", r.text);
const other = await call("POST", "/api/sessions", { body: {} });
r = await serve({ cookie: cookieOf(other), body: b() });
check("another order's host cookie -> 404", r.status === 404, r.text);
r = await serve({ cookie: host, body: b(), idem: null });
check("no Idempotency-Key -> 400 IDEMPOTENCY_KEY", r.status === 400 && r.json?.error?.code === "IDEMPOTENCY_KEY", r.text);
r = await serve({ cookie: host, body: b({ delta: 0 }) });
check("delta 0 -> 422", r.status === 422, r.text);
r = await serve({ cookie: host, body: b({ delta: 1e9 }) });
check("huge delta -> 422", r.status === 422, r.text);
r = await serve({ cookie: host, body: b({ lineKey: "nope" }) });
check("unknown line -> 404 LINE_NOT_FOUND", r.status === 404 && r.json?.error?.code === "LINE_NOT_FOUND", r.text);
r = await serve({ cookie: host, raw: "{not json" });
check("bad JSON -> 400 BAD_JSON", r.status === 400 && r.json?.error?.code === "BAD_JSON", r.text);

r = await serve({ cookie: host, body: b({ roundId: draftRound, delta: 2 }), idem: "http-serve-" + randomUUID() });
check("host +2 -> 200 served 2", r.status === 200 && r.json?.data?.result?.served === 2 && r.json.data.replayed === false, r.text);
const idem = randomUUID();
const first = await serve({ cookie: host, body: b({ delta: 5 }), idem });
const replay = await serve({ cookie: host, body: b({ delta: 5 }), idem });
check("clamped to expected 3, replay applied once", first.json?.data?.result?.served === 3 && replay.json?.data?.replayed === true && replay.json.data.result.served === 3, first.text + replay.text);
r = await serve({ cookie: host, body: b({ delta: -99 }) });
check("clamped to 0", r.status === 200 && r.json?.data?.result?.served === 0, r.text);
const par = await Promise.all(Array.from({ length: 6 }, () => serve({ cookie: host, body: b({ delta: 1 }) })));
check("6 parallel +1 -> all 200, final 3", par.every((x) => x.status === 200) && (await sync(host)).servedCounts.find((c) => c.lineKey === lineKey)?.served === 3, par.map((x) => x.status).join());
const gsnap = await sync(guest);
check("guest /sync sees servedCounts", gsnap.servedCounts.some((c) => c.lineKey === lineKey && c.served === 3), JSON.stringify(gsnap.servedCounts));

let limited = null;
for (let i = 0; i < 130 && !limited; i++) {
  const x = await serve({ cookie: host, body: b({ delta: i % 2 ? -1 : 1 }) });
  if (x.status !== 200) limited = x;
}
check("429 RATE_LIMITED after ~120/min", limited?.status === 429 && limited.json?.error?.code === "RATE_LIMITED", limited?.text);

console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
