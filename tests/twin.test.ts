import { describe, expect, it } from "vitest";
import { classifyExposure, computeWeatherSuitability, assessStopWeatherImpact } from "@/lib/weather-impact";
import { simulateScenario } from "@/lib/digital-twin";
import { queryNugenReasoning } from "@/lib/nugen-client";
import { planTransitOption } from "@/lib/transit-engine";
import { parseTranscript } from "@/lib/nlu";
import type { Experience, TripPlan } from "@/lib/types";

describe("Weather Impact & Exposure Classification", () => {
  it("classifies outdoor forts and treks vs indoor museums accurately", () => {
    expect(classifyExposure({ name: "Sinhagad Fort", category: "culture" })).toBe("outdoor");
    expect(classifyExposure({ name: "Kalsubai Peak Trek", category: "nature" })).toBe("outdoor");
    expect(classifyExposure({ name: "Raja Dinkar Kelkar Museum", category: "culture" })).toBe("indoor");
    expect(classifyExposure({ name: "Vaishali Restaurant", category: "food" })).toBe("indoor");
    expect(classifyExposure({ name: "Dagdusheth Temple", category: "culture" })).toBe("semi-outdoor");
  });

  it("calculates low suitability for outdoor sights under heavy rain", () => {
    const rainWeather = { tempC: 24, precipMm: 25, windKmh: 15 };
    const outdoorRes = computeWeatherSuitability(rainWeather, "outdoor");
    expect(outdoorRes.score).toBeLessThanOrEqual(25);
    expect(outdoorRes.hazardReason).toContain("Heavy torrential rain");

    const indoorRes = computeWeatherSuitability(rainWeather, "indoor");
    expect(indoorRes.score).toBeGreaterThanOrEqual(80);
  });

  it("identifies heatwave risks for outdoor treks", () => {
    const heatWeather = { tempC: 42, precipMm: 0, windKmh: 10 };
    const heatRes = computeWeatherSuitability(heatWeather, "outdoor");
    expect(heatRes.score).toBeLessThanOrEqual(40);
    expect(heatRes.hazardReason).toContain("Severe midday heat");
  });
});

describe("Digital Twin Shadow What-If Simulation", () => {
  const samplePlan: TripPlan = {
    id: "twin_test_plan",
    city: "Pune",
    cityLabel: "Pune, Maharashtra",
    createdAt: "2026-09-27T00:00:00Z",
    voiceSummary: "Pune heritage route",
    feasibility: { ok: true, message: "Pacing looks solid" },
    shareUrl: "/?trip=twin_test",
    days: [
      {
        totalHours: 6,
        stops: [
          {
            experienceId: "p_food",
            name: "Vaishali Cafe",
            category: "food",
            timeOfDay: "breakfast",
            slotStart: "08:30",
            slotEnd: "09:30",
            durationMinutes: 60,
            travelMinFromPrev: 0,
            lat: 18.52,
            lon: 73.84,
          },
          {
            experienceId: "p_fort",
            name: "Sinhagad Fort",
            category: "culture",
            slotStart: "10:00",
            slotEnd: "12:30",
            durationMinutes: 150,
            travelMinFromPrev: 30,
            lat: 18.36,
            lon: 73.75,
          },
          {
            experienceId: "p_lunch",
            name: "Irani Cafe Lunch",
            category: "food",
            timeOfDay: "lunch",
            slotStart: "13:00",
            slotEnd: "14:00",
            durationMinutes: 60,
            travelMinFromPrev: 30,
            lat: 18.51,
            lon: 73.85,
          },
        ],
      },
    ],
  };

  const catalog: Experience[] = [
    {
      id: "p_museum",
      name: "Raja Dinkar Kelkar Museum",
      category: "culture",
      address: "Bajirao Road, Pune",
      description: "Extensive indoor collection of regional historical artifacts",
      popularity: "Popular",
      popularityScore: 0.8,
      community: { mentions: 12, upvotes: 20, sentiment: 0.8, quotes: [] },
      durationMinutes: 90,
      bookingRequired: false,
      tags: ["museum", "indoor"],
      amenities: [],
      source: "test",
      sources: [{ source: "test" }],
      lat: 18.511,
      lon: 73.854,
    },
  ];

  it("substitutes compromised outdoor sights with indoor shelters while preserving meals", async () => {
    const rainScenario = { precipMm: 28, tempC: 22 };
    const originalCopy = structuredClone(samplePlan);

    const result = await simulateScenario(samplePlan, rainScenario, catalog);

    // 1. Original plan must not be mutated
    expect(samplePlan.days[0].stops[1].name).toBe("Sinhagad Fort");
    expect(samplePlan).toEqual(originalCopy);

    // 2. Simulated shadow plan must have replaced Sinhagad Fort
    expect(result.simulatedPlan.days[0].stops[1].name).toBe("Raja Dinkar Kelkar Museum");
    expect(result.diff.compromisedCount).toBe(1);
    expect(result.diff.replacedCount).toBe(1);

    // 3. Breakfast and lunch must be strictly preserved
    expect(result.simulatedPlan.days[0].stops[0].name).toBe("Vaishali Cafe");
    expect(result.simulatedPlan.days[0].stops[2].name).toBe("Irani Cafe Lunch");

    // 4. Explanation and confidence must be present
    expect(result.explanation.summary).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

describe("Transit Engine & NLU Twin Intents", () => {
  it("resolves Pune metro corridor transit legs between Civil Court and Deccan", async () => {
    const from: [number, number] = [18.529, 73.856]; // Civil Court
    const to: [number, number] = [18.518, 73.841]; // Deccan Gymkhana
    const option = await planTransitOption(from, to, "Pune");
    expect(option).not.toBeNull();
    expect(option?.mode).toBe("metro");
    expect(option?.lineName).toContain("Line");
  });

  it("parses 'what if it rains tomorrow' into twin_simulate action in NLU", async () => {
    const res = await parseTranscript("what if it rains tomorrow in Pune", "test_twin_session");
    const twinAct = res.actions.find((a) => a.type === "twin_simulate");
    expect(twinAct).toBeDefined();
    expect(twinAct?.type).toBe("twin_simulate");
  });
});
