#!/usr/bin/env node
// Checks live updates through a reverse proxy (brief 7.8): events arrive promptly and unbuffered, heartbeats keep an
// idle stream open past common proxy timeouts, and a reconnect with Last-Event-ID replays what was missed.
// Usage: node scripts/sse-proxy-check.mjs [base-url] [idle-seconds]   (default http://localhost:8080, 75)
// With the bot check on (production), start an order in a browser and pass it in: the script joins it as a guest
// named "Proxy check" instead of creating one, and removes its test dishes at the end.
//   SALO_ORDER=https://salo.example.com/s/<id> SALO_CODE=<join code> node scripts/sse-proxy-check.mjs https://salo.example.com 75
const base = process.argv[2] ?? "http://localhost:8080";
const idleSeconds = Number(process.argv[3] ?? 75);
const headers = { "Content-Type": "application/json", Origin: base };

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

const joinId = process.env.SALO_ORDER?.split("/s/").pop()?.split(/[/?#]/)[0];
const response = joinId
  ? await fetch(`${base}/api/sessions/${joinId}/join`, { method: "POST", headers, body: JSON.stringify({ code: process.env.SALO_CODE ?? "", displayName: "Proxy check" }) })
  : await fetch(`${base}/api/sessions`, { method: "POST", headers, body: "{}" });
if (response.status !== 201 && response.status !== 200) fail(`${joinId ? "join" : "create"} session: HTTP ${response.status} ${await response.text()}`);
const { data } = await response.json();
const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const id = data.id;
const added = [];

async function addDish(name) {
  const r = await fetch(`${base}/api/sessions/${id}/entries`, {
    method: "POST",
    headers: { ...headers, Cookie: cookie, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ dishName: name, quantity: 1 }),
  });
  if (r.status !== 201) fail(`add ${name}: HTTP ${r.status}`);
  const { data } = await r.json();
  added.push(data.entryId);
  return data.revision;
}

/** Opens the stream and resolves every frame as it arrives, with its arrival time. */
async function openStream(extraHeaders = {}) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/sessions/${id}/events?after=1`, { headers: { Cookie: cookie, ...extraHeaders }, signal: controller.signal });
  if (response.status !== 200) fail(`stream: HTTP ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("text/event-stream")) fail(`stream content-type: ${type}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  let buffer = "";
  const waiters = [];
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          frames.push({ text: buffer.slice(0, index), at: Date.now() });
          buffer = buffer.slice(index + 2);
          for (const w of waiters.splice(0)) w();
        }
      }
    } catch {
      /* aborted */
    }
  })();
  const waitFor = async (predicate, timeoutMs, what) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = frames.find(predicate);
      if (hit) return hit;
      if (Date.now() > deadline) fail(`timed out waiting for ${what}`);
      await new Promise((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 250);
      });
    }
  };
  return { frames, waitFor, close: () => controller.abort() };
}

const stream = await openStream();
await stream.waitFor((f) => f.text.startsWith("retry:"), 5000, "the retry frame");

const sentAt = Date.now();
const revision = await addDish("Gyoza");
const event = await stream.waitFor((f) => f.text.includes(`id: ${revision}`), 5000, `event ${revision}`);
const latency = event.at - sentAt;
console.log(`ok  event delivered through the proxy in ${latency} ms`);
if (latency > 1000) fail(`latency ${latency} ms is over the 1 s target (brief 14)`);

console.log(`..  idling ${idleSeconds} s to check heartbeats keep the stream open`);
const idleStart = Date.now();
await new Promise((r) => setTimeout(r, idleSeconds * 1000));
const pings = stream.frames.filter((f) => f.text.startsWith(": ping") && f.at >= idleStart).length;
if (pings < Math.floor(idleSeconds / 20) - 1) fail(`only ${pings} heartbeats in ${idleSeconds} s (expected one per 20 s)`);
const late = await addDish("Rice");
await stream.waitFor((f) => f.text.includes(`id: ${late}`), 5000, `event ${late} after idling`);
console.log(`ok  ${pings} heartbeats while idle; stream still delivering after ${idleSeconds} s`);
stream.close();

// Missed while disconnected: reconnect with Last-Event-ID and get it replayed.
const missed = await addDish("Iced Tea");
const replay = await openStream({ "Last-Event-ID": String(late) });
await replay.waitFor((f) => f.text.includes(`id: ${missed}`), 5000, `replay of ${missed}`);
replay.close();
console.log("ok  reconnect with Last-Event-ID replayed the missed event");
if (joinId) {
  for (const entryId of added) {
    await fetch(`${base}/api/sessions/${id}/entries/${entryId}`, { method: "DELETE", headers: { ...headers, Cookie: cookie, "Idempotency-Key": crypto.randomUUID() } });
  }
  console.log(`ok  removed the ${added.length} test dishes (remove the "Proxy check" guest from the order if you like)`);
}
console.log("PASS");
process.exit(0);
