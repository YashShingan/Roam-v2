import { NextResponse } from "next/server";
import { z } from "zod";
import { simulateScenario } from "@/lib/digital-twin";
import { getPlacesForCity } from "@/lib/places-service";

export const dynamic = "force-dynamic";

const ScenarioSchema = z.object({
  precipMm: z.number().optional(),
  tempC: z.number().optional(),
  windKmh: z.number().optional(),
  floodLevel: z.enum(["none", "minor", "major"]).optional(),
  preferTransit: z.boolean().optional(),
});

const BodySchema = z.object({
  plan: z.any(), // Validated as TripPlan in simulateScenario
  scenario: ScenarioSchema,
  weatherVector: z.any().optional(),
});

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const body = BodySchema.parse(raw);
    const city = body.plan?.city || "Pune";

    // Fetch candidate places for substitutions
    const { places } = await getPlacesForCity(city);

    const result = await simulateScenario(body.plan, body.scenario, places, body.weatherVector);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "twin simulation failed",
      },
      { status: 400 },
    );
  }
}
