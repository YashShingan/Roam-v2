import { NextResponse } from "next/server";
import { z } from "zod";
import { startCollect, getCollectState } from "@/lib/collect-manager";
import { geocodeCity } from "@/lib/geocode";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  city: z.string().min(1).max(80),
  token: z.string().max(200).optional(),
  /** Wait for the full scrape (uncapped, can take minutes). Default: fire-and-forget. */
  wait: z.boolean().optional(),
});

/** Nightly harvester ingest. Optionally gated: set COLLECT_TOKEN env to require it. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const expected = process.env.COLLECT_TOKEN;
    if (expected && body.token !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const geo = await geocodeCity(body.city);
    if (!geo) return NextResponse.json({ error: `Could not locate ${body.city}` }, { status: 404 });
    const label = geo.label.split(",").slice(0, 2).join(", ");
    const ctx = { city: geo.city, label, lat: geo.lat, lon: geo.lon, radiusKm: 15 };
    const task = startCollect(geo.city, ctx);
    if (body.wait) {
      const st = await task;
      return NextResponse.json({
        city: geo.city,
        status: st.status,
        collected: st.places,
        stored: st.places,
        added: st.added,
        error: st.error,
        harvestedAt: new Date().toISOString(),
      });
    }
    return NextResponse.json({
      city: geo.city,
      started: true,
      state: getCollectState(geo.city) ?? null,
      harvestedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "harvest failed" },
      { status: 502 },
    );
  }
}

/** Poll scrape progress: GET /api/collect?city=Kalyan */
export async function GET(req: Request) {
  const city = new URL(req.url).searchParams.get("city") ?? "";
  if (!city.trim()) {
    return NextResponse.json({ error: "Missing ?city=" }, { status: 400 });
  }
  return NextResponse.json({ city, state: getCollectState(city) ?? null });
}
