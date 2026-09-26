// ─── Core data-pipeline unit tests (pure functions, no network) ──────────────
import { describe, expect, it } from "vitest";
import { dedupKey, isBareGeoFragment, meaningfulOverlap, parseBbox, stripPossessive, tokenSim } from "@/lib/net";
import { isVisitablePlace, normalizePlaceName, openNowFromHours } from "@/lib/pipeline";

describe("dedupKey", () => {
  it("ignores case, accents, punctuation and word order", () => {
    expect(dedupKey("Café Aroma!")).toBe(dedupKey("aroma cafe"));
    expect(dedupKey("The Gateway of India")).toBe(dedupKey("gateway india of the"));
  });
  it("collapses whitespace", () => {
    expect(dedupKey("Shiv   Mandir")).toBe(dedupKey("shiv mandir"));
  });
});

describe("tokenSim", () => {
  it("scores identical keys 100", () => {
    expect(tokenSim("Durgadi Fort", "fort durgadi")).toBe(100);
  });
  it("scores partial overlap proportionally", () => {
    const sim = tokenSim("Durgadi Sea Fort", "Durgadi Fort");
    expect(sim).toBeGreaterThan(60);
    expect(sim).toBeLessThan(100);
  });
  it("scores unrelated names 0", () => {
    expect(tokenSim("Marine Drive", "Aroma Cafe")).toBe(0);
  });
});

describe("normalizePlaceName", () => {
  it("strips trailing separators leaked from mined titles", () => {
    expect(normalizePlaceName("Durgadi Fort -")).toBe("Durgadi Fort");
    expect(normalizePlaceName("Gateway of India |")).toBe("Gateway of India");
    expect(normalizePlaceName("Mumbai –")).toBe("Mumbai");
  });
  it("strips leading separators and collapses whitespace", () => {
    expect(normalizePlaceName("  —  Marine Drive")).toBe("Marine Drive");
    expect(normalizePlaceName("Kala   Talao")).toBe("Kala Talao");
  });
  it("never rewrites real content", () => {
    expect(normalizePlaceName("Cafe Mondegar")).toBe("Cafe Mondegar");
  });
});

describe("isVisitablePlace", () => {
  const city = "Kalyan";
  it("keeps real places", () => {
    for (const name of ["Durgadi Fort", "Shivaji Park", "Aroma Cafe", "Kalyan Mandai", "Titwala Ganesh Temple"])
      expect(isVisitablePlace(name, city)).toBe(true);
  });
  it("drops schools, banks, hospitals, housing and admin", () => {
    for (const name of ["Kalyan High School", "SBI Bank Kalyan", "Sunrise Hospital", "Shivneri Apartments", "Municipal Corporation Office"])
      expect(isVisitablePlace(name, city)).toBe(false);
  });
  it("drops bare city names and transit stops", () => {
    expect(isVisitablePlace("Kalyan", city)).toBe(false);
    expect(isVisitablePlace("Kalyan Junction", city)).toBe(false);
    expect(isVisitablePlace("Shivaji Nagar Bus Depot", city)).toBe(false);
  });
});

describe("meaningfulOverlap", () => {
  it("matches on distinctive tokens only", () => {
    expect(meaningfulOverlap("Siddhivinayak Mahaganapati Temple", "Siddhivinayak Mahaganapati Temple Titwala", "Kalyan-Dombivli")).toBeGreaterThan(0);
  });
  it("ignores generic venue words", () => {
    expect(meaningfulOverlap("Shiv Sagar Veg. Restaurant", "Another Family Restaurant", "Mumbai")).toBe(0);
  });
  it("ignores the city's own name even in the place name", () => {
    expect(meaningfulOverlap("Thane Vegetable Market", "Thane", "Thane")).toBe(0);
  });
  it("still matches places named after their neighborhood", () => {
    expect(meaningfulOverlap("Jogger's Park", "Joggers park", "Mumbai")).toBeGreaterThan(0);
  });
});

describe("openNowFromHours", () => {
  it("reads 24/7", () => {
    expect(openNowFromHours("24/7")).toBe(true);
  });
  it("parses day-scoped ranges", () => {
    const hours = "Mo-Sa 09:00-21:00";
    const wed10 = new Date(2026, 8, 9, 10, 0); // Wed
    expect(openNowFromHours(hours, wed10)).toBe(true);
    const wed22 = new Date(2026, 8, 9, 22, 0);
    expect(openNowFromHours(hours, wed22)).toBe(false);
  });
  it("returns null for unparsable input", () => {
    expect(openNowFromHours(undefined)).toBeNull();
    expect(openNowFromHours("call us")).toBeNull();
  });
});

