/** The restaurant menu link (F16): one pure check shared by the server (zod) and the form hint. Never fetches anything. */

export const MENU_URL_MAX = 500;
/** Raw input cap, so a huge body never reaches `new URL`. */
export const MENU_INPUT_MAX = 2048;

export const MENU_REASONS = {
  unparseable: "That doesn't look like a web address.",
  scheme: "Use a web link that starts with https://.",
  http: "Use the https:// address of the menu.",
  credentials: "Remove the name and password from the link.",
  ip: "Use the restaurant's web address, not an IP number.",
  local: "Use the restaurant's public web address.",
  port: "Use the menu's normal web address (no port number).",
  tooLong: "That link is too long. Try a shorter one.",
} as const;

export type ParsedMenuUrl = { ok: true; url: string; domain: string } | { ok: false; reason: string };

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];
const fail = (reason: string): ParsedMenuUrl => ({ ok: false, reason });

/** Normalises a pasted menu link, or says why it is not acceptable. Only public https hostnames pass. */
export function parseMenuUrl(input: string): ParsedMenuUrl {
  const raw = input.trim();
  if (raw.length > MENU_INPUT_MAX) return fail(MENU_REASONS.tooLong);
  let url: URL;
  try {
    url = new URL(HAS_SCHEME.test(raw) ? raw : `https://${raw}`);
  } catch {
    return fail(MENU_REASONS.unparseable);
  }
  if (url.protocol !== "https:") return fail(url.protocol === "http:" ? MENU_REASONS.http : MENU_REASONS.scheme);
  if (url.username || url.password) return fail(MENU_REASONS.credentials);
  const host = url.hostname.replace(/\.$/, "");
  const labels = host.split(".");
  if (host.startsWith("[") || /^\d+(\.\d+)*$/.test(host)) return fail(MENU_REASONS.ip);
  if (labels.length < 2 || host === "localhost" || LOCAL_SUFFIXES.some((s) => host.endsWith(s)) || !labels.every((l) => LABEL.test(l)) || /^\d+$/.test(labels[labels.length - 1])) return fail(MENU_REASONS.local);
  if (url.port) return fail(MENU_REASONS.port);
  url.hostname = host;
  if (url.href.length > MENU_URL_MAX) return fail(MENU_REASONS.tooLong);
  return { ok: true, url: url.href, domain: host };
}
