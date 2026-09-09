import { NextResponse } from "next/server";
import { suggestCities } from "@/lib/geocode";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const suggestions = await suggestCities(q, 6);
    return NextResponse.json({ suggestions });
  } catch (e) {
    return NextResponse.json(
      { suggestions: [], error: e instanceof Error ? e.message : "suggest failed" },
      { status: 200 },
    );
  }
}