describe("parseBbox", () => {
  it("parses valid bboxes", () => {
    expect(parseBbox("72.8,19.0,73.0,19.3")).toEqual({ w: 72.8, s: 19, e: 73, n: 19.3 });
  });
  it("rejects malformed ones", () => {
    expect(parseBbox("1,2,3")).toBeNull();
    expect(parseBbox("a,b,c,d")).toBeNull();
    expect(parseBbox("73,19,72,18")).toBeNull();
  });
});

describe("isBareGeoFragment / stripPossessive (mined-junk gate)", () => {
  it("kills mined geography fragments from the user report", () => {
    for (const name of ["India's", "Mumbai's", "West Asia", "South Asia", "Asia", "Kolkata", "South India", "India"])
      expect(isBareGeoFragment(name)).toBe(true);
  });
  it("never kills real places", () => {
    for (const name of ["Gateway of India", "India United Mills", "Nando's", "Ram Ashray South Indian", "VINTAGE INDIA", "Kala Ghoda Cafe"])
      expect(isBareGeoFragment(name)).toBe(false);
  });
  it("strips possessives without touching venues", () => {
    expect(stripPossessive("India's")).toBe("India");
    expect(stripPossessive("Nando's")).toBe("Nando");
  });
});

import { parsePriceSnippets, aggregatePriceHint, deriveStopPriceInfo, CATEGORY_TYPICAL_PRICES } from "@/lib/price-engine";
import {
  buildTripPlan,
  optimizeDayRoute,
  recomputePlanMetrics,
  buildMultiStopGmapsUrl,
  durationMinutesFromKm,
  isHighExertionStop,
  scorePlaces,
} from "@/lib/planner";
import { saveProviderListing, loadProvidersForCity } from "@/lib/db";
import {
  adaptPlanForWeather,
  trimPlanForLateRunning,
  suggestAlternativesForStop,
  isOutdoorExperience,
  isCoveredIndoorExperience,
} from "@/lib/circumstance-adapter";
import type { Experience, ProviderListing, TripPlan } from "@/lib/types";

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

describe("Price Intelligence Engine (TS)", () => {
  it("extracts free entry and meal ranges with 'for two' division", () => {
    const freeSamples = parsePriceSnippets("Entry is free of charge for everyone.", "wiki", undefined, "culture");
    const freeHint = aggregatePriceHint(freeSamples, "culture");
    expect(freeHint?.min).toBe(0);
    expect(freeHint?.max).toBe(0);
    expect(deriveStopPriceInfo({ priceHint: freeHint }).priceBasis).toBe("Free entry");

    const mealSamples = parsePriceSnippets("Authentic thali! Cost for two is ₹400–600.", "reddit", undefined, "food");
    const mealHint = aggregatePriceHint(mealSamples, "food");
    expect(mealHint?.min).toBe(200);
    expect(mealHint?.max).toBe(300);
    expect(mealHint?.mode).toBe("meal");
  });

  it("returns honest Varies on site state when no price signal exists (no fake category fallback)", () => {
    const info = deriveStopPriceInfo({ priceHint: null, pricePerPerson: undefined, priceIsEstimate: true });
    expect(info.priceBasis).toBe("Varies on site");
    expect(info.priceMin).toBeUndefined();
  });

  it("honestly returns 'Varies on site' for places lacking crawled price snippets", () => {
    const cultureInfo = deriveStopPriceInfo({ priceHint: null, category: "culture" });
    expect(cultureInfo.priceBasis).toBe("Varies on site");
    expect(cultureInfo.priceMin).toBeUndefined();
    expect(cultureInfo.priceMax).toBeUndefined();

    const natureInfo = deriveStopPriceInfo({ priceHint: null, category: "nature" });
    expect(natureInfo.priceBasis).toBe("Varies on site");
    expect(natureInfo.priceMin).toBeUndefined();

    const foodInfo = deriveStopPriceInfo({ priceHint: null, category: "food" });
    expect(foodInfo.priceBasis).toBe("Varies on site");
    expect(foodInfo.priceMin).toBeUndefined();
  });
});

