// ─── Digital Twin What-If Simulation Engine ──────────────────────────────
import type { Experience, TripPlan } from "./types";
import type { WeatherVector } from "./weather";
import { assessStopWeatherImpact, classifyExposure } from "./weather-impact";
import { queryNugenReasoning, type NugenCausalExplanation } from "./nugen-client";
import { recomputePlanMetrics } from "./planner";

export interface ScenarioOverrides {
  precipMm?: number;
  tempC?: number;
  windKmh?: number;
  floodLevel?: "none" | "minor" | "major";
  preferTransit?: boolean;
}

export interface TwinDiff {
  compromisedCount: number;
  replacedCount: number;
  substitutions: Array<{ original: string; substitute: string; reason: string }>;
  originalWalkKm: number;
  simulatedWalkKm: number;
  originalTotalHours: number;
  simulatedTotalHours: number;
}

export interface TwinSimulationResult {
  simulatedPlan: TripPlan;
  diff: TwinDiff;
  explanation: NugenCausalExplanation;
  confidence: number;
}

/**
 * Runs a deterministic what-if weather simulation on a shadow copy of an itinerary.
 * Does NOT mutate the input plan.
 */
export async function simulateScenario(
  plan: TripPlan,
  scenario: ScenarioOverrides,
  catalogPlaces: Experience[] = [],
  weatherVector?: WeatherVector,
): Promise<TwinSimulationResult> {
  const simulatedPlan: TripPlan = structuredClone(plan);
  const effectiveWeather = {
    tempC: scenario.tempC ?? weatherVector?.tempC ?? 28,
    precipMm: scenario.precipMm ?? weatherVector?.precipMm ?? 0,
    windKmh: scenario.windKmh ?? weatherVector?.windKmh ?? 10,
    code: (scenario.precipMm || 0) > 20 ? 65 : (scenario.precipMm || 0) > 5 ? 61 : 0,
  };

  const compromisedStopNames: string[] = [];
  const substitutions: Array<{ original: string; substitute: string; reason: string }> = [];

  // Used place IDs across all days to prevent duplicates
  const existingPlaceIds = new Set<string>();
  for (const day of simulatedPlan.days) {
    for (const stop of day.stops) {
      existingPlaceIds.add(stop.experienceId);
    }
  }

  // Find candidate indoor shelters from catalog
  const indoorCandidates = catalogPlaces.filter((p) => {
    if (existingPlaceIds.has(p.id)) return false;
    const exposure = classifyExposure({ name: p.name, category: p.category });
    return exposure === "indoor" || p.category === "culture";
  });
  let candidateIdx = 0;

  for (const day of simulatedPlan.days) {
    for (let i = 0; i < day.stops.length; i++) {
      const stop = day.stops[i];
      // Invariant 9: Never replace or discard meal anchors (breakfast, lunch, dinner)
      const isMeal =
        stop.category === "food" ||
        stop.timeOfDay === "breakfast" ||
        stop.timeOfDay === "lunch" ||
        stop.timeOfDay === "dinner" ||
        /breakfast|lunch|dinner|thali|misal|chai|cafe/i.test(stop.name);

      if (isMeal) continue;

      const assessment = assessStopWeatherImpact(stop, effectiveWeather);
      if (assessment.isCompromised) {
        compromisedStopNames.push(stop.name);

        // Find an indoor substitute
        if (candidateIdx < indoorCandidates.length) {
          const substitute = indoorCandidates[candidateIdx++];
          existingPlaceIds.add(substitute.id);
          substitutions.push({
            original: stop.name,
            substitute: substitute.name,
            reason: assessment.hazardReason || "Unsuitable weather conditions",
          });

          // Substitute the stop in the shadow plan
          day.stops[i] = {
            ...stop,
            experienceId: substitute.id,
            name: substitute.name,
            category: substitute.category,
            lat: substitute.lat,
            lon: substitute.lon,
            durationMinutes: substitute.durationMinutes || stop.durationMinutes || 60,
            note: `Weather alternative for ${stop.name} (${assessment.hazardReason || "rain"})`,
          };
        }
      }
    }
  }

  // Switch transit mode to transit if rain > 12 mm/hr and mode was walk
  if ((scenario.precipMm || 0) > 12 && simulatedPlan.transportMode === "walk") {
    simulatedPlan.transportMode = "transit";
  }

  // Reslot all timing metrics cleanly
  const reslotted = recomputePlanMetrics(simulatedPlan, { reslot: true });

  // Get Nugen causal explanation
  const explanation = await queryNugenReasoning({
    task: "explain_twin_simulation",
    city: plan.city || "Pune",
    scenario,
    originalPlan: plan,
    simulatedPlan: reslotted,
    weatherVector,
    compromisedStops: compromisedStopNames,
    substitutions,
  });

  const originalWalkKm = plan.days.reduce((acc, d) => acc + (d.walkKm || 0), 0);
  const simulatedWalkKm = reslotted.days.reduce((acc, d) => acc + (d.walkKm || 0), 0);
  const originalTotalHours = plan.days.reduce((acc, d) => acc + (d.totalHours || 0), 0);
  const simulatedTotalHours = reslotted.days.reduce((acc, d) => acc + (d.totalHours || 0), 0);

  return {
    simulatedPlan: reslotted,
    diff: {
      compromisedCount: compromisedStopNames.length,
      replacedCount: substitutions.length,
      substitutions,
      originalWalkKm: Math.round(originalWalkKm * 10) / 10,
      simulatedWalkKm: Math.round(simulatedWalkKm * 10) / 10,
      originalTotalHours: Math.round(originalTotalHours * 10) / 10,
      simulatedTotalHours: Math.round(simulatedTotalHours * 10) / 10,
    },
    explanation,
    confidence: explanation.confidence,
  };
}
