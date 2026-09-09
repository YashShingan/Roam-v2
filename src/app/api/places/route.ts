import { NextResponse } from "next/server";
import { getPlacesForCity } from "@/lib/places-service";
import { parseBbox } from "@/lib/net";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
