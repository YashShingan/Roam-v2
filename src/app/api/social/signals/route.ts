import { NextResponse } from "next/server";
import { getCitySocialSignals } from "@/lib/social-signals";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const city = sp.get("city") || "Pune";
    const rain = Number(sp.get("rain")) || 0;
    const signals = await getCitySocialSignals(city, rain);
    return NextResponse.json({ city, signals });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to fetch social signals" },
      { status: 500 },
    );
  }
}
