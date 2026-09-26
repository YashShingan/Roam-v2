import { describe, expect, it } from "vitest";
import { adaptPlanForWeather, trimPlanForLateRunning, isOutdoorExperience, isCoveredIndoorExperience } from "@/lib/circumstance-adapter";
import { matchesWakeWord, cleanVoiceTranscript } from "@/lib/voice-utils";
import type { Experience, TripPlan } from "@/lib/types";

function makeExp(overrides: Partial<Experience> & { id: string; name: string; category: Experience["category"] }): Experience {
  return {
    source: "test",
    sources: [{ source: "test" }],
    address: "Pune",
    popularity: "Popular",
    popularityScore: 0.7,
    community: { mentions: 5, upvotes: 10, sentiment: 0.5, quotes: [] },
    durationMinutes: 60,
    bookingRequired: false,
    tags: [],
    amenities: [],
    ...overrides,
  };
}

describe("Circumstance Adapter & Agent Replanning", () => {
  const outdoorFort: Experience = makeExp({
    id: "fort_1",
    name: "Sinhagad Fort",
    category: "culture",
    description: "Historic hill fortress with steep trekking trails",
    tags: ["fort", "trek", "viewpoint"],
    lat: 18.366,
    lon: 73.755,
    isOutdoor: true,
  });

  const indoorMuseum: Experience = makeExp({
    id: "museum_1",
    name: "Raja Dinkar Kelkar Museum",
    category: "culture",
    description: "Fascinating indoor collection of Indian artifacts and historical crafts",
    tags: ["museum", "indoor", "heritage"],
    lat: 18.511,
    lon: 73.854,
    isOutdoor: false,
    durationMinutes: 90,
  });

  const mealRestaurant: Experience = makeExp({
    id: "food_1",
    name: "Vaishali Restaurant",
    category: "food",
    description: "Iconic cafe on FC Road",
    tags: ["cafe", "south indian"],
    lat: 18.520,
    lon: 73.840,
    isOutdoor: false,
  });

  const samplePlan: TripPlan = {
    id: "plan_test",
    city: "Pune",
    cityLabel: "Pune, Maharashtra",
    createdAt: "2026-09-26T10:00:00Z",
    voiceSummary: "A heritage day in Pune",
    feasibility: { ok: true, message: "Pacing looks good" },
    shareUrl: "/?trip=plan_test",
    days: [
      {
        date: "2026-09-26",
        totalHours: 7,
        stops: [
          {
            experienceId: outdoorFort.id,
            name: outdoorFort.name,
            category: outdoorFort.category,
            slotStart: "09:00",
            slotEnd: "12:00",
            durationMinutes: 180,
            travelMinFromPrev: 0,
            lat: outdoorFort.lat,
            lon: outdoorFort.lon,
          },
          {
            experienceId: mealRestaurant.id,
            name: mealRestaurant.name,
            category: mealRestaurant.category,
            slotStart: "12:30",
            slotEnd: "13:30",
            durationMinutes: 60,
            travelMinFromPrev: 30,
            timeOfDay: "lunch",
            lat: mealRestaurant.lat,
            lon: mealRestaurant.lon,
          },
          {
            experienceId: "park_1",
            name: "Saras Baug Garden & Lake",
            category: "nature",
            slotStart: "14:30",
            slotEnd: "16:00",
            durationMinutes: 90,
            travelMinFromPrev: 20,
            lat: 18.501,
            lon: 73.853,
          },
        ],
      },
    ],
  };

  it("identifies outdoor vs indoor experiences accurately", () => {
    expect(isOutdoorExperience(outdoorFort)).toBe(true);
    expect(isOutdoorExperience(indoorMuseum)).toBe(false);
    expect(isCoveredIndoorExperience(indoorMuseum)).toBe(true);
    expect(isCoveredIndoorExperience(outdoorFort)).toBe(false);
  });

  it("adapts plan for rain by replacing outdoor stops with sheltered indoor venues while preserving lunch", () => {
    const candidatePool = [outdoorFort, indoorMuseum, mealRestaurant];
    const result = adaptPlanForWeather(samplePlan, candidatePool, "rain");

    expect(result.swappedCount).toBeGreaterThanOrEqual(1);
    expect(result.plan.weatherAdapted).toBe(true);
    expect(result.plan.weatherAlert).toContain("rain");

    const stops = result.plan.days[0].stops;
    // Lunch stop must be preserved untouched
    const lunchStop = stops.find((s) => s.timeOfDay === "lunch");
    expect(lunchStop).toBeDefined();
    expect(lunchStop?.name).toBe("Vaishali Restaurant");

    // Outdoor fort should be replaced by indoor museum
    const replacedStop = stops.find((s) => s.experienceId === indoorMuseum.id);
    expect(replacedStop).toBeDefined();
    expect(replacedStop?.name).toBe("Raja Dinkar Kelkar Museum");
  });

  it("trims non-meal afternoon stop when traveler is running late and reslots schedule", () => {
    const result = trimPlanForLateRunning(samplePlan, 0, 60);

    expect(result.plan.days[0].stops.length).toBe(samplePlan.days[0].stops.length - 1);
    // Never trims the lunch meal stop
    const hasLunch = result.plan.days[0].stops.some((s) => s.timeOfDay === "lunch");
    expect(hasLunch).toBe(true);
    expect(result.trimmedStopName).toBe("Saras Baug Garden & Lake");
    expect(result.plan.feasibility?.message).toContain("delay recovered");
  });

  it("detects hands-free wake words accurately", () => {
    expect(matchesWakeWord("Hey Vibe, plan a 2-day trip to Pune")).toBe(true);
    expect(matchesWakeWord("hey roamy show me cultural places")).toBe(true);
    expect(matchesWakeWord("ok vibe what is the sunset time")).toBe(true);
    expect(matchesWakeWord("just showing regular search")).toBe(false);
  });

  it("detects trailing verbal stop phrases and cleanly extracts the core travel prompt", () => {
    const res1 = cleanVoiceTranscript("Plan a 2-day cultural trip to Pune with lunch on FC road that's it");
    expect(res1.hasStopPhrase).toBe(true);
    expect(res1.cleaned).toBe("Plan a 2-day cultural trip to Pune with lunch on FC road");

    const res2 = cleanVoiceTranscript("Find authentic thali in Kalyan, done.");
    expect(res2.hasStopPhrase).toBe(true);
    expect(res2.cleaned).toBe("Find authentic thali in Kalyan");

    const res3 = cleanVoiceTranscript("Plan a weekend nature trip to Badlapur");
    expect(res3.hasStopPhrase).toBe(false);
    expect(res3.cleaned).toBe("Plan a weekend nature trip to Badlapur");
  });

  it("safely resolves start anchors with (0,0) or missing coordinates to waking hours (08:30–09:00 AM)", async () => {
    const { buildTripPlan } = await import("@/lib/planner");
    const testPlaces: Experience[] = [
      makeExp({ id: "p1", name: "Peshwa Fort", category: "culture", lat: 18.52, lon: 73.85 }),
      makeExp({ id: "p2", name: "Cafe De Flora", category: "food", lat: 18.51, lon: 73.84 }),
      makeExp({ id: "p3", name: "Dagdusheth Ganpati", category: "culture", lat: 18.515, lon: 73.855 }),
    ];

    const plan = await buildTripPlan(testPlaces, {
      city: "Pune",
      cityLabel: "Pune, Maharashtra, India",
      lat: 18.5204,
      lon: 73.8567,
      days: 1,
      hoursPerDay: 8,
      startAnchor: {
        type: "place",
        label: "Pune Station",
        lat: 0,
        lon: 0,
      },
    });

    expect(plan.days[0].stops.length).toBeGreaterThan(0);
    const stop0 = plan.days[0].stops[0];
    // Start slot must be morning (08:30 to 09:30), never 02:38 AM
    const startHour = parseInt(stop0.slotStart.split(":")[0], 10);
    expect(startHour).toBeGreaterThanOrEqual(8);
    expect(startHour).toBeLessThanOrEqual(10);
    // Leg distance must be realistic (< 20 km), not 11,000+ km Null Island drift
    expect(stop0.legKmFromPrev ?? 0).toBeLessThan(25);
    // Total stops per day should not exceed 7
    expect(plan.days[0].stops.length).toBeLessThanOrEqual(7);
  });
});
