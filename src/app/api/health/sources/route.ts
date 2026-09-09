import { NextResponse } from "next/server";
import { getCollectorHealth } from "@/lib/collectors";
import { getCollectState } from "@/lib/collect-manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const city = new URL(req.url).searchParams.get("city");
  const health = getCollectorHealth();
  return NextResponse.json({
    ok: health.every((h) => h.ok) || health.length === 0,
    collectors: health,
    discovery: city ? (getCollectState(city) ?? null) : null,
    checkedAt: new Date().toISOString(),
  });
}
