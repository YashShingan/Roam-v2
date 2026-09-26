import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlacesForCity } from "@/lib/places-service";
import { adaptPlanForWeather, trimPlanForLateRunning, suggestAlternativesForStop } from "@/lib/circumstance-adapter";
import type { TripPlan, Experience } from "@/lib/types";

export const dynamic = "force-dynamic";

const AdaptRequestSchema = z.object({
  action: z.enum(["weather", "running_late", "alternatives"]),
  plan: z.any(), // TripPlan object
  city: z.string().min(1),
  condition: z.enum(["rain", "heat"]).optional().default("rain"),
  dayIndex: z.number().int().min(0).optional().default(0),
  delayMinutes: z.number().int().min(15).max(300).optional().default(60),
  stopId: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const data = AdaptRequestSchema.parse(raw);
    const plan = data.plan as TripPlan;

    const { places } = await getPlacesForCity(data.city);

    if (data.action === "weather") {
      const result = adaptPlanForWeather(plan, places, data.condition);
      return NextResponse.json(result);
    }

    if (data.action === "running_late") {
      const result = trimPlanForLateRunning(plan, data.dayIndex, data.delayMinutes);
      return NextResponse.json(result);
    }

    if (data.action === "alternatives") {
      const targetStop = plan.days
        .flatMap((d) => d.stops)
        .find((s) => s.experienceId === data.stopId || s.name === data.stopId);
      if (!targetStop) {
        return NextResponse.json({ error: "Stop not found" }, { status: 404 });
      }
      const alternatives = suggestAlternativesForStop(targetStop, places, 3);
      return NextResponse.json({ alternatives });
    }

    return NextResponse.json({ error: "Unknown adaptation action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Adaptation failed" },
      { status: 500 },
    );
  }
}
