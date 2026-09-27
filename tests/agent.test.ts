import { describe, expect, it } from "vitest";
import { adaptPlanForWeather, trimPlanForLateRunning, isOutdoorExperience, isCoveredIndoorExperience } from "@/lib/circumstance-adapter";
import { matchesWakeWord, cleanVoiceTranscript, extractWakeCommand } from "@/lib/voice-utils";
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

  it("detects hands-free wake words accurately across Indian accent variants", () => {
    expect(matchesWakeWord("Hey Vibe, plan a 2-day trip to Pune")).toBe(true);
    expect(matchesWakeWord("hey roamy show me cultural places")).toBe(true);
    expect(matchesWakeWord("ok vibe what is the sunset time")).toBe(true);
    expect(matchesWakeWord("hey bhai plan a food trip")).toBe(true);
    expect(matchesWakeWord("hai vibe")).toBe(true);
    expect(matchesWakeWord("heavy plan a trip")).toBe(true);
    expect(matchesWakeWord("hey roomie what's good")).toBe(true);
    expect(matchesWakeWord("just showing regular search")).toBe(false);
  });

  it("extracts one-shot wake commands in the same breath and preserves the command", () => {
    const res1 = extractWakeCommand("Hey Vibe, plan a 2-day trip to Pune");
    expect(res1.hasWake).toBe(true);
    expect(res1.command).toBe("plan a 2-day trip to Pune");

    const res2 = extractWakeCommand("hey roamy: swap Day 1 breakfast with Day 2 that's it");
    expect(res2.hasWake).toBe(true);
    expect(res2.command).toBe("swap Day 1 breakfast with Day 2");

    const res3 = extractWakeCommand("hey vibe");
    expect(res3.hasWake).toBe(true);
    expect(res3.command).toBe("");

    const res4 = extractWakeCommand("hey bhai find authentic misal pav in Pune");
    expect(res4.hasWake).toBe(true);
    expect(res4.command).toBe("find authentic misal pav in Pune");

    const res5 = extractWakeCommand("plan a trip to mumbai");
    expect(res5.hasWake).toBe(false);
    expect(res5.command).toBe("");
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

  it("parses 'move [stop] to day [N] [slot]' in rule-based NLU", async () => {
    const { parseTranscript } = await import("@/lib/nlu");
    const res1 = await parseTranscript("Move Shaniwar Wada to day 2 in the morning", "test_sess_1");
    expect(res1.actions.length).toBe(1);
    expect(res1.actions[0]).toEqual({
      type: "move_stop",
      name: "Shaniwar Wada",
      toDay: 2,
      slot: "morning",
    });

    const res2 = await parseTranscript("Shift Aga Khan Palace to day 3 evening", "test_sess_2");
    expect(res2.actions.length).toBe(1);
    expect(res2.actions[0]).toEqual({
      type: "move_stop",
      name: "Aga Khan Palace",
      toDay: 3,
      slot: "evening",
    });

    const res3 = await parseTranscript("Add Cafe Goodluck to day 2 in the afternoon", "test_sess_3");
    expect(res3.actions.length).toBe(1);
    expect(res3.actions[0]).toEqual({
      type: "add_stop",
      name: "Cafe Goodluck",
      day: 2,
      slot: "afternoon",
    });
  });

  it("relocates a stop to Day 2 morning and cleanly reslots times", async () => {
    const { recomputePlanMetrics } = await import("@/lib/planner");
    const plan: TripPlan = {
      id: "test_move",
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      createdAt: "2026-09-26T10:00:00Z",
      voiceSummary: "Test trip",
      feasibility: { ok: true, message: "ok" },
      shareUrl: "/?trip=test_move",
      days: [
        {
          totalHours: 4,
          stops: [
            {
              experienceId: "p1",
              name: "Shaniwar Wada",
              category: "culture",
              slotStart: "09:00",
              slotEnd: "10:30",
              durationMinutes: 90,
              travelMinFromPrev: 0,
              lat: 18.519,
              lon: 73.855,
            },
            {
              experienceId: "p2",
              name: "Dagdusheth Temple",
              category: "culture",
              slotStart: "10:45",
              slotEnd: "11:45",
              durationMinutes: 60,
              travelMinFromPrev: 15,
              lat: 18.516,
              lon: 73.856,
            },
          ],
        },
        {
          totalHours: 3,
          stops: [
            {
              experienceId: "p3",
              name: "Saras Baug",
              category: "nature",
              slotStart: "12:00",
              slotEnd: "13:30",
              durationMinutes: 90,
              travelMinFromPrev: 0,
              lat: 18.502,
              lon: 73.853,
            },
          ],
        },
      ],
    };

    // Move Shaniwar Wada to Day 2 morning
    const [moved] = plan.days[0].stops.splice(0, 1);
    expect(moved.name).toBe("Shaniwar Wada");
    expect(plan.days[0].stops.length).toBe(1);
    expect(plan.days[0].stops[0].name).toBe("Dagdusheth Temple");

    // Insert at index 0 on Day 2 for morning slot
    plan.days[1].stops.unshift(moved);
    const updated = recomputePlanMetrics(plan, { reslot: true });

    // Day 1 check
    expect(updated.days[0].stops.length).toBe(1);
    expect(updated.days[0].stops[0].name).toBe("Dagdusheth Temple");
    // Day 2 check
    expect(updated.days[1].stops.length).toBe(2);
    expect(updated.days[1].stops[0].name).toBe("Shaniwar Wada");
    expect(updated.days[1].stops[0].slotStart).toBe("09:00");
    expect(updated.days[1].stops[1].name).toBe("Saras Baug");
    expect(updated.days[1].stops[1].slotStart).toBe("11:13");
  });

  it("parses swap_stops with and without explicit days in NLU", async () => {
    const { parseTranscript } = await import("@/lib/nlu");

    const r1 = await parseTranscript("swap Vaishali with Cafe Goodluck", "test_swap_1");
    expect(r1.actions).toEqual([
      {
        type: "swap_stops",
        stopA: "Vaishali",
        dayA: undefined,
        stopB: "Cafe Goodluck",
        dayB: undefined,
      },
    ]);

    const r2 = await parseTranscript("swap Vaishali in day 1 with Cafe Goodluck in day 2", "test_swap_2");
    expect(r2.actions).toEqual([
      {
        type: "swap_stops",
        stopA: "Vaishali",
        dayA: 1,
        stopB: "Cafe Goodluck",
        dayB: 2,
      },
    ]);
  });

  it("swaps stops across days and recalculates slots accurately", async () => {
    const { recomputePlanMetrics } = await import("@/lib/planner");
    const plan: TripPlan = {
      id: "test_swap_exec",
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      createdAt: "2026-09-26T10:00:00Z",
      voiceSummary: "Test trip",
      feasibility: { ok: true, message: "ok" },
      shareUrl: "/?trip=test_swap_exec",
      days: [
        {
          totalHours: 4,
          stops: [
            {
              experienceId: "p1",
              name: "Vaishali",
              category: "food",
              timeOfDay: "breakfast",
              slotStart: "09:00",
              slotEnd: "10:00",
              durationMinutes: 60,
              travelMinFromPrev: 0,
              lat: 18.520,
              lon: 73.840,
            },
            {
              experienceId: "p2",
              name: "Shaniwar Wada",
              category: "culture",
              slotStart: "10:30",
              slotEnd: "12:00",
              durationMinutes: 90,
              travelMinFromPrev: 15,
              lat: 18.519,
              lon: 73.855,
            },
          ],
        },
        {
          totalHours: 4,
          stops: [
            {
              experienceId: "p3",
              name: "Cafe Goodluck",
              category: "food",
              timeOfDay: "breakfast",
              slotStart: "09:00",
              slotEnd: "10:00",
              durationMinutes: 60,
              travelMinFromPrev: 0,
              lat: 18.517,
              lon: 73.841,
            },
            {
              experienceId: "p4",
              name: "Saras Baug",
              category: "nature",
              slotStart: "10:30",
              slotEnd: "12:00",
              durationMinutes: 90,
              travelMinFromPrev: 15,
              lat: 18.502,
              lon: 73.853,
            },
          ],
        },
      ],
    };

    // Swap Vaishali (Day 1) with Cafe Goodluck (Day 2)
    const stopA = plan.days[0].stops[0];
    const stopB = plan.days[1].stops[0];
    plan.days[0].stops[0] = stopB;
    plan.days[1].stops[0] = stopA;

    const reslotted = recomputePlanMetrics(plan, { reslot: true });
    expect(reslotted.days[0].stops[0].name).toBe("Cafe Goodluck");
    expect(reslotted.days[0].stops[0].slotStart).toBe("08:30");
    expect(reslotted.days[1].stops[0].name).toBe("Vaishali");
    expect(reslotted.days[1].stops[0].slotStart).toBe("08:30");
  });

  it("preserves morning slot when moving a breakfast food stop without explicit slot", async () => {
    const { recomputePlanMetrics } = await import("@/lib/planner");
    const plan: TripPlan = {
      id: "test_bfast_slot",
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      createdAt: "2026-09-26T10:00:00Z",
      voiceSummary: "Test trip",
      feasibility: { ok: true, message: "ok" },
      shareUrl: "/?trip=test_bfast_slot",
      days: [
        {
          totalHours: 3,
          stops: [
            {
              experienceId: "p1",
              name: "Vaishali Cafe",
              category: "food",
              timeOfDay: "breakfast",
              slotStart: "09:00",
              slotEnd: "10:00",
              durationMinutes: 60,
              travelMinFromPrev: 0,
              lat: 18.520,
              lon: 73.840,
            },
          ],
        },
        {
          totalHours: 4,
          stops: [
            {
              experienceId: "p2",
              name: "Aga Khan Palace",
              category: "culture",
              slotStart: "10:00",
              slotEnd: "11:30",
              durationMinutes: 90,
              travelMinFromPrev: 0,
              lat: 18.552,
              lon: 73.901,
            },
            {
              experienceId: "p3",
              name: "Vohuman Cafe Dinner",
              category: "food",
              timeOfDay: "dinner",
              slotStart: "19:00",
              slotEnd: "20:00",
              durationMinutes: 60,
              travelMinFromPrev: 20,
              lat: 18.530,
              lon: 73.876,
            },
          ],
        },
      ],
    };

    // Move Vaishali Cafe to Day 2 without specifying slot
    const [moved] = plan.days[0].stops.splice(0, 1);
    const isBfast =
      moved.category === "food" &&
      (moved.timeOfDay === "breakfast" ||
        (moved.slotStart && moved.slotStart < "11:30") ||
        /breakfast|cafe|chai|tea|bakery|coffee|idli|dosa|poha|misal/i.test(moved.name));

    expect(isBfast).toBe(true);

    // Morning slot should insert at index 0 rather than pushing to end (after dinner)
    const targetStops = plan.days[1].stops;
    const hasBreakfast =
      targetStops[0]?.category === "food" || /breakfast/i.test(targetStops[0]?.note || "");
    const insertIdx = hasBreakfast && targetStops.length > 1 ? 1 : 0;
    targetStops.splice(insertIdx, 0, moved);

    const reslotted = recomputePlanMetrics(plan, { reslot: true });
    expect(reslotted.days[1].stops[0].name).toBe("Vaishali Cafe");
    expect(reslotted.days[1].stops[0].slotStart).toBe("08:30");
    expect(reslotted.days[1].stops[1].name).toBe("Aga Khan Palace");
  });
});

