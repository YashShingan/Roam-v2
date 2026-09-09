import { NextResponse } from "next/server";
import { z } from "zod";
import { startCollect, getCollectState } from "@/lib/collect-manager";
import { geocodeCity } from "@/lib/geocode";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel serverless can't scrape (read-only FS, frozen background work, 60 s
// cap). When the Render backend is configured, collect requests proxy there;
// otherwise they fail with an actionable message instead of half-running.
const ON_VERCEL = process.env.VERCEL === "1";
const BACKEND = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

const Body = z.object({
  city: z.string().min(1).max(80),
  token: z.string().max(200).optional(),
  /** Wait for the full scrape (uncapped, can take minutes). Default: fire-and-forget. */
  wait: z.boolean().optional(),
});

function authOk(token?: string): boolean {
  const expected = process.env.COLLECT_TOKEN;
  return !expected || token === expected;
}

/** Nightly harvester ingest. Optionally gated: set COLLECT_TOKEN env to require it. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    if (!authOk(body.token)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (ON_VERCEL) {
      if (!BACKEND) {
        return NextResponse.json(
          {
            error:
              "Scraping does not run on Vercel serverless. Set NEXT_PUBLIC_API_URL to the Render backend (Vercel → Settings → Environment Variables), or run the harvest locally.",
          },
          { status: 503 },
        );
      }
      // proxy to the Render backend (it writes to the same Turso DB)
      const upstream = await fetch(`${BACKEND}/api/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: body.city, token: body.token, wait: body.wait ?? false }),
      });
      return NextResponse.json(await upstream.json(), { status: upstream.status });
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
      state: (await getCollectState(geo.city)) ?? null,
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
  if (ON_VERCEL && BACKEND) {
    try {
      const upstream = await fetch(`${BACKEND}/api/collect?city=${encodeURIComponent(city)}`);
      return NextResponse.json(await upstream.json(), { status: upstream.status });
    } catch {
      /* backend cold/down → fall through to local state */
    }
  }
  return NextResponse.json({ city, state: (await getCollectState(city)) ?? null });
}
