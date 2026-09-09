import { NextResponse } from "next/server";
import { z } from "zod";
import { getTrip, updateTrip, getVotes } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const plan = getTrip(id);
  if (!plan) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  return NextResponse.json({ plan, votes: getVotes(id) });
}

const PatchBody = z.object({
  days: z
    .array(
      z.object({
        stops: z.array(
          z.object({
            experienceId: z.string(),
            name: z.string(),
            category: z.string(),
            slotStart: z.string(),
            slotEnd: z.string(),
            travelMinFromPrev: z.number(),
            lat: z.number().optional(),
            lon: z.number().optional(),
            durationMinutes: z.number(),
            pricePerPerson: z.number().optional(),
            note: z.string().optional(),
            visited: z.boolean().optional(),
            locked: z.boolean().optional(),
          }),
        ),
        totalHours: z.number(),
      }),
    )
    .max(7)
    .optional(),
  voiceSummary: z.string().max(4000).optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const plan = await getTrip(id);
    if (!plan) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    const body = PatchBody.parse(await req.json());
    if (body.days) plan.days = body.days as never;
    if (body.voiceSummary) plan.voiceSummary = body.voiceSummary;
    await updateTrip(plan);
    return NextResponse.json({ plan });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "update failed" },
      { status: 400 },
    );
  }
}
