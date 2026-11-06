import { buildSummary } from "@/lib/summary";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, requireActor } from "@/server/http";
import { limitReads } from "@/server/limits";
import { MAX_SUMMARY_HEIGHT, renderSummary, summaryHeight } from "@/server/og/summary-image";
import { getSnapshot } from "@/server/sessions/snapshot";

/** The device formats the date in its own time zone and sends it along; anything odd falls back to an ISO date. */
const DATE_LABEL = /^[\p{L}\p{N} ,.]{1,40}$/u;

/** "Who ordered what" as a PNG, for people in this order only (never for crawlers or strangers). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    limitReads(actor);
    const summary = buildSummary(await getSnapshot(getDb(), actor));
    if (summaryHeight(summary) > MAX_SUMMARY_HEIGHT) throw new AppError(413, "TOO_LONG", "Too long for one image. Use Copy text instead.");
    const raw = new URL(request.url).searchParams.get("date") ?? "";
    const date = DATE_LABEL.test(raw) ? raw : new Date().toISOString().slice(0, 10);
    const image = await renderSummary(summary, date);
    image.headers.set("Cache-Control", "private, no-store");
    return image;
  });
}
