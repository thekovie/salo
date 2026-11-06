import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { checkHealth } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await checkHealth(getDb());
  return NextResponse.json(health, { status: health.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