describe("Trip Planner Route Optimization & Strict Category Selection", () => {
  const samplePlaces: Experience[] = [
    makeExp({
      id: "c1",
      name: "Shaniwar Wada",
      category: "culture",
      lat: 18.5195,
      lon: 73.8553,
      priceHint: { mode: "entry", min: 25, max: 25, per_person: 25, samples: [], confidence: 0.8 },
    }),
    makeExp({
      id: "f1",
      name: "Vaishali Restaurant",
      category: "food",
      lat: 18.5222,
      lon: 73.8415,
      priceHint: { mode: "meal", min: 200, max: 350, per_person: 250, samples: [], confidence: 0.85 },
    }),
    makeExp({
      id: "c2",
      name: "Aga Khan Palace",
      category: "culture",
      lat: 18.5525,
      lon: 73.9015,
      priceHint: { mode: "entry", min: 50, max: 50, per_person: 50, samples: [], confidence: 0.8 },
    }),
    makeExp({
      id: "c3",
      name: "Lal Mahal",
      category: "culture",
      lat: 18.5186,
      lon: 73.8565,
      priceHint: null,
      priceIsEstimate: true,
    }),
  ];

  it("strictly filters to cultural places only when interests=['culture'] (never injecting food)", async () => {
    const plan = await buildTripPlan(samplePlaces, {
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      lat: 18.52,
      lon: 73.855,
      days: 1,
      hoursPerDay: 8,
      interests: ["culture"],
      strictCategories: true,
      timeMode: "recommended",
    });

    const stops = plan.days[0].stops;
    expect(stops.length).toBe(3);
    expect(stops.every((s) => s.category === "culture")).toBe(true);
    expect(stops.some((s) => s.category === "food")).toBe(false);
    // Check price band (c1: 25, c2: 50, c3: unpriced varies on site)
    expect(plan.budgetBand?.min).toBe(75);
    expect(plan.budgetBand?.max).toBe(75);
    expect(plan.budgetBand?.pricedCount).toBe(2);
    expect(plan.budgetBand?.unpricedCount).toBe(1);
  });

  it("orders stops geographically from startAnchor via 2-opt without cross-city backtracking", () => {
    // Anchor right next to Shaniwar Wada (18.5195, 73.8553); Lal Mahal is 150m away (18.5186, 73.8565), Aga Khan is 6km away (18.5525, 73.9015)
    // Even if Aga Khan is placed in the middle of the input list, optimizeDayRoute puts Shaniwar Wada -> Lal Mahal -> Aga Khan Palace
    const zigzag = [
      { exp: samplePlaces[0], score: 0.9, fit: 1 }, // Shaniwar Wada
      { exp: samplePlaces[2], score: 0.85, fit: 1 }, // Aga Khan Palace (far)
      { exp: samplePlaces[3], score: 0.8, fit: 1 }, // Lal Mahal (right next to Shaniwar Wada)
    ];
    const optimized = optimizeDayRoute(zigzag, { lat: 18.5195, lon: 73.8553, placeId: "c1" });
    expect(optimized.map((x) => x.exp.id)).toEqual(["c1", "c3", "c2"]);
  });

  it("recomputes slots, totalHours, and budgetBand when inline durations change or stops are removed", async () => {
    const plan = await buildTripPlan(samplePlaces, {
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      lat: 18.52,
      lon: 73.855,
      days: 1,
      hoursPerDay: 8,
      selectedPlaceIds: ["c1", "f1"],
      timeMode: "recommended",
    });

    expect(plan.days[0].stops.length).toBe(2);
    expect(plan.budgetBand?.min).toBe(225); // 25 + 200
    expect(plan.budgetBand?.max).toBe(375); // 25 + 350

    // Edit stop 0 duration from 60 to 120 min and remove stop 1
    plan.days[0].stops[0].durationMinutes = 120;
    plan.days[0].stops.splice(1, 1);
    const updated = recomputePlanMetrics(plan, { reslot: true });
    expect(updated.days[0].stops.length).toBe(1);
    expect(updated.budgetBand?.min).toBe(25);
    expect(updated.budgetBand?.max).toBe(25);
    expect(updated.days[0].totalHours).toBeGreaterThanOrEqual(2);

    const gmapsUrl = buildMultiStopGmapsUrl(plan.days[0].stops, plan.startAnchor, "walk");
    expect(gmapsUrl).toContain("https://www.google.com/maps/dir/?api=1");
    expect(gmapsUrl).toContain("travelmode=walking");
  });

  it("calculates distinct realistic travel times for Walk (4.8 km/h) vs Drive (24 km/h + 1m)", async () => {
    // 2.63 km leg from the user's screenshot: Walk should be 33m, Drive should be 8m
    expect(durationMinutesFromKm(2.63, "walk")).toBe(33);
    expect(durationMinutesFromKm(2.63, "drive")).toBe(8);

    const walkPlan = await buildTripPlan(samplePlaces, {
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      lat: 18.52,
      lon: 73.855,
      days: 1,
      hoursPerDay: 8,
      selectedPlaceIds: ["c1", "c2"],
      transportMode: "walk",
      timeMode: "recommended",
    });

    const walkMinutes = walkPlan.days[0].stops[1].travelMinFromPrev;

    const drivePlan = structuredClone(walkPlan);
    drivePlan.transportMode = "drive";
    const recomputedDrive = recomputePlanMetrics(drivePlan, {
      reslot: true,
      recalcTravelFromMode: true,
    });
    const driveMinutes = recomputedDrive.days[0].stops[1].travelMinFromPrev;

    expect(walkMinutes).toBeGreaterThan(driveMinutes * 2);
    expect(recomputedDrive.days[0].stops[1].note).toContain("drive");

    const transitPlan = structuredClone(walkPlan);
    transitPlan.transportMode = "transit";
    const recomputedTransit = recomputePlanMetrics(transitPlan, {
      reslot: true,
      recalcTravelFromMode: true,
    });
    expect(recomputedTransit.days[0].stops[1].note).toContain("transit");
    expect(recomputedTransit.days[0].stops[1].gmapsDirectionsUrl).toContain("travelmode=transit");
  });

  it("honors lockedPlaceIds (👍 Keep) and excludedPlaceIds (👎 Swap) on Re-plan", async () => {
    const plan = await buildTripPlan(samplePlaces, {
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      lat: 18.52,
      lon: 73.855,
      days: 1,
      hoursPerDay: 8,
      lockedPlaceIds: ["c3"],
      excludedPlaceIds: ["c1"],
      timeMode: "recommended",
    });

    const stopIds = plan.days[0].stops.map((s) => s.experienceId);
    expect(stopIds).toContain("c3");
    expect(stopIds).not.toContain("c1");
    const lockedStop = plan.days[0].stops.find((s) => s.experienceId === "c3");
    expect(lockedStop?.locked).toBe(true);

    // Verify all other replacement stops are strictly unlocked (locked: false)
    const otherStops = plan.days[0].stops.filter((s) => s.experienceId !== "c3");
    expect(otherStops.length).toBeGreaterThan(0);
    expect(otherStops.every((s) => s.locked === false)).toBe(true);
  });

  it("forces city-type startAnchor to match target city center even if caller passed stale previous-city anchor", async () => {
    const badlapurPlaces: Experience[] = [
      makeExp({
        id: "b1",
        name: "Kondeshwar Temple",
        category: "culture",
        lat: 19.12,
        lon: 73.27,
      }),
      makeExp({
        id: "b2",
        name: "Barvi Dam",
        category: "nature",
        lat: 19.19,
        lon: 73.34,
      }),
    ];

    // Simulate caller passing stale Pune Center anchor to Badlapur plan
    const plan = await buildTripPlan(badlapurPlaces, {
      city: "Badlapur",
      cityLabel: "Badlapur, Maharashtra",
      lat: 19.167,
      lon: 73.238,
      days: 1,
      hoursPerDay: 8,
      startAnchor: {
        type: "city",
        label: "Pune Center",
        lat: 18.52,
        lon: 73.855,
      },
    });

    expect(plan.startAnchor?.label).toBe("Badlapur Center");
    expect(plan.startAnchor?.lat).toBe(19.167);
    expect(plan.startAnchor?.lon).toBe(73.238);
  });

  it("detects strenuous treks and injects 45-min post-climb biological recovery buffer", () => {
    expect(isHighExertionStop({ name: "Sinhagad Fort Climb", durationMinutes: 180, category: "adventure" })).toBe(true);
    expect(isHighExertionStop({ name: "Khanderi Fort Sea Trek", durationMinutes: 90, category: "adventure" })).toBe(true);
    expect(isHighExertionStop({ name: "Raja Dinkar Kelkar Museum", durationMinutes: 60, category: "culture" })).toBe(false);

    // Mock a plan with a trek followed by an afternoon museum visit
    const mockPlan = {
      id: "test-trek",
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      lat: 18.52,
      lon: 73.855,
      days: [
        {
          day: 1,
          date: "2026-09-26",
          theme: "Adventure & Heritage",
          stops: [
            {
              experienceId: "trek1",
              name: "Sinhagad Fort Trek",
              category: "adventure" as const,
              durationMinutes: 180,
              lat: 18.366,
              lon: 73.755,
              slotStart: "09:00",
              slotEnd: "12:00",
              isHighExertion: true,
              travelMinFromPrev: 0,
            },
            {
              experienceId: "cult1",
              name: "Kelkar Museum",
              category: "culture" as const,
              durationMinutes: 60,
              lat: 18.51,
              lon: 73.85,
              slotStart: "12:10",
              slotEnd: "13:10",
              travelMinFromPrev: 15,
            },
          ],
          totalHours: 4.5,
        },
      ],
      totalDays: 1,
      totalCost: 0,
      createdAt: "2026-09-26T00:00:00Z",
      voiceSummary: "",
      shareUrl: "",
      feasibility: { ok: true, message: "Pacing looks good" },
    };

    const recomputed = recomputePlanMetrics(mockPlan);
    const day1 = recomputed.days[0];

    // High exertion trek should be detected with fatigue indicators
    expect(day1.highExertionTrekDetected).toBe(true);
    expect(day1.exertionStopName).toBe("Sinhagad Fort Trek");
    expect(day1.remainingStopsAfterTrekCount).toBe(1);

    // Stop 0: 09:00 - 12:00
    expect(day1.stops[0].slotStart).toBe("09:00");
    expect(day1.stops[0].slotEnd).toBe("12:00");

    // Stop 1 should account for 45-min recovery buffer + 15 min travel:
    // 12:00 + 45 min rest = 12:45, + 15 min travel = 13:00 (1:00 PM)
    expect(day1.stops[1].slotStart).toBe("13:00");
  });

  it("slots food places into itinerary when meal anchors (breakfast/lunch/dinner) are selected", async () => {
    const placesWithFood: Experience[] = [
      makeExp({
        id: "m1",
        name: "Shaniwar Wada",
        category: "culture",
        lat: 18.5195,
        lon: 73.8553,
        durationMinutes: 90,
      }),
      makeExp({
        id: "f1",
        name: "Vaishali Restaurant",
        category: "food",
        lat: 18.5222,
        lon: 73.8415,
        durationMinutes: 60,
      }),
      makeExp({
        id: "m2",
        name: "Lal Mahal",
        category: "culture",
        lat: 18.5186,
        lon: 73.8565,
        durationMinutes: 60,
      }),
    ];

    const plan = await buildTripPlan(placesWithFood, {
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      lat: 18.52,
      lon: 73.855,
      days: 1,
      hoursPerDay: 8,
      includeLunch: true,
      interests: ["culture"], // Culture interest, but lunch meal anchor is enabled
    });

    const stops = plan.days[0].stops;
    expect(stops.some((s) => s.category === "food")).toBe(true);
    const foodStop = stops.find((s) => s.category === "food");
    expect(foodStop?.name).toBe("Vaishali Restaurant");
  });

  it("slots meal stops into every day of a multi-day itinerary when meal anchors are active", async () => {
    const multiDayPlaces: Experience[] = [
      makeExp({ id: "s1", name: "Temple 1", category: "culture", lat: 19.16, lon: 73.23 }),
      makeExp({ id: "s2", name: "Temple 2", category: "culture", lat: 19.17, lon: 73.24 }),
      makeExp({ id: "s3", name: "Temple 3", category: "culture", lat: 19.18, lon: 73.25 }),
      makeExp({ id: "s4", name: "Nature 1", category: "nature", lat: 19.15, lon: 73.22 }),
      makeExp({ id: "s5", name: "Nature 2", category: "nature", lat: 19.19, lon: 73.26 }),
      makeExp({ id: "s6", name: "Nature 3", category: "nature", lat: 19.14, lon: 73.21 }),
      makeExp({ id: "f1", name: "Cafe One", category: "food", lat: 19.165, lon: 73.235 }),
      makeExp({ id: "f2", name: "Dhaba Two", category: "food", lat: 19.175, lon: 73.245 }),
      makeExp({ id: "f3", name: "Bhojanalaya Three", category: "food", lat: 19.155, lon: 73.225 }),
    ];

    const plan = await buildTripPlan(multiDayPlaces, {
      city: "Badlapur",
      cityLabel: "Badlapur, Maharashtra",
      lat: 19.167,
      lon: 73.238,
      days: 3,
      hoursPerDay: 8,
      includeLunch: true,
    });

    expect(plan.days.length).toBe(3);
    // Every single day must have a lunch food stop!
    for (let d = 0; d < 3; d++) {
      const dayStops = plan.days[d].stops;
      const hasFood = dayStops.some((s) => s.category === "food");
      expect(hasFood).toBe(true);
      const lunchStop = dayStops.find((s) => s.category === "food");
      expect(lunchStop).toBeDefined();
    }
  });
});

