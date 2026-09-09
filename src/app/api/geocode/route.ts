import { NextResponse } from "next/server";
import { geocodeCity } from "@/lib/geocode";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    if (!q.trim()) return NextResponse.json({ error: "Missing ?q=" }, { status: 400 });
    const geo = await geocodeCity(q);
    if (!geo) return NextResponse.json({ error: `No match for “${q}”` }, { status: 404 });
    return NextResponse.json(geo);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "geocode failed" },
      { status: 502 },
    );
  }
}
