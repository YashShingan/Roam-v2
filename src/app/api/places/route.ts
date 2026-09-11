import { NextResponse } from "next/server";
import { getPlacesForCity } from "@/lib/places-service";
import { parseBbox } from "@/lib/net";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// On Vercel, proxy to the Render backend so the full 13-source pipeline runs
// there (writable FS, no timeout). Vercel serverless can still serve from
// Turso directly as a fallback.
const ON_VERCEL = process.env.VERCEL === "1";
const BACKEND = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "https://roam-cmtg.onrender.com").replace(/\/$/, "");

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const city = sp.get("city") ?? "";
  const bbox = parseBbox(sp.get("bbox"));
  const radius = bbox
    ? Math.min(Math.round(Math.max(bbox.e - bbox.w, bbox.n - bbox.s) * 55), 25)
    : Number(sp.get("radius")) || 15;
  if (!city.trim()) {
    return NextResponse.json({ error: "Missing ?city= (e.g. city=Kalyan)" }, { status: 400 });
  }

  // Proxy to Render when running on Vercel and backend is configured
  if (ON_VERCEL && BACKEND) {
    try {
      const upstream = await fetch(
        `${BACKEND}/api/places?city=${encodeURIComponent(city)}&radius=${radius}${sp.get("bbox") ? `&bbox=${sp.get("bbox")}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(55_000) },
      );
      const data = await upstream.json();
      return NextResponse.json(data, { status: upstream.status });
    } catch {
      // Render cold/down → fall through to local Turso read
    }
  }

  try {
    const result = await getPlacesForCity(city, { radiusKm: radius });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "places aggregation failed", places: [] },
      { status: 502 },
    );
  }
}