describe("Local Provider Hub & Verified Listings", () => {
  it("persists local provider listing and loads it for destination city", async () => {
    const listing: ProviderListing = {
      id: "prov-test-1",
      city: "pune",
      title: "Peshwai Cooking & Heritage Kitchen Walk",
      category: "workshop",
      hostName: "Radhika Joshi",
      contactPhone: "+919876543210",
      contactWhatsapp: "+919876543210",
      pricePerPerson: 750,
      durationMinutes: 120,
      maxGroupSize: 8,
      isKidFriendly: true,
      isWheelchairAccessible: true,
      description: "Cook traditional Maharashtrian dishes in a heritage family wada kitchen.",
      availabilitySlots: ["10:00 AM", "04:00 PM"],
      address: "Sadashiv Peth, Pune",
      lat: 18.514,
      lon: 73.849,
      createdAt: Date.now(),
    };

    await saveProviderListing(listing);
    const providers = await loadProvidersForCity("pune");
    const found = providers.find((p) => p.id === "prov-test-1");

    expect(found).toBeDefined();
    expect(found?.title).toBe("Peshwai Cooking & Heritage Kitchen Walk");
    expect(found?.hostName).toBe("Radhika Joshi");
    expect(found?.isKidFriendly).toBe(true);
    expect(found?.isWheelchairAccessible).toBe(true);
    expect(found?.pricePerPerson).toBe(750);
    expect(found?.contactWhatsapp).toBe("+919876543210");
  });
});

