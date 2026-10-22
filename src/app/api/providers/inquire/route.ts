import { NextResponse } from "next/server";
import { recordProviderInquiry } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const { providerId } = raw as { providerId?: string };

    if (!providerId || typeof providerId !== "string") {
      return NextResponse.json({ error: "Missing or invalid providerId" }, { status: 400 });
    }

    await recordProviderInquiry(providerId);

    return NextResponse.json({ ok: true, providerId, timestamp: Date.now() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to record inquiry" },
      { status: 500 },
    );
  }
}
