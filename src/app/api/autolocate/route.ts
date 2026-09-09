import { NextResponse } from "next/server";
import { getJson } from "@/lib/net";
import { reverseGeocode } from "@/lib/geocode";

export const dynamic = "force-dynamic";

interface IpApi {
  status: string;
  message?: string;
  city?: string;
  regionName?: string;
  country?: string;
  lat?: number;
  lon?: number;
}

export async function GET(req: Request) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "";
    const j = await getJson<IpApi>(
      `http://ip-api.com/json/${ip}?fields=status,message,city,regionName,country,lat,lon`,
      { timeoutMs: 8000, retries: 1 },
    );
    if (j.status !== "success" || j.lat === undefined || j.lon === undefined) {
      throw new Error(j.message ?? "ip lookup failed");
    }
    const city = j.city ?? (await reverseGeocode(j.lat, j.lon));
    return NextResponse.json({
      city,
      label: [j.city, j.regionName, j.country].filter(Boolean).join(", "),
      lat: j.lat,
      lon: j.lon,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "locate failed" },
      { status: 200 },
    );
  }
}