describe("Traveler Personas & Wheelchair Accessibility", () => {
  const places: Experience[] = [
    makeExp({
      id: "kid1",
      name: "Kamla Nehru Children Park",
      category: "nature",
      goodForKids: true,
      wheelchairAccessible: true,
      durationMinutes: 60,
      popularityScore: 0.8,
    }),
    makeExp({
      id: "trek1",
      name: "Rajgad Fort Hard Summit Trek",
      category: "adventure",
      durationMinutes: 240,
      wheelchairAccessible: false,
      popularityScore: 0.9,
    }),
    makeExp({
      id: "club1",
      name: "High Spirits Dance Bar",
      category: "nightlife",
      durationMinutes: 120,
      wheelchairAccessible: true,
      popularityScore: 0.85,
    }),
    makeExp({
      id: "museum1",
      name: "Tribal Heritage Museum",
      category: "culture",
      durationMinutes: 90,
      wheelchairAccessible: true,
      popularityScore: 0.75,
    }),
  ];

  it("filters out nightlife and grueling treks for family persona, while boosting kid-friendly places", () => {
    const familyScored = scorePlaces(places, {
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      days: 1,
      hoursPerDay: 8,
      persona: "family",
      groupSize: 4,
    });

    const ids = familyScored.map((s) => s.exp.id);
    expect(ids).not.toContain("club1"); // No nightlife for families
    expect(ids).not.toContain("trek1"); // No 4h strenuous treks for families
    expect(ids).toContain("kid1");
    expect(ids).toContain("museum1");
    // Kid-friendly spot should score higher than general museum
    const kidPlaceScore = familyScored.find((s) => s.exp.id === "kid1")?.score || 0;
    const museumScore = familyScored.find((s) => s.exp.id === "museum1")?.score || 0;
    expect(kidPlaceScore).toBeGreaterThan(museumScore);
  });

  it("strictly excludes inaccessible venues when accessibleOnly is enabled", () => {
    const accessiblePlaces: Experience[] = [
      makeExp({ id: "acc1", name: "Wheelchair Ramp Art Center", category: "culture", wheelchairAccessible: true }),
      makeExp({ id: "inacc1", name: "Steep Step Cave Shrine", category: "culture", wheelchairAccessible: false }),
    ];

    const scored = scorePlaces(accessiblePlaces, {
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      days: 1,
      hoursPerDay: 8,
      accessibleOnly: true,
    });

    const ids = scored.map((s) => s.exp.id);
    expect(ids).toContain("acc1");
    expect(ids).not.toContain("inacc1");
  });

  it("applies relaxed pacing buffers (+20m inter-stop) when persona is family", () => {
    const plan: TripPlan = {
      id: "fam-buffer-test",
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      persona: "family",
      days: [
        {
          date: "2026-09-26",
          stops: [
            {
              experienceId: "s1",
              name: "Activity One",
              category: "culture",
              slotStart: "09:00",
              slotEnd: "10:00",
              durationMinutes: 60,
              travelMinFromPrev: 0,
            },
            {
              experienceId: "s2",
              name: "Activity Two",
              category: "nature",
              slotStart: "10:10",
              slotEnd: "11:10",
              durationMinutes: 60,
              travelMinFromPrev: 10,
            },
          ],
          totalHours: 2,
        },
      ],
      createdAt: "2026-09-26T00:00:00Z",
      voiceSummary: "",
      shareUrl: "",
      feasibility: { ok: true, message: "OK" },
    };

    const recomputed = recomputePlanMetrics(plan, { reslot: true });
    // Stop 1: 09:00 - 10:00.
    // Next stop: 10:00 + travel (10m) + family buffer (20m) = 10:30 start!
    expect(recomputed.days[0].stops[1].slotStart).toBe("10:30");
  });
});

