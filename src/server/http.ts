import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { log } from "@/lib/logger";
import { removedFrom, resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { AppError, notFound } from "@/server/errors";
import type { Actor } from "@/lib/permissions";

/** Request bodies are tiny (one dish at a time); anything bigger is refused before parsing (brief 11.3). */
export const MAX_BODY_BYTES = 8 * 1024;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Consistent error envelope for every route: known errors say what happened; unknown ones are logged, never leaked. */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError) return fail(error.status, error.code, error.message);
    if (error instanceof ZodError) return fail(422, "INVALID", error.issues[0]?.message ?? "Check what you entered.");
    log.error("request failed", { error });
    return fail(500, "INTERNAL", "Something went wrong on our side. Try again in a moment.");
  }
}

export async function readJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new AppError(413, "TOO_LARGE", "That request is too large.");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new AppError(413, "TOO_LARGE", "That request is too large.");
  let body: unknown;
  try {
    body = text === "" ? {} : JSON.parse(text);
  } catch {
    throw new AppError(400, "BAD_JSON", "The request could not be read.");
  }
  return schema.parse(body);
}

/** Every mutation carries a client-made key so a retry after a dropped connection is applied once (brief 7.4). */
export function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY.test(key)) throw new AppError(400, "IDEMPOTENCY_KEY", "Missing or invalid Idempotency-Key header.");
  return key;
}

/**
 * The caller's identity in this session, from their cookie. Strangers get "not found", not a hint the order exists.
 * A removed guest gets 403 REMOVED so their open screen can say so (the reason is only on their own page).
 */
export async function requireActor(sessionId: string): Promise<Actor> {
  const token = (await cookies()).get(credentialCookieName(sessionId))?.value;
  const actor = await resolveActor(getDb(), sessionId, token);
  if (actor) return actor;
  if (await removedFrom(getDb(), sessionId, token)) throw new AppError(403, "REMOVED", "The host removed you from this order.");
  throw notFound();
}
