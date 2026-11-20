// HTTP contract checks for POST /dishes/:dishId/unavailable and the batch POST /corrections against a running dev server.
// Usage: BASE=http://localhost:3000 node scripts/contract/unavailable-corrections-http.mjs
// Creates only its own orders (never truncates). Exit code 1 on any failed check. See docs/contracts/unavailable-corrections.md.
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3000";
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
  if (!ok) failed++;
};
const within = (p, what) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`deadline ${what}`)), 15000))]);

async function call(method, path, { cookie, body, origin = BASE, idem = randomUUID() } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  if (idem && method !== "GET") headers["idempotency-key"] = idem;
  const res = await within(fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" }), `${method} ${path}`);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie?.() ?? [] };
}
const cookieOf = (r) => r.setCookie.map((c) => c.split(";")[0]).join("; ");
await within(fetch(`${BASE}/api/health`), "health").then((r) => r.json()).then((j) => check("health", j.ok === true)).catch((e) => { console.log("server not reachable", e.message); process.exit(2); });

const created = await call("POST", "/api/sessions", { body: {} });
const sid = created.json.data.id;
const host = cookieOf(created);
const sync = async () => (await call("GET", `/api/sessions/${sid}/sync`, { cookie: host })).json.data;
const joined = await call("POST", `/api/sessions/${sid}/join`, { body: { code: (await sync()).session.joinCode, displayName: "Ana" } });
const guest = cookieOf(joined);
const addEntry = (cookie, dishName, quantity, variant) => call("POST", `/api/sessions/${sid}/entries`, { cookie, body: { dishName, quantity, variant, attribution: { type: "INDIVIDUAL" } } });
await addEntry(host, "Sisig", 2, "Large");
await addEntry(guest, "Sisig", 1);
await addEntry(host, "Katsu", 1);
let s = await sync();
const confirm = async () => {
  const cur = await sync();
  return call("POST", `/api/sessions/${sid}/rounds/${cur.activeRoundId}/confirm`, { cookie: host, body: { expectedRevision: cur.session.revision } });
};
check("confirm round 1", (await confirm()).status === 200);
check("open round 2", (await call("POST", `/api/sessions/${sid}/rounds`, { cookie: host })).status === 201);
s = await sync();
const sisig = s.entries.filter((e) => e.dishName === "Sisig");
const dishId = sisig[0].dishId;
const unav = (o) => call("POST", `/api/sessions/${sid}/dishes/${o.dish ?? dishId}/unavailable`, o);

// batch corrections over HTTP
const batchBody = { entries: sisig.map((e) => ({ sourceEntryId: e.id, quantity: 1 })), type: "QUANTITY" };
let r = await call("POST", `/api/sessions/${sid}/corrections`, { cookie: host, body: batchBody });
check("batch 201 with correctionIds and groupId", r.status === 201 && r.json?.data?.result?.correctionIds?.length === 2 && !!r.json.data.result.groupId, r.text);
r = await call("DELETE", `/api/sessions/${sid}/corrections/${r.json.data.result.correctionIds[0]}`, { cookie: host });
check("DELETE one row removes the group", r.status === 200 && (await sync()).corrections.length === 0, r.text);
r = await call("POST", `/api/sessions/${sid}/corrections`, { cookie: host, body: { sourceEntryId: sisig[0].id, type: "QUANTITY", quantity: 1 } });
check("old single body 201", r.status === 201 && !!r.json?.data?.result?.correctionId, r.text);

// auth / origin
r = await unav({ cookie: host, origin: null });
check("no Origin -> 403 FORBIDDEN_ORIGIN", r.status === 403 && r.json?.error?.code === "FORBIDDEN_ORIGIN", r.text);
r = await unav({ cookie: host, origin: "https://evil.example" });
check("foreign Origin -> 403 FORBIDDEN_ORIGIN", r.status === 403 && r.json?.error?.code === "FORBIDDEN_ORIGIN", r.text);
r = await unav({});
check("no cookie -> 404 NOT_FOUND", r.status === 404 && r.json?.error?.code === "NOT_FOUND", r.text);
r = await unav({ cookie: guest });
check("guest -> 403 FORBIDDEN", r.status === 403 && r.json?.error?.code === "FORBIDDEN", r.text);
const other = await call("POST", "/api/sessions", { body: {} });
r = await unav({ cookie: cookieOf(other) });
check("another order's host cookie -> 404", r.status === 404, r.text);
r = await unav({ cookie: host, dish: randomUUID() });
check("unknown dish -> 404 DISH_NOT_FOUND", r.status === 404 && r.json?.error?.code === "DISH_NOT_FOUND", r.text);
r = await unav({ cookie: host, dish: "nope" });
check("non-uuid dish -> 404 DISH_NOT_FOUND", r.status === 404 && r.json?.error?.code === "DISH_NOT_FOUND", r.text);
r = await unav({ cookie: host, idem: null });
check("missing key -> 400 IDEMPOTENCY_KEY", r.status === 400 && r.json?.error?.code === "IDEMPOTENCY_KEY", r.text);
r = await unav({ cookie: host, body: { replacement: "x".repeat(61) } });
check("replacement 61 chars -> 422 INVALID", r.status === 422 && r.json?.error?.code === "INVALID", r.text);

// the change, and its replay
const before = await sync();
const idem = randomUUID();
r = await unav({ cookie: host, idem, body: { note: "out" } });
check("unavailable 200 with result shape", r.status === 200 && Array.isArray(r.json?.data?.result?.removedEntryIds) && r.json.data.replayed === false, r.text);
const rep = await unav({ cookie: host, idem, body: { note: "out" } });
check("replay: replayed true, same revision", rep.status === 200 && rep.json.data.replayed === true && rep.json.data.revision === r.json.data.revision, rep.text);
const after = await sync();
const r1 = after.rounds[0].id;
check("round 1 ticket unchanged", JSON.stringify(after.tickets[r1]) === JSON.stringify(before.tickets[r1]));
const mine = after.corrections.filter((c) => c.reason === "UNAVAILABLE");
check("2 told rows, one group, own confirmed round", mine.length === 2 && new Set(mine.map((c) => c.groupId)).size === 1 && mine.every((c) => c.targetRoundId === r1), JSON.stringify(mine));
r = await call("DELETE", `/api/sessions/${sid}/corrections/${mine[0].id}`, { cookie: host });
check("told row cannot be removed -> 409 ROUND_CONFIRMED", r.status === 409 && r.json?.error?.code === "ROUND_CONFIRMED", r.text);
r = await unav({ cookie: host });
check("again -> 409 NOTHING_LEFT", r.status === 409 && r.json?.error?.code === "NOTHING_LEFT", r.text);
process.exit(failed ? 1 : 0);