describe("Dynamic Circumstance Adaptation (Weather, Delays, Alternatives)", () => {
  it("identifies outdoor vs covered indoor experiences accurately", () => {
    expect(isOutdoorExperience({ name: "Sinhagad Fort Trek", category: "adventure" })).toBe(true);
    expect(isOutdoorExperience({ name: "Khadakwasla Lake Viewpoint", category: "nature" })).toBe(true);
    expect(isOutdoorExperience({ name: "City Craft Workshop", category: "workshop" })).toBe(false);

    expect(isCoveredIndoorExperience(makeExp({ id: "m1", name: "Tribal Art Museum", category: "culture", isOutdoor: false }))).toBe(true);
    expect(isCoveredIndoorExperience(makeExp({ id: "f1", name: "Goodluck Cafe", category: "food" }))).toBe(true);
  });

  it("swaps exposed outdoor stops with sheltered indoor venues during rain while preserving locked & meal stops", () => {
    const indoorMuseum = makeExp({
      id: "indoor-museum",
      name: "Mahatma Phule Museum",
      category: "culture",
      isOutdoor: false,
      lat: 18.525,
      lon: 73.845,
    });
    const rainPlan: TripPlan = {
      id: "rain-test",
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      days: [
        {
          date: "2026-09-26",
          stops: [
            {
              experienceId: "outdoor-trek",
              name: "Parvati Hill Outdoor Climb",
              category: "nature",
              slotStart: "09:00",
              slotEnd: "10:30",
              durationMinutes: 90,
              travelMinFromPrev: 0,
              lat: 18.498,
              lon: 73.848,
            },
            {
              experienceId: "locked-lunch",
              name: "Shabree Thali",
              category: "food",
              timeOfDay: "lunch",
              locked: true,
              slotStart: "12:30",
              slotEnd: "13:30",
              durationMinutes: 60,
              travelMinFromPrev: 15,
              lat: 18.52,
              lon: 73.84,
            },
          ],
          totalHours: 4.5,
        },
      ],
      createdAt: "",
      voiceSummary: "",
      shareUrl: "",
      feasibility: { ok: true, message: "" },
    };

    const adapted = adaptPlanForWeather(rainPlan, [indoorMuseum], "rain");
    expect(adapted.swappedCount).toBe(1);
    expect(adapted.plan.weatherAdapted).toBe(true);
    expect(adapted.plan.weatherAlert).toContain("rain");
    // Parvati Hill replaced by indoor museum
    expect(adapted.plan.days[0].stops[0].experienceId).toBe("indoor-museum");
    // Shabree Thali (lunch & locked) untouched
    expect(adapted.plan.days[0].stops[1].experienceId).toBe("locked-lunch");
  });

  it("recovers delay by trimming lowest-priority non-meal afternoon stop in late-running mode", () => {
    const delayedPlan: TripPlan = {
      id: "delay-test",
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      days: [
        {
          date: "2026-09-26",
          stops: [
            { experienceId: "s1", name: "Morning Wada", category: "culture", slotStart: "09:00", slotEnd: "10:30", durationMinutes: 90, travelMinFromPrev: 0 },
            { experienceId: "s2", name: "Lunch Feast", category: "food", timeOfDay: "lunch", slotStart: "12:30", slotEnd: "13:30", durationMinutes: 60, travelMinFromPrev: 10 },
            { experienceId: "s3", name: "Afternoon Souvenir Market", category: "market", slotStart: "15:00", slotEnd: "16:30", durationMinutes: 90, travelMinFromPrev: 15 },
          ],
          totalHours: 7.5,
        },
      ],
      createdAt: "",
      voiceSummary: "",
      shareUrl: "",
      feasibility: { ok: true, message: "" },
    };

    const trimmed = trimPlanForLateRunning(delayedPlan, 0, 60);
    expect(trimmed.trimmedStopName).toBe("Afternoon Souvenir Market");
    expect(trimmed.plan.days[0].stops.length).toBe(2);
    expect(trimmed.plan.feasibility.message).toContain("+60m delay recovered");
  });

  it("suggests proximity-ranked smart alternatives for a stop", () => {
    const currentStop = {
      experienceId: "curr",
      name: "Current Museum",
      category: "culture" as const,
      lat: 18.52,
      lon: 73.85,
      slotStart: "10:00",
      slotEnd: "11:30",
      durationMinutes: 90,
      travelMinFromPrev: 0,
    };

    const pool = [
      makeExp({ id: "close-cult", name: "Nearby Art Gallery", category: "culture", lat: 18.521, lon: 73.851, popularityScore: 0.9 }),
      makeExp({ id: "far-cult", name: "Distant Fort", category: "culture", lat: 18.7, lon: 73.9, popularityScore: 0.8 }),
      makeExp({ id: "close-food", name: "Nearby Cafe", category: "food", lat: 18.522, lon: 73.852, popularityScore: 0.7 }),
    ];

    const alts = suggestAlternativesForStop(currentStop, pool, 2);
    expect(alts.length).toBe(2);
    // Nearest culture match should be top ranked
    expect(alts[0].id).toBe("close-cult");
  });
});