describe("Voice Utilities: Wake Word Spotting, Barge-In & Roamy Phonetics", () => {
  it("comprehensively recognizes 'Hey Roamy' and its phonetic variants", () => {
    const roamyVariants = [
      "hey roamy",
      "Hey Roamy",
      "hey romy",
      "hey romi",
      "hey roami",
      "hey roomie",
      "hey romey",
      "hey roam",
      "hey rome",
      "hey romeo",
      "ok roamy",
      "ok roam",
      "hi roamy",
      "hai roamy",
      "aye roamy",
      "hero me",
      "hear me roam",
      "roamy",
      "roomie",
      "roomi",
      "roami",
      "romy",
      "hey roamit",
      "roamit",
      "hey rumi",
      "rumi",
      "hi rumi",
      "ok rumi",
      "hey rohit",
      "roam it",
      "hey roam it",
    ];

    for (const variant of roamyVariants) {
      expect(matchesWakeWord(variant), `Expected '${variant}' to match wake word`).toBe(true);
    }
  });

  it("comprehensively recognizes 'Hey Vibe' and its phonetic variants", () => {
    const vibeVariants = [
      "hey vibe",
      "Hey Vibe",
      "hay vibe",
      "hai vibe",
      "hi vibe",
      "oye vibe",
      "ay vibe",
      "ok vibe",
      "hey bhai",
      "heavy",
      "hey five",
      "hey wipe",
      "hey vive",
      "high vibe",
    ];

    for (const variant of vibeVariants) {
      expect(matchesWakeWord(variant), `Expected '${variant}' to match wake word`).toBe(true);
    }
  });

  it("prevents self-trigger by rejecting bare 'vibe' in assistant sentences", () => {
    const assistantPhrases = [
      "I've crafted an itinerary with a cultural vibe for your trip",
      "The vibe at Cafe Goodluck is wonderful in the morning",
      "You can choose a relaxed vibe or an adventurous one",
    ];

    for (const phrase of assistantPhrases) {
      expect(matchesWakeWord(phrase), `Expected assistant phrase '${phrase}' NOT to trigger wake word`).toBe(false);
    }
  });

  it("extracts one-shot trailing commands accurately across Roamy and Vibe triggers", () => {
    // Roamy one-shot
    const r1 = extractWakeCommand("Hey Roamy, plan a 2-day trip to Pune");
    expect(r1.hasWake).toBe(true);
    expect(r1.command).toBe("plan a 2-day trip to Pune");

    // Hero me phonetic one-shot
    const r2 = extractWakeCommand("hero me, show me heritage places");
    expect(r2.hasWake).toBe(true);
    expect(r2.command).toBe("show me heritage places");

    // Roomie standalone one-shot
    const r3 = extractWakeCommand("roomie, adapt to rain that's it");
    expect(r3.hasWake).toBe(true);
    expect(r3.command).toBe("adapt to rain");

    // Hey Vibe barge-in command
    const r4 = extractWakeCommand("Hey Vibe, stop and switch to Mumbai");
    expect(r4.hasWake).toBe(true);
    expect(r4.command).toBe("stop and switch to Mumbai");

    // Wake word only
    const r5 = extractWakeCommand("Hey Roamy");
    expect(r5.hasWake).toBe(true);
    expect(r5.command).toBe("");

    // Non wake text
    const r6 = extractWakeCommand("Plan a trip to Pune");
    expect(r6.hasWake).toBe(false);
    expect(r6.command).toBe("");
  });
});

