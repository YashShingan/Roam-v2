// ─── Dynamic Circumstance Adapter (Weather Adaptation & Disruption Recovery) ───
import type { Category, Experience, ItineraryStop, TripDay, TripPlan } from "./types";
import { haversineKm } from "./net";
import { recomputePlanMetrics } from "./planner";

/**
 * Identifies if an itinerary stop or place is outdoor-exposed (e.g. treks, open forts, parks, waterfalls).
 */
export function isOutdoorExperience(p: {
  name: string;
  category?: Category;
  isOutdoor?: boolean;
  description?: string;
  tags?: string[];
}): boolean {
  if (p.isOutdoor === true) return true;
  if (p.isOutdoor === false) return false;
  if (p.category === "adventure" || p.category === "nature") return true;

  const text = `${p.name} ${p.description ?? ""} ${(p.tags ?? []).join(" ")}`.toLowerCase();
  return /(trek|trail|fort|summit|hike|lake|park|waterfall|garden|viewpoint|outdoor|dam|camp)/i.test(text);
}

/**
 * Identifies if a place is sheltered/indoor (e.g. museums, temples, covered bazaars, cafes, craft workshops).
 */
export function isCoveredIndoorExperience(p: Experience): boolean {
  if (p.isOutdoor === false) return true;
  if (p.category === "food" || p.category === "workshop") return true;

  const text = `${p.name} ${p.description ?? ""} ${p.tags.join(" ")}`.toLowerCase();
  return /(museum|temple|mandir|masjid|church|art|gallery|indoor|cafe|bazaar|pottery|craft|hall|palace|center|centre)/i.test(
    text,
  );
}

/**
 * Real-time adaptation: Swaps outdoor stops with nearby covered/indoor alternatives
 * when rain, thunderstorm, or extreme heat is detected.
 */
export function adaptPlanForWeather(
  plan: TripPlan,
  candidatePool: Experience[],
  condition: "rain" | "heat" = "rain",
): { plan: TripPlan; swappedCount: number; message: string } {
  const next: TripPlan = structuredClone(plan);
  let swappedCount = 0;

  // Existing placed IDs across all days to avoid duplicates
  const existingIds = new Set<string>();
  for (const d of next.days) {
    for (const s of d.stops) existingIds.add(s.experienceId);
  }

  // Find candidate indoor places that are not already in the plan
  const indoorCandidates = candidatePool.filter(
    (p) => !existingIds.has(p.id) && isCoveredIndoorExperience(p),
  );

  for (let d = 0; d < next.days.length; d++) {
    const day = next.days[d];
    for (let sIdx = 0; sIdx < day.stops.length; sIdx++) {
      const stop = day.stops[sIdx];

      // Never replace user-locked stops or essential meal stops
      if (stop.locked || stop.timeOfDay === "lunch" || stop.timeOfDay === "breakfast" || stop.timeOfDay === "dinner") {
        continue;
      }

      if (isOutdoorExperience(stop)) {
        // Find closest indoor candidate
        let bestCandidate: Experience | null = null;
        let bestDist = Infinity;

        for (const cand of indoorCandidates) {
          if (existingIds.has(cand.id)) continue;
          const dist =
            stop.lat !== undefined && stop.lon !== undefined && cand.lat !== undefined && cand.lon !== undefined
              ? haversineKm(stop.lat, stop.lon, cand.lat, cand.lon)
              : 5;
          if (dist < bestDist) {
            bestDist = dist;
            bestCandidate = cand;
          }
        }

        if (bestCandidate) {
          existingIds.add(bestCandidate.id);
          const newStop: ItineraryStop = {
            experienceId: bestCandidate.id,
            name: bestCandidate.name,
            category: bestCandidate.category,
            slotStart: stop.slotStart,
            slotEnd: stop.slotEnd,
            travelMinFromPrev: stop.travelMinFromPrev,
            durationMinutes: bestCandidate.durationMinutes || 60,
            pricePerPerson: bestCandidate.pricePerPerson,
            priceBasis: bestCandidate.priceHint ? "verified_quote" : "Varies on site",
            priceMin: bestCandidate.priceHint?.min,
            priceMax: bestCandidate.priceHint?.max,
            lat: bestCandidate.lat,
            lon: bestCandidate.lon,
            imageUrl: bestCandidate.imageUrl,
            note: `Weather-adapted for ${condition}: sheltered replacement for ${stop.name}`,
          };
          day.stops[sIdx] = newStop;
          swappedCount++;
        }
      }
    }
  }

  const alertMsg =
    condition === "rain"
      ? `🌧️ Route adapted for rain: Swapped ${swappedCount} outdoor ${swappedCount === 1 ? "stop" : "stops"} with covered cultural & cafe alternatives.`
      : `☀️ Route adapted for extreme heat: Swapped ${swappedCount} outdoor ${swappedCount === 1 ? "stop" : "stops"} with shaded/indoor venues.`;

  const updatedPlan = recomputePlanMetrics(next, { reslot: true });
  updatedPlan.weatherAdapted = true;
  updatedPlan.weatherAlert = alertMsg;

  return {
    plan: updatedPlan,
    swappedCount,
    message: alertMsg,
  };
}

/**
 * 1-Click "Running Late" Adjuster: Trims the day's lowest priority non-meal stop
 * or reslots the remaining hours so the traveler can catch up without missing dinner.
 */
export function trimPlanForLateRunning(
  plan: TripPlan,
  dayIndex = 0,
  delayMinutes = 60,
): { plan: TripPlan; trimmedStopName?: string } {
  const next: TripPlan = structuredClone(plan);
  const day = next.days[dayIndex];
  if (!day || day.stops.length <= 2) {
    return { plan: next };
  }

  // Find the best non-meal, unlocked stop to drop in the afternoon
  let dropIdx = -1;
  for (let i = day.stops.length - 1; i >= 0; i--) {
    const s = day.stops[i];
    if (s.locked) continue;
    if (s.timeOfDay === "breakfast" || s.timeOfDay === "lunch" || s.timeOfDay === "dinner") continue;
    dropIdx = i;
    break;
  }

  let trimmedStopName: string | undefined;
  if (dropIdx >= 0) {
    trimmedStopName = day.stops[dropIdx].name;
    day.stops.splice(dropIdx, 1);
  }

  const updatedPlan = recomputePlanMetrics(next, { reslot: true });
  updatedPlan.feasibility = {
    ok: true,
    message: trimmedStopName
      ? `⏰ Schedule caught up (+${delayMinutes}m delay recovered by trimming ${trimmedStopName}).`
      : `⏰ Schedule adjusted for ${delayMinutes}m delay.`,
  };

  return {
    plan: updatedPlan,
    trimmedStopName,
  };
}

/**
 * Contextual alternative finder: Suggests top 3 smart substitutes in the same vicinity
 * if a planned activity is closed or unavailable.
 */
export function suggestAlternativesForStop(
  stop: ItineraryStop,
  candidatePool: Experience[],
  limit = 3,
): Experience[] {
  return candidatePool
    .filter((p) => p.id !== stop.experienceId && p.lat !== undefined && p.lon !== undefined)
    .map((p) => {
      const dist =
        stop.lat !== undefined && stop.lon !== undefined && p.lat !== undefined && p.lon !== undefined
          ? haversineKm(stop.lat, stop.lon, p.lat, p.lon)
          : 99;
      const categoryMatch = p.category === stop.category ? 2 : 1;
      const score = (10 - Math.min(dist, 10)) + categoryMatch * 3 + (p.popularityScore || 0) * 2;
      return { p, dist, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}
