import { NextResponse } from "next/server";
import { getCollectorHealth } from "@/lib/collectors";
import { getCollectState } from "@/lib/collect-manager";
import { getDataMode } from "@/lib/db";

export const dynamic = "force-dynamic";

const ON_VERCEL = process.env.VERCEL === "1";
const BACKEND = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "https://roam-cmtg.onrender.com").replace(/\/$/, "");

export async function GET(req: Request) {
  const city = new URL(req.url).searchParams.get("city");

  // On Vercel, proxy to Render backend for real collector health data
  if (ON_VERCEL && BACKEND) {
    try {
      const upstream = await fetch(
        `${BACKEND}/api/health/sources${city ? `?city=${encodeURIComponent(city)}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(15_000) },
      );
      const data = await upstream.json();
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      // Render cold/down → fall through to local health
    }
  }

  const health = await getCollectorHealth();
  return NextResponse.json({
    ok: health.every((h) => h.ok) || health.length === 0,
    collectors: health,
    dataMode: getDataMode(),
    discovery: city ? ((await getCollectState(city)) ?? null) : null,
    checkedAt: new Date().toISOString(),
  });
}
