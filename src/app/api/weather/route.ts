import { NextResponse } from "next/server";
import { getWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const lat = Number(sp.get("lat"));
    const lon = Number(sp.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: "lat & lon required" }, { status: 400 });
    }
    const weather = await getWeather(lat, lon);
    return NextResponse.json(weather);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "weather failed" },
      { status: 502 },
    );
  }
}
