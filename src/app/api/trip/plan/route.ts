import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlacesForCity } from "@/lib/places-service";
import { buildTripPlan } from "@/lib/planner";
import { saveTrip } from "@/lib/db";
import { getWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Body = z.object({
  city: z.string().min(1).max(80),
  days: z.number().int().min(1).max(7).default(1),
  hoursPerDay: z.number().min(2).max(15).default(8),
  interests: z.array(z.string()).max(8).optional(),
  strictCategories: z.boolean().optional(),
  selectedPlaceIds: z.array(z.string()).max(60).optional(),
  lockedPlaceIds: z.array(z.string()).max(60).optional(),
  excludedPlaceIds: z.array(z.string()).max(60).optional(),
  budget: z.number().min(0).max(100000).optional(),
  vibe: z.enum(["chill", "packed", "foodie", "heritage"]).optional(),
  transportMode: z.enum(["walk", "drive"]).optional(),
  timeMode: z.enum(["recommended", "capped"]).optional(),
  startAnchor: z
    .object({
      type: z.enum(["city", "gps", "place"]),
      label: z.string(),
      lat: z.number(),
      lon: z.number(),
      placeId: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    // Planning needs the full picture — block (capped) until the scrape finishes.
    const { places, lat, lon, cityLabel, radiusKm } = await getPlacesForCity(body.city, {
      awaitCollect: true,
    });
    if (places.length === 0) {
      return NextResponse.json(
        { error: `No places found for ${body.city} yet — try a larger nearby city.` },
        { status: 404 },
      );
    }
    let sunsetMin: number | undefined;
    try {
      if (lat && lon) sunsetMin = (await getWeather(lat, lon)).sunsetMin;
    } catch {
      /* weather optional */
    }
    const plan = await buildTripPlan(places, {
      city: body.city,
      cityLabel,
      lat,
      lon,
      days: body.days,
      hoursPerDay: body.hoursPerDay,
      interests: body.interests as never,
      strictCategories: body.strictCategories,
      selectedPlaceIds: body.selectedPlaceIds,
      lockedPlaceIds: body.lockedPlaceIds,
      excludedPlaceIds: body.excludedPlaceIds,
      budget: body.budget,
      vibe: body.vibe,
      sunsetMin,
      radiusKm,
      transportMode: body.transportMode,
      timeMode: body.timeMode,
      startAnchor: body.startAnchor,
    });
    await saveTrip(plan);
    return NextResponse.json({ plan });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "planning failed" },
      { status: 502 },
    );
  }
}