describe("2h Micro-Trip Generator (Short Layover / Afternoon Window)", () => {
  it("caps total stops to 2 with 1 sight and 1 tea/food stop for short 2h duration", async () => {
    const candidatePlaces: Experience[] = [
      makeExp({ id: "s1", name: "Shaniwar Wada", category: "culture", lat: 18.5195, lon: 73.8553, durationMinutes: 60 }),
      makeExp({ id: "s2", name: "Aga Khan Palace", category: "culture", lat: 18.5525, lon: 73.9015, durationMinutes: 60 }),
      makeExp({ id: "s3", name: "Pataleshwar Cave Temple", category: "culture", lat: 18.527, lon: 73.85, durationMinutes: 45 }),
      makeExp({ id: "f1", name: "Goodluck Cafe Irani Chai", category: "food", lat: 18.518, lon: 73.842, durationMinutes: 30 }),
    ];

    const microPlan = await buildTripPlan(candidatePlaces, {
      city: "Pune",
      cityLabel: "Pune, Maharashtra",
      lat: 18.52,
      lon: 73.85,
      days: 1,
      hoursPerDay: 2,
    });

    expect(microPlan.isMicroPlan).toBe(true);
    expect(microPlan.days[0].stops.length).toBeLessThanOrEqual(2);
    expect(microPlan.days[0].stops.length).toBeGreaterThanOrEqual(1);
    expect(microPlan.days[0].stops[0].durationMinutes).toBeLessThanOrEqual(90);
  });
});



