import { NextResponse } from "next/server";
import { reportProviderListing } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const { providerId, reason } = raw as { providerId?: string; reason?: string };

    if (!providerId || typeof providerId !== "string") {
      return NextResponse.json({ error: "Missing providerId" }, { status: 400 });
    }

    const cleanReason = (reason || "Suspicious or inaccurate listing").trim().slice(0, 500);
    const result = await reportProviderListing(providerId, cleanReason);

    return NextResponse.json({
      ok: true,
      providerId,
      reports: result.reports,
      flagged: result.flagged,
      message: result.flagged
        ? "Listing has been flagged and suspended for community safety review."
        : "Report recorded. Our Trust & Safety team will monitor this listing.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to record report" },
      { status: 500 },
    );
  }
}
