// ─── Deterministic, explainable trip planner (selection → clustering → 2-opt TSP route → price bands) ──
import type {
  Category,
  Experience,
  ItineraryStop,
  StartAnchor,
  TimeMode,
  TransportMode,
  TripDay,
  TripPlan,
  Vibe,
} from "./types";
import { haversineKm, cached } from "./net";
import { openNowFromHours } from "./pipeline";
import { deriveStopPriceInfo } from "./price-engine";

export interface PlanRequest {
  city: string;
  cityLabel: string;
  lat?: number;
  lon?: number;
  days: number;
  hoursPerDay: number;
  interests?: Category[];
  strictCategories?: boolean;
  selectedPlaceIds?: string[];
  lockedPlaceIds?: string[];
  excludedPlaceIds?: string[];
  budget?: number;
  vibe?: Vibe;
  sunsetMin?: number; // minutes from midnight
  radiusKm?: number;
  transportMode?: TransportMode;
  timeMode?: TimeMode;
  startAnchor?: StartAnchor;
}

export interface ScoredPlace {
  exp: Experience;
  score: number;
  fit: number;
}

export function scorePlaces(
  places: Experience[],
  req: PlanRequest,
): ScoredPlace[] {
  const radius = req.radiusKm ?? 15;
  const anchorLat = req.startAnchor?.lat ?? req.lat ?? 0;
  const anchorLon = req.startAnchor?.lon ?? req.lon ?? 0;
  const maxDist = places.reduce(
    (m, p) =>
      Math.max(
        m,
        p.lat !== undefined && p.lon !== undefined ? haversineKm(anchorLat, anchorLon, p.lat, p.lon) : 0,
      ),
    0.001,
  );
  const vibeBoost: Record<Vibe, Category[]> = {
    chill: ["nature", "food", "hidden_gem"],
    packed: ["culture", "market", "food"],
    foodie: ["food", "market", "hidden_gem"],
    heritage: ["culture", "hidden_gem", "market"],
  };
  return places
    .map((exp): ScoredPlace => {
      const sentimentNorm = exp.community.sentiment === 0 ? 0.5 : (exp.community.sentiment + 1) / 2;
      const hidden = exp.community.hiddenGem ? 1 : 0;
      const interests = (req.interests?.length ? req.interests : vibeBoost[req.vibe ?? "packed"]) ?? [];
      let fit = interests.includes(exp.category) ? 1 : 0.4;
      if (req.vibe === "foodie" && exp.category === "food") fit = 1;
      if (req.vibe === "chill" && exp.durationMinutes > 150) fit -= 0.3;
      const effPrice = exp.priceHint?.min ?? (exp.priceIsEstimate ? undefined : exp.pricePerPerson);
      if (req.budget && effPrice !== undefined && effPrice > req.budget) fit -= 0.6;
      const dist =
        exp.lat !== undefined && exp.lon !== undefined && (anchorLat !== 0 || anchorLon !== 0)
          ? haversineKm(anchorLat, anchorLon, exp.lat, exp.lon)
          : maxDist * 0.6;
      const distNorm = Math.min(dist / Math.max(radius, maxDist), 1);
      const photoBonus = exp.imageUrl ? 0.3 : 0;
      const descBonus = exp.description && exp.description.length > 20 ? 0.15 : 0;
      const score =
        0.3 * Math.min(exp.popularityScore, 1) +
        0.2 * sentimentNorm +
        0.15 * hidden +
        0.15 * photoBonus +
        0.1 * descBonus +
        0.1 * Math.max(fit, 0) +
        0.1 * (1 - distNorm);
      return { exp, score, fit };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Computes realistic travel duration in minutes from road distance (km) and transport mode.
 * Public OSRM returns car speed (~40 km/h) for `duration` even on `/foot/`, so deriving
 * minutes from road distance (`km`) guarantees accurate Walk (4.8 km/h) vs Drive (24 km/h) times.
 */
export function durationMinutesFromKm(km: number, mode: TransportMode = "walk"): number {
  if (!Number.isFinite(km) || km < 0.03) return 0;
  if (mode === "drive") {
    return Math.max(2, Math.round((km / 24) * 60 + 1));
  }
  return Math.max(1, Math.round((km / 4.8) * 60));
}

export function estimateLeg(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  mode: TransportMode = "walk",
): { minutes: number; km: number } {
  const straight = haversineKm(aLat, aLon, bLat, bLon);
  const factor = mode === "drive" ? 1.3 : 1.4;
  const km = Number((straight * factor).toFixed(2));
  const minutes = durationMinutesFromKm(km, mode);
  return { minutes, km };
}

/** OSRM walking/driving durations + distances + geometry for an ordered waypoint list. */
export async function osrmLegs(
  points: { lat: number; lon: number }[],
  mode: TransportMode = "walk",
): Promise<{ minutes: number[]; kms: number[]; geometries: [number, number][][] } | null> {
  if (points.length < 2) return null;
  const profile = mode === "drive" ? "driving" : "foot";
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  try {
    return await cached(`osrm:${profile}:${coords}`, async () => {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson`,
        { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "RoamApp/1.0" } },
      );
      if (!res.ok) throw new Error(`OSRM ${res.status}`);
      const j = (await res.json()) as {
        routes?: {
          legs?: {
            duration: number;
            distance: number;
            geometry?: { coordinates?: [number, number][] };
          }[];
        }[];
      };
      const route = j.routes?.[0];
      if (!route?.legs) throw new Error("no legs");
      const kms = route.legs.map((l) => Number(((l.distance ?? 0) / 1000).toFixed(2)));
      return {
        minutes: kms.map((km) => durationMinutesFromKm(km, mode)),
        kms,
        geometries: route.legs.map((l) =>
          (l.geometry?.coordinates ?? []).map(([lon, lat]) => [lat, lon] as [number, number]),
        ),
      };
    });
  } catch {
    return null;
  }
}

export const fmtSlot = (min: number): string => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * Nearest-Neighbor + 2-Opt TSP route optimizer starting from anchor (lat, lon).
 * Ensures consecutive stops form a smooth, non-backtracking geographic route.
 */
export function optimizeDayRoute(
  candidates: ScoredPlace[],
  anchor: { lat: number; lon: number; placeId?: string },
): ScoredPlace[] {
  if (candidates.length <= 1) return [...candidates];

  const remaining = [...candidates];
  const ordered: ScoredPlace[] = [];

  // 1. If anchor specifies a specific placeId in candidates, start with it
  if (anchor.placeId) {
    const idx = remaining.findIndex((c) => c.exp.id === anchor.placeId);
    if (idx >= 0) {
      ordered.push(remaining.splice(idx, 1)[0]);
    }
  }

  let curLat = ordered[0]?.exp.lat ?? anchor.lat;
  let curLon = ordered[0]?.exp.lon ?? anchor.lon;

  // 2. Greedy Nearest-Neighbor construction from current position
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i].exp;
      const d =
        p.lat !== undefined && p.lon !== undefined
          ? haversineKm(curLat, curLon, p.lat, p.lon)
          : 5.0;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    if (next.exp.lat !== undefined && next.exp.lon !== undefined) {
      curLat = next.exp.lat;
      curLon = next.exp.lon;
    }
  }

  // 3. 2-Opt local search refinement to uncross any self-intersecting route legs
  const ptAt = (idx: number): { lat: number; lon: number } => {
    if (idx < 0) return { lat: anchor.lat, lon: anchor.lon };
    const e = ordered[idx].exp;
    return { lat: e.lat ?? anchor.lat, lon: e.lon ?? anchor.lon };
  };

  const distBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    haversineKm(a.lat, a.lon, b.lat, b.lon);

  const startFixed = anchor.placeId && ordered[0]?.exp.id === anchor.placeId ? 1 : 0;
  let improved = true;
  let passes = 0;
  while (improved && passes < 20) {
    improved = false;
    passes++;
    for (let i = startFixed; i < ordered.length - 1; i++) {
      for (let k = i + 1; k < ordered.length; k++) {
        const A = ptAt(i - 1);
        const B = ptAt(i);
        const C = ptAt(k);
        const D = k + 1 < ordered.length ? ptAt(k + 1) : null;

        const currentCost = distBetween(A, B) + (D ? distBetween(C, D) : 0);
        const newCost = distBetween(A, C) + (D ? distBetween(B, D) : 0);

        if (newCost + 0.01 < currentCost) {
          const reversed = ordered.slice(i, k + 1).reverse();
          ordered.splice(i, k - i + 1, ...reversed);
          improved = true;
        }
      }
    }
  }

  return ordered;
}

/**
 * Builds a multi-stop Google Maps Directions URL covering the start anchor and all stops in order.
 */
export function buildMultiStopGmapsUrl(
  stops: ItineraryStop[],
  startAnchor?: StartAnchor,
  mode: TransportMode = "walk",
): string | undefined {
  const validStops = stops.filter((s) => s.lat !== undefined && s.lon !== undefined);
  if (validStops.length === 0) return undefined;

  const travelmode = mode === "drive" ? "driving" : "walking";
  const pts: string[] = [];

  if (
    startAnchor &&
    Number.isFinite(startAnchor.lat) &&
    Number.isFinite(startAnchor.lon) &&
    (Math.abs(startAnchor.lat - (validStops[0].lat ?? 0)) > 0.0005 ||
      Math.abs(startAnchor.lon - (validStops[0].lon ?? 0)) > 0.0005)
  ) {
    pts.push(`${startAnchor.lat},${startAnchor.lon}`);
  }

  for (const s of validStops) {
    pts.push(`${s.lat},${s.lon}`);
  }

  if (pts.length === 1) {
    return `https://www.google.com/maps/dir/?api=1&destination=${pts[0]}&travelmode=${travelmode}`;
  }

  const origin = pts[0];
  const destination = pts[pts.length - 1];
  const middle = pts.slice(1, -1).slice(0, 9); // Google Maps URL supports up to 9 intermediate waypoints
  const wpParam = middle.length > 0 ? `&waypoints=${encodeURIComponent(middle.join("|"))}` : "";
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${wpParam}&travelmode=${travelmode}`;
}

/**
 * Recomputes time slots, leg distances, total hours, price bands, feasibility, and voice summary.
 * Called both during initial planning and whenever the user edits/reorders/removes stops in PlanSheet.
 */
export function recomputePlanMetrics(
  plan: TripPlan,
  opts: { reslot?: boolean; hoursPerDayCap?: number; recalcTravelFromMode?: boolean } = { reslot: true },
): TripPlan {
  const next: TripPlan = structuredClone(plan);
  const mode: TransportMode = next.transportMode ?? "walk";
  const timeMode: TimeMode = next.timeMode ?? "recommended";
  const hoursCap = opts.hoursPerDayCap ?? 8;

  let totalMinutesAllDays = 0;

  for (let dIdx = 0; dIdx < next.days.length; dIdx++) {
    const day = next.days[dIdx];
    let clock = 9 * 60; // 09:00 AM
    let dayTravelMin = 0;
    let dayDistKm = 0;

    for (let i = 0; i < day.stops.length; i++) {
      const s = day.stops[i];
      let travelMin = s.travelMinFromPrev ?? 0;
      let legKm = s.legKmFromPrev;

      if (i === 0) {
        if (
          next.startAnchor &&
          s.lat !== undefined &&
          s.lon !== undefined &&
          (Math.abs(next.startAnchor.lat - s.lat) > 0.0005 ||
            Math.abs(next.startAnchor.lon - s.lon) > 0.0005)
        ) {
          const est = estimateLeg(next.startAnchor.lat, next.startAnchor.lon, s.lat, s.lon, mode);
          if (legKm === undefined || legKm === 0) legKm = est.km;
          if (opts.recalcTravelFromMode || !travelMin) {
            travelMin = durationMinutesFromKm(legKm, mode);
          }
        } else {
          travelMin = 0;
          legKm = 0;
        }
      } else {
        const prev = day.stops[i - 1];
        if (prev.lat !== undefined && prev.lon !== undefined && s.lat !== undefined && s.lon !== undefined) {
          const est = estimateLeg(prev.lat, prev.lon, s.lat, s.lon, mode);
          if (legKm === undefined || legKm === 0) legKm = est.km;
          if (opts.recalcTravelFromMode || travelMin === undefined || travelMin === null || travelMin === 0) {
            travelMin = durationMinutesFromKm(legKm, mode);
          }
        }
      }

      s.travelMinFromPrev = Math.max(0, Math.round(travelMin));
      s.legKmFromPrev = legKm !== undefined ? Number(legKm.toFixed(2)) : 0;
      dayTravelMin += s.travelMinFromPrev;
      dayDistKm += s.legKmFromPrev;

      if (opts.reslot !== false) {
        clock += s.travelMinFromPrev;
        const start = clock;
        const end = clock + (s.durationMinutes || 60);
        clock = end + 10; // 10-min buffer between stops
        s.slotStart = fmtSlot(start);
        s.slotEnd = fmtSlot(end);

        const startH = Math.floor(start / 60);
        let tod = "afternoon";
        if (startH < 12) tod = "morning";
        else if (startH >= 12 && startH < 15 && s.category === "food") tod = "lunch";
        else if (startH >= 12 && startH < 17) tod = "afternoon";
        else if (startH >= 17 && startH < 19) tod = "sunset";
        else if (startH >= 19 && s.category === "food") tod = "dinner";
        else if (startH >= 19) tod = "evening";
        s.timeOfDay = tod;
      }

      const modeLabel = mode === "drive" ? "drive" : "walk";
      if (i === 0) {
        s.note =
          s.travelMinFromPrev > 0 && next.startAnchor
            ? `${s.travelMinFromPrev} min ${modeLabel} (${s.legKmFromPrev} km) from ${next.startAnchor.label}`
            : "Start here";
      } else {
        s.note = `${s.travelMinFromPrev} min ${modeLabel}${s.legKmFromPrev ? ` (${s.legKmFromPrev} km)` : ""} from previous`;
      }

      if (s.lat !== undefined && s.lon !== undefined) {
        const prevPt =
          i > 0 && day.stops[i - 1].lat !== undefined && day.stops[i - 1].lon !== undefined
            ? `${day.stops[i - 1].lat},${day.stops[i - 1].lon}`
            : next.startAnchor
              ? `${next.startAnchor.lat},${next.startAnchor.lon}`
              : undefined;
        const tm = mode === "drive" ? "driving" : "walking";
        s.gmapsDirectionsUrl = prevPt
          ? `https://www.google.com/maps/dir/?api=1&origin=${prevPt}&destination=${s.lat},${s.lon}&travelmode=${tm}`
          : `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=${tm}`;
      }
    }

    const visitMinutes = day.stops.reduce((acc, st) => acc + (st.durationMinutes || 0), 0);
    const dayTotalMin = visitMinutes + dayTravelMin;
    totalMinutesAllDays += dayTotalMin;

    day.totalHours = Number((dayTotalMin / 60).toFixed(1));
    if (mode === "drive") {
      day.driveKm = Number(dayDistKm.toFixed(1));
      day.walkKm = Number(dayDistKm.toFixed(1));
    } else {
      day.walkKm = Number(dayDistKm.toFixed(1));
      day.driveKm = undefined;
    }
  }

  // Price Band calculation
  const allStops = next.days.flatMap((d) => d.stops);
  const pricedStops = allStops.filter((s) => s.priceMin !== undefined && s.priceMin !== null);
  const minSum = pricedStops.reduce((acc, s) => acc + Math.round(s.priceMin ?? 0), 0);
  const maxSum = pricedStops.reduce((acc, s) => acc + Math.round(s.priceMax ?? s.priceMin ?? 0), 0);
  const pricedCount = pricedStops.length;
  const totalStops = allStops.length;
  const unpricedCount = totalStops - pricedCount;

  let bandNote = "all stops priced";
  if (pricedCount === 0) {
    bandNote = "All stops have variable/unknown prices";
  } else if (unpricedCount > 0) {
    bandNote = `excludes ${unpricedCount} unpriced stop${unpricedCount > 1 ? "s" : ""}`;
  }

  next.budgetBand = {
    min: minSum,
    max: maxSum,
    pricedCount,
    totalStops,
    unpricedCount,
    note: bandNote,
  };
  next.budgetTotal = minSum;

  const recHoursTotal = Number((totalMinutesAllDays / 60).toFixed(1));
  const overTime =
    timeMode === "capped" && totalMinutesAllDays > next.days.length * hoursCap * 60 * 1.08;
  const overBudget = next.budgetPerDay !== undefined && minSum > next.budgetPerDay;

  let feasMsg = "";
  if (timeMode === "recommended") {
    feasMsg = `Engine recommended schedule: ~${recHoursTotal} h total (${totalStops} stop${totalStops === 1 ? "" : "s"}, ${mode === "drive" ? "driving" : "walking"} route)`;
  } else if (overTime) {
    feasMsg = `Runs ~${(recHoursTotal - next.days.length * hoursCap).toFixed(1)} h over your ${hoursCap} h/day cap — switch to Engine Recommended or trim a stop.`;
  } else {
    feasMsg = `Fits your ${hoursCap} h/day budget (~${recHoursTotal} h total across ${totalStops} stop${totalStops === 1 ? "" : "s"}).`;
  }

  if (next.budgetPerDay !== undefined) {
    if (overBudget) {
      feasMsg += ` · Over ₹${next.budgetPerDay.toLocaleString("en-IN")} budget by ~₹${(minSum - next.budgetPerDay).toLocaleString("en-IN")}.`;
    } else if (pricedCount > 0) {
      feasMsg += ` · Fits ₹${next.budgetPerDay.toLocaleString("en-IN")} budget (min-sum ₹${minSum.toLocaleString("en-IN")}).`;
    }
  }

  next.feasibility = {
    ok: !overTime && !overBudget && totalStops > 0,
    message: feasMsg,
  };

  const priceVoice =
    pricedCount > 0
      ? minSum === maxSum
        ? `Estimated spend about ₹${Intl.NumberFormat("en-IN").format(minSum)} per person.`
        : `Estimated spend between ₹${Intl.NumberFormat("en-IN").format(minSum)} and ₹${Intl.NumberFormat("en-IN").format(maxSum)} per person.`
      : `Prices vary across these stops.`;

  next.voiceSummary = [
    `Here is your ${next.days.length}-day ${mode === "drive" ? "driving" : "walking"} route for ${next.cityLabel.split(",")[0]}.`,
    ...next.days.map((d, i) => {
      const list = d.stops
        .slice(0, 5)
        .map((s) => `${s.name} at ${s.slotStart}`)
        .join(", then ");
      return `Day ${i + 1} (${d.totalHours} hours, ${d.walkKm ?? 0} km): ${list}${d.stops.length > 5 ? ", and more" : ""}.`;
    }),
    priceVoice,
  ].join(" ");

  return next;
}

export async function buildTripPlan(places: Experience[], req: PlanRequest): Promise<TripPlan> {
  const mode: TransportMode = req.transportMode ?? "walk";
  const timeMode: TimeMode = req.timeMode ?? "recommended";
  const anchor: StartAnchor = req.startAnchor ?? {
    type: "city",
    label: `${req.cityLabel.split(",")[0]} Center`,
    lat: req.lat ?? 19.2437,
    lon: req.lon ?? 73.1355,
  };

  const excludedSet = new Set(req.excludedPlaceIds ?? []);
  const lockedSet = new Set(req.lockedPlaceIds ?? []);

  // 1. Strict place selection or category filtering (minus any disliked/excluded places)
  let candidatePool = places.filter((p) => !excludedSet.has(p.id));
  if (candidatePool.length === 0) candidatePool = [...places];

  if (req.selectedPlaceIds && req.selectedPlaceIds.length > 0) {
    const idSet = new Set(req.selectedPlaceIds.filter((id) => !excludedSet.has(id)));
    const picked = candidatePool.filter((p) => idSet.has(p.id) || lockedSet.has(p.id));
    if (picked.length > 0) {
      candidatePool = picked;
    }
  } else if (req.interests && req.interests.length > 0 && req.strictCategories !== false) {
    const catSet = new Set(req.interests);
    const matching = candidatePool.filter((p) => catSet.has(p.category) || lockedSet.has(p.id));
    if (matching.length > 0) {
      candidatePool = matching;
    }
  }

  // Budget filter (never drop unpriced places so "Varies" places remain routable)
  if (req.budget) {
    const withinBudget = candidatePool.filter((p) => {
      const eff = p.priceHint?.min ?? (p.priceIsEstimate ? undefined : p.pricePerPerson);
      return eff === undefined || eff <= req.budget!;
    });
    if (withinBudget.length > 0) {
      candidatePool = withinBudget;
    }
  }

  const scored = scorePlaces(candidatePool, req);
  const usable = scored.filter((s) => s.exp.lat !== undefined && s.exp.lon !== undefined);
  const pool =
    req.selectedPlaceIds && req.selectedPlaceIds.length > 0
      ? scored
      : usable.length >= Math.min(4, scored.length)
        ? usable
        : scored;

  // Determine how many stops to select across req.days
  const hasExplicitSelection = !!(req.selectedPlaceIds && req.selectedPlaceIds.length > 0);
  const allowFoodAnchors =
    !hasExplicitSelection &&
    (!req.interests || req.interests.length === 0 || req.interests.includes("food"));

  const dayCapacityMin = timeMode === "recommended" ? 10 * 60 : req.hoursPerDay * 60;
  const maxStopsPerDay = hasExplicitSelection
    ? Math.max(8, Math.ceil(pool.length / Math.max(req.days, 1)))
    : timeMode === "recommended"
      ? 6
      : Math.max(2, Math.min(8, Math.floor(req.hoursPerDay / 1.3)));

  // Pick top candidates (always keeping any locked/liked stops first)
  const selectedCandidates: ScoredPlace[] = [];
  const usedIds = new Set<string>();

  for (const s of pool) {
    if (lockedSet.has(s.exp.id) && !usedIds.has(s.exp.id)) {
      selectedCandidates.push(s);
      usedIds.add(s.exp.id);
    }
  }

  if (hasExplicitSelection) {
    for (const s of pool) {
      if (!usedIds.has(s.exp.id)) {
        selectedCandidates.push(s);
        usedIds.add(s.exp.id);
      }
    }
  } else {
    // Seed from anchor outward so the selected set is geographically coherent
    const foodTop = allowFoodAnchors ? pool.filter((s) => s.exp.category === "food").slice(0, req.days * 2) : [];
    const rest = pool.filter((s) => !foodTop.includes(s));
    const foods = [...foodTop];
    const targetTotal = req.days * maxStopsPerDay;

    while ((rest.length > 0 || foods.length > 0) && selectedCandidates.length < targetTotal) {
      if (allowFoodAnchors && selectedCandidates.length % 3 === 2 && foods.length > 0) {
        const f = foods.shift();
        if (f && !usedIds.has(f.exp.id)) {
          selectedCandidates.push(f);
          usedIds.add(f.exp.id);
        }
      } else {
        const r = rest.shift();
        if (r && !usedIds.has(r.exp.id)) {
          selectedCandidates.push(r);
          usedIds.add(r.exp.id);
        }
      }
    }
  }

  // 2. Partition candidates across days by angular sector around anchor, then run 2-Opt TSP per day
  const dayBuckets: ScoredPlace[][] = Array.from({ length: req.days }, () => []);
  if (req.days === 1) {
    dayBuckets[0] = selectedCandidates;
  } else {
    const withAngle = selectedCandidates.map((c) => {
      const dLat = (c.exp.lat ?? anchor.lat) - anchor.lat;
      const dLon = (c.exp.lon ?? anchor.lon) - anchor.lon;
      return { c, angle: Math.atan2(dLat, dLon) };
    });
    withAngle.sort((a, b) => a.angle - b.angle);
    withAngle.forEach((item, idx) => {
      const bIdx = Math.min(req.days - 1, Math.floor((idx / Math.max(withAngle.length, 1)) * req.days));
      dayBuckets[bIdx].push(item.c);
    });
  }

  const tripDays: TripDay[] = [];
  const goldenNotes: string[] = [];

  for (let d = 0; d < req.days; d++) {
    // Optimize route order for Day d using Nearest-Neighbor + 2-Opt from anchor
    let dayCandidates = optimizeDayRoute(dayBuckets[d], anchor);

    // If capped time mode and not explicit hand-picked selection, trim to fit dayCapacityMin
    if (timeMode === "capped" && !hasExplicitSelection) {
      const trimmed: ScoredPlace[] = [];
      let load = 0;
      for (const s of dayCandidates) {
        if (trimmed.length >= 2 && load + s.exp.durationMinutes > dayCapacityMin) break;
        trimmed.push(s);
        load += s.exp.durationMinutes + 15;
      }
      dayCandidates = trimmed;
    }

    // Build OSRM waypoints: [anchor (if distinct from stop 0), stop 0, stop 1, ...]
    const stopPoints = dayCandidates.map((s) => ({
      lat: s.exp.lat ?? anchor.lat,
      lon: s.exp.lon ?? anchor.lon,
    }));

    const includeAnchorLeg =
      stopPoints.length > 0 &&
      (Math.abs(anchor.lat - stopPoints[0].lat) > 0.0005 ||
        Math.abs(anchor.lon - stopPoints[0].lon) > 0.0005);

    const osrmPoints = includeAnchorLeg ? [{ lat: anchor.lat, lon: anchor.lon }, ...stopPoints] : stopPoints;
    const legs = await osrmLegs(osrmPoints, mode);

    const stops: ItineraryStop[] = [];
    for (let i = 0; i < dayCandidates.length; i++) {
      const exp = dayCandidates[i].exp;
      let travelMin = 0;
      let legKm = 0;
      let geometry: [number, number][] | undefined;

      if (includeAnchorLeg) {
        // leg index in osrmPoints is i (0 is anchor -> stop[0], 1 is stop[0] -> stop[1], etc.)
        if (legs && legs.minutes[i] !== undefined) {
          travelMin = legs.minutes[i];
          legKm = legs.kms[i];
          geometry = legs.geometries[i];
        } else {
          const prevPt = i === 0 ? anchor : stopPoints[i - 1];
          const est = estimateLeg(prevPt.lat, prevPt.lon, stopPoints[i].lat, stopPoints[i].lon, mode);
          travelMin = est.minutes;
          legKm = est.km;
          geometry = [
            [prevPt.lat, prevPt.lon],
            [stopPoints[i].lat, stopPoints[i].lon],
          ];
        }
      } else if (i > 0) {
        if (legs && legs.minutes[i - 1] !== undefined) {
          travelMin = legs.minutes[i - 1];
          legKm = legs.kms[i - 1];
          geometry = legs.geometries[i - 1];
        } else {
          const est = estimateLeg(
            stopPoints[i - 1].lat,
            stopPoints[i - 1].lon,
            stopPoints[i].lat,
            stopPoints[i].lon,
            mode,
          );
          travelMin = est.minutes;
          legKm = est.km;
          geometry = [
            [stopPoints[i - 1].lat, stopPoints[i - 1].lon],
            [stopPoints[i].lat, stopPoints[i].lon],
          ];
        }
      }

      const priceInfo = deriveStopPriceInfo(exp);

      // Check opening hours shift heuristic
      const approxClock = 9 * 60 + i * 75;
      const open = openNowFromHours(
        exp.openingHoursRaw,
        new Date(new Date().setHours(Math.floor(approxClock / 60) % 24, approxClock % 60)),
      );
      void open;

      stops.push({
        experienceId: exp.id,
        name: exp.name,
        category: exp.category,
        slotStart: "09:00",
        slotEnd: "10:00",
        travelMinFromPrev: travelMin,
        legKmFromPrev: legKm,
        legGeometry: geometry,
        lat: exp.lat,
        lon: exp.lon,
        durationMinutes: exp.durationMinutes,
        pricePerPerson: priceInfo.pricePerPerson,
        priceBasis: priceInfo.priceBasis,
        priceMin: priceInfo.priceMin,
        priceMax: priceInfo.priceMax,
        priceQuote: priceInfo.priceQuote,
        imageUrl: exp.imageUrl,
        timeOfDay: "morning",
        locked: lockedSet.has(exp.id),
      });
    }

    // Golden hour note
    const sunset = req.sunsetMin;
    if (sunset) {
      const golden = stops.filter(
        (s) => /viewpoint|fort|lake|beach|hill|ghat|palace|nature/i.test(s.name) || s.category === "nature",
      );
      if (golden.length > 0) {
        const lastGolden = golden[golden.length - 1];
        goldenNotes.push(
          `Day ${d + 1}: ${lastGolden.name} is positioned on your route for golden hour (sunset ${fmtSlot(sunset)}).`,
        );
      }
    }

    tripDays.push({
      stops,
      totalHours: 0,
      walkKm: 0,
    });
  }

  const id = `trip_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const initialPlan: TripPlan = {
    id,
    city: req.city,
    cityLabel: req.cityLabel,
    lat: req.lat,
    lon: req.lon,
    createdAt: new Date().toISOString(),
    days: tripDays,
    voiceSummary: "",
    feasibility: { ok: true, message: "" },
    budgetTotal: 0,
    budgetPerDay: req.budget ? req.budget * req.days : undefined,
    transportMode: mode,
    timeMode,
    startAnchor: anchor,
    selectedCategories: req.interests,
    shareUrl: `/trip/${id}`,
    votes: {},
    goldenHourNotes: goldenNotes,
  };

  return recomputePlanMetrics(initialPlan, { reslot: true, hoursPerDayCap: req.hoursPerDay });
}
