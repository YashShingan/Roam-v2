// ─── Weather Impact & Exposure Classification Engine ───────────────────────
import type { Category, ItineraryStop } from "./types";
import type { WeatherVector } from "./weather";

export type ExposureType = "outdoor" | "semi-outdoor" | "indoor";

export interface PlaceImpactAssessment {
  stopName: string;
  category: Category;
  exposure: ExposureType;
  suitability: number; // 0 (impossible / hazardous) to 100 (ideal)
  isCompromised: boolean;
  hazardReason?: string;
  recommendedAction?: "keep" | "replace_indoor" | "shift_morning" | "shift_transit";
}

/**
 * Classifies an experience or stop into outdoor, semi-outdoor, or indoor.
 */
export function classifyExposure(stop: { name: string; category?: Category; note?: string }): ExposureType {
  const name = (stop.name || "").toLowerCase();
  const cat = stop.category;
  const note = (stop.note || "").toLowerCase();

  // 1. High-exposure outdoor elements
  if (
    /fort|gad|trek|peak|summit|ghat|lake|river|waterfall|garden|park|beach|viewpoint|valley|dam|sanctuary|trail/i.test(name) ||
    /trek|climb|hike|boat|open-air|safari|outdoor/i.test(note)
  ) {
    return "outdoor";
  }

  // 2. Clear indoor shelters
  if (
    /museum|palace|darshan|gallery|mall|hall|theatre|cinema|aquarium|planetarium/i.test(name) ||
    cat === "food" ||
    /indoor|shelter|dining|restaurant|cafe|bhojanalay/i.test(note)
  ) {
    return "indoor";
  }

  // 3. Semi-outdoor heritage & markets
  if (
    /temple|mandir|masjid|dargah|church|market|bazaar|chowk|street|promenade/i.test(name) ||
    cat === "market"
  ) {
    return "semi-outdoor";
  }

  // Default based on category
  if (cat === "nature") return "outdoor";
  if (cat === "culture") return "semi-outdoor";
  return "semi-outdoor";
}

/**
 * Computes a 0–100 weather suitability score for a given exposure type under weather conditions.
 */
export function computeWeatherSuitability(
  weather: {
    tempC: number;
    precipMm?: number;
    windKmh?: number;
    code?: number;
  },
  exposure: ExposureType,
): { score: number; hazardReason?: string } {
  const rain = weather.precipMm ?? 0;
  const temp = weather.tempC;
  const wind = weather.windKmh ?? 0;
  const code = weather.code ?? 0;

  // Severe storms / thunderstorms
  const isStorm = code >= 95 || (code >= 81 && rain > 20);
  if (isStorm) {
    if (exposure === "outdoor") {
      return { score: 10, hazardReason: "Thunderstorm / severe showers make outdoor sights hazardous" };
    }
    if (exposure === "semi-outdoor") {
      return { score: 25, hazardReason: "Waterlogging and heavy rain disrupt open courtyards" };
    }
    return { score: 80, hazardReason: "Sheltered indoor venue safe despite external storm" };
  }

  let score = 100;
  let hazardReason: string | undefined;

  // Precipitation impact
  if (rain > 0) {
    if (exposure === "outdoor") {
      if (rain > 20) {
        score -= 75;
        hazardReason = `Heavy torrential rain (${rain} mm/hr)`;
      } else if (rain > 8) {
        score -= 50;
        hazardReason = `Continuous rain (${rain} mm/hr)`;
      } else {
        score -= 25;
        hazardReason = `Passing light showers (${rain} mm/hr)`;
      }
    } else if (exposure === "semi-outdoor") {
      if (rain > 15) {
        score -= 40;
        hazardReason = `Wet and muddy footpaths (${rain} mm/hr)`;
      } else if (rain > 5) {
        score -= 20;
      }
    }
  }

  // Extreme Heat impact (> 37°C)
  if (temp >= 38) {
    if (exposure === "outdoor") {
      score -= Math.min(60, (temp - 37) * 12);
      hazardReason = hazardReason || `Severe midday heat (${temp}°C)`;
    } else if (exposure === "semi-outdoor") {
      score -= Math.min(35, (temp - 37) * 8);
      hazardReason = hazardReason || `Warm ambient temperature (${temp}°C)`;
    }
  }

  // High wind impact (> 45 km/h)
  if (wind > 45) {
    if (exposure === "outdoor") {
      score -= 30;
      hazardReason = hazardReason || `High wind gusts (${wind} km/h) at elevated elevations`;
    }
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return { score: finalScore, hazardReason };
}

/**
 * Assesses an itinerary stop under current or simulated weather conditions.
 */
export function assessStopWeatherImpact(
  stop: ItineraryStop,
  weather: { tempC: number; precipMm?: number; windKmh?: number; code?: number },
): PlaceImpactAssessment {
  const exposure = classifyExposure(stop);
  const { score, hazardReason } = computeWeatherSuitability(weather, exposure);
  const isCompromised = score < 40;

  let recommendedAction: PlaceImpactAssessment["recommendedAction"] = "keep";
  if (isCompromised) {
    if (exposure === "outdoor") {
      recommendedAction = "replace_indoor";
    } else if (exposure === "semi-outdoor" && (weather.tempC || 0) >= 38) {
      recommendedAction = "shift_morning";
    } else {
      recommendedAction = "replace_indoor";
    }
  }

  return {
    stopName: stop.name,
    category: stop.category,
    exposure,
    suitability: score,
    isCompromised,
    hazardReason,
    recommendedAction,
  };
}
