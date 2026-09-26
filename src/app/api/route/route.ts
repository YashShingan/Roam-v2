import { NextResponse } from "next/server";
import { haversineKm } from "@/lib/net";

export const dynamic = "force-dynamic";

interface OsrmResponse {
  code?: string;
  routes?: {
    legs?: { duration: number; distance: number; geometry?: { coordinates: [number, number][] } }[];
    duration?: number;
  }[];
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const raw = sp.get("waypoints") ?? "";
    const mode = sp.get("mode") === "drive" ? "driving" : "foot";
    const pts = raw
      .split(";")
      .map((p) => p.split(",").map(Number))
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
    if (pts.length < 2) {
      return NextResponse.json({ error: "waypoints=lat,lon;lat,lon[;...] (min 2)" }, { status: 400 });
    }
    const coords = pts.map(([lat, lon]) => `${lon},${lat}`).join(";");
    try {
      const res = await fetch(`https://router.project-osrm.org/route/v1/${mode}/${coords}?overview=full&geometries=geojson`, {
        signal: AbortSignal.timeout(12000),
        headers: { "User-Agent": "RoamApp/1.0" },
      });
      const j = (await res.json()) as OsrmResponse;
      const legs = j.routes?.[0]?.legs;
      if (res.ok && legs && legs.length === pts.length - 1) {
        return NextResponse.json({
          engine: "OSRM",
          legs: legs.map((l) => {
            const km = Number((l.distance / 1000).toFixed(2));
            const minutes =
              km < 0.03
                ? 0
                : mode === "driving"
                  ? Math.max(2, Math.round((km / 24) * 60 + 1))
                  : Math.max(1, Math.round((km / 4.8) * 60));
            return {
              minutes,
              km,
              geometry: (l.geometry?.coordinates ?? []).map(([lon, lat]) => [lat, lon] as [number, number]),
            };
          }),
        });
      }
      throw new Error(`OSRM code ${j.code ?? res.status}`);
    } catch {
      // Haversine fallback: walk ×1.4 at 4.5 km/h, drive ×1.3 at 28 km/h
      const legs = [];
      for (let i = 1; i < pts.length; i++) {
        const km = haversineKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) * (mode === "foot" ? 1.4 : 1.3);
        legs.push({
          minutes: Math.max(1, Math.round((km / (mode === "foot" ? 4.5 : 28)) * 60)),
          km: Number(km.toFixed(2)),
          geometry: [
            [pts[i - 1][0], pts[i - 1][1]] as [number, number],
            [pts[i][0], pts[i][1]] as [number, number],
          ],
        });
      }
      return NextResponse.json({ engine: "haversine-fallback", legs });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "route failed" },
      { status: 502 },
    );
  }
}
