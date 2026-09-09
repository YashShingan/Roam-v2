import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpVote } from "@/lib/db";

export const dynamic = "force-dynamic";

const Body = z.object({
  stopName: z.string().min(1).max(120),
  delta: z.number().int().min(-1).max(1),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = Body.parse(await req.json());
    const votes = bumpVote(id, body.stopName, body.delta);
    return NextResponse.json({ votes });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "vote failed" },
      { status: 400 },
    );
  }
}
