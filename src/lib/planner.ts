// ─── Deterministic, explainable trip planner (scoring → clustering → slots) ──
import type { Category, Experience, ItineraryStop, TripDay, TripPlan, Vibe } from "./types";
import { haversineKm, cached } from "./net";
import { openNowFromHours } from "./pipeline";

export interface PlanRequest {
  city: string;
  cityLabel: string;
  lat?: number;
  lon?: number;
  days: number;
  hoursPerDay: number;
  interests?: Category[];
  budget?: number;
  vibe?: Vibe;
  sunsetMin?: number; // minutes from midnight
  radiusKm?: number;
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
  const maxDist = places.reduce(
    (m, p) => Math.max(m, p.lat !== undefined && p.lon !== undefined ? haversineKm(req.lat ?? 0, req.lon ?? 0, p.lat, p.lon) : 0),
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
      if (req.budget && (exp.pricePerPerson ?? 0) > req.budget) fit -= 0.6;
      const dist =
        exp.lat !== undefined && exp.lon !== undefined && req.lat !== undefined && req.lon !== undefined
          ? haversineKm(req.lat, req.lon, exp.lat, exp.lon)
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

function walkMinutes(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const km = haversineKm(aLat, aLon, bLat, bLon) * 1.4;
  return Math.max(1, Math.round((km / 4.5) * 60));
}

/** OSRM walking durations + geometry for an ordered stop list. */
async function osrmLegs(
  points: { lat: number; lon: number }[],
): Promise<{ minutes: number[]; geometries: [number, number][][] } | null> {
  if (points.length < 2) return null;
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  try {
    return await cached(`osrm:${coords}`, async () => {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/foot/${coords}?overview=full&geometries=geojson`,
        { signal: AbortSignal.timeout(12000), headers: { "User-Agent": "RoamApp/1.0" } },
      );
      if (!res.ok) throw new Error(`OSRM ${res.status}`);
      const j = (await res.json()) as {
        routes?: { legs?: { duration: number; geometry?: { coordinates?: [number, number][] } }[] }[];
      };
      const route = j.routes?.[0];
      if (!route?.legs) throw new Error("no legs");
      return {
        minutes: route.legs.map((l) => Math.max(1, Math.round(l.duration / 60))),
        geometries: route.legs.map((l) => (l.geometry?.coordinates ?? []).map(([lon, lat]) => [lat, lon] as [number, number])),
      };
    });
  } catch {
    return null;
  }
}

const fmtSlot = (min: number): string => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export async function buildTripPlan(places: Experience[], req: PlanRequest): Promise<TripPlan> {
  const scored = scorePlaces(places, req);
  const usable = scored.filter((s) => s.exp.lat !== undefined && s.exp.lon !== undefined);
  const pool = usable.length >= 6 ? usable : scored; // fall back to any place if geo sparse

  // Meal anchors: best food stops get pulled forward
  const foodTop = pool.filter((s) => s.exp.category === "food").slice(0, req.days * 2);
  const poolSet = new Set(pool);
  const ordered: ScoredPlace[] = [];
  const used = new Set<string>();
  // interleave: alternate score order with food anchors
  const rest = pool.filter((s) => !foodTop.includes(s));
  const foods = [...foodTop];
  while ((rest.length > 0 || foods.length > 0) && ordered.length < req.days * 12) {
    if (ordered.length % 3 === 2 && foods.length > 0) {
      const f = foods.shift();
      if (f && !used.has(f.exp.id)) {
        ordered.push(f);
        used.add(f.exp.id);
        poolSet.delete(f);
      }
    } else {
      const r = rest.shift();
      if (r && !used.has(r.exp.id)) {
        ordered.push(r);
        used.add(r.exp.id);
      }
    }
  }

  // Greedy nearest-neighbor clustering into days
  const dayCapacity = req.hoursPerDay * 60;
  const days: { stops: ScoredPlace[]; load: number; center: { lat: number; lon: number } }[] = [];
  let cur: { stops: ScoredPlace[]; load: number; center: { lat: number; lon: number } } | null = null;
  for (const s of ordered) {
    const exp = s.exp;
    const cost = exp.durationMinutes;
    if (!cur || cur.load + cost > dayCapacity || cur.stops.length >= 6) {
      if (cur) days.push(cur);
      cur = { stops: [], load: 0, center: { lat: exp.lat ?? req.lat ?? 0, lon: exp.lon ?? req.lon ?? 0 } };
    }
    cur.stops.push(s);
    cur.load += cost;
    if (exp.lat !== undefined && exp.lon !== undefined) {
      cur.center = {
        lat: cur.stops.reduce((a, x) => a + (x.exp.lat ?? 0), 0) / cur.stops.length,
        lon: cur.stops.reduce((a, x) => a + (x.exp.lon ?? 0), 0) / cur.stops.length,
      };
    }
  }
  if (cur && cur.stops.length > 0) days.push(cur);
  while (days.length < req.days) days.push({ stops: [], load: 0, center: { lat: req.lat ?? 0, lon: req.lon ?? 0 } });

  // Slots, opening-hours check, legs (OSRM when possible, else Haversine×1.4)
  const tripDays: TripDay[] = [];
  const goldenNotes: string[] = [];
  let feasibilityOk = true;
  let feasibilityMsg = "Plan fits comfortably in your time budget.";
  let totalPlanned = 0;

  for (let d = 0; d < req.days; d++) {
    const day = days[d];
    const stops: ItineraryStop[] = [];
    let clock = 9 * 60; // 09:00 start
    let travelTotal = 0;
    const points: { lat: number; lon: number }[] = [];
    const chosen: ScoredPlace[] = day.stops;
    for (const s of chosen) points.push({ lat: s.exp.lat ?? req.lat ?? 0, lon: s.exp.lon ?? req.lon ?? 0 });
    const legs = await osrmLegs(points);
    for (let i = 0; i < chosen.length; i++) {
      const exp = chosen[i].exp;
      let travelMin = 0;
      let geometry: [number, number][] | undefined;
      if (i > 0) {
        if (legs) {
          travelMin = legs.minutes[i - 1];
          geometry = legs.geometries[i - 1];
        } else {
          travelMin = walkMinutes(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
        }
      }
      travelTotal += travelMin;
      clock += travelMin;
      const open = openNowFromHours(exp.openingHoursRaw, new Date(new Date().setHours(Math.floor(clock / 60) % 24, clock % 60)));
      if (open === false) {
        // slot is outside opening hours → shift by opening delay heuristic
        if (clock < 11 * 60) {
          const shift = 11 * 60 - clock;
          clock += shift;
        } else if (/evening|night|after 8/i.test(exp.bestTime ?? "") && clock < 18 * 60) {
          clock = 18 * 60 + 30;
        }
      }
      const start = clock;
      const end = clock + exp.durationMinutes;
      clock = end + 10; // 10-min buffer between stops
      totalPlanned += exp.durationMinutes + travelMin;
      const startSlot = fmtSlot(start);
      const endSlot = fmtSlot(end);
      const startH = Math.floor(start / 60);

      let timeOfDay = "afternoon";
      if (startH < 12) timeOfDay = "morning";
      else if (startH >= 12 && startH < 15 && exp.category === "food") timeOfDay = "lunch";
      else if (startH >= 12 && startH < 17) timeOfDay = "afternoon";
      else if (startH >= 17 && startH < 19) timeOfDay = "sunset";
      else if (startH >= 19 && exp.category === "food") timeOfDay = "dinner";
      else if (startH >= 19) timeOfDay = "evening";

      stops.push({
        experienceId: exp.id,
        name: exp.name,
        category: exp.category,
        slotStart: startSlot,
        slotEnd: endSlot,
        travelMinFromPrev: travelMin,
        legGeometry: geometry,
        lat: exp.lat,
        lon: exp.lon,
        durationMinutes: exp.durationMinutes,
        pricePerPerson: exp.pricePerPerson,
        imageUrl: exp.imageUrl,
        timeOfDay,
        note: i === 0 ? "Start here" : `${travelMin} min walk from previous`,
      });
    }
    // Lunch anchor near 13:30
    const lunch = stops.find((s) => s.category === "food" && s.slotStart >= "12:30" && s.slotStart <= "15:30");
    if (!lunch && chosen.some((s) => s.exp.category === "food") === false && stops.length > 1) {
      const bestFood = foodTop[d % Math.max(foodTop.length, 1)];
      if (bestFood && bestFood.exp.lat !== undefined) {
        stops.push({
          experienceId: bestFood.exp.id,
          name: `${bestFood.exp.name} (lunch anchor)`,
          category: "food",
          slotStart: "13:30",
          slotEnd: fmtSlot(13 * 60 + 30 + bestFood.exp.durationMinutes),
          travelMinFromPrev: 0,
          lat: bestFood.exp.lat,
          lon: bestFood.exp.lon,
          durationMinutes: bestFood.exp.durationMinutes,
          pricePerPerson: bestFood.exp.pricePerPerson,
          imageUrl: bestFood.exp.imageUrl,
          timeOfDay: "lunch",
          note: "Meal anchor — best food stop near this cluster",
        });
      }
    }
    // Golden hour: schedule outdoor golden stops to end near sunset
    const sunset = req.sunsetMin;
    if (sunset) {
      const golden = stops.filter((s) => /viewpoint|fort|lake|beach|hill|ghat|palace|nature/i.test(s.name) || s.category === "nature");
      if (golden.length > 0) {
        const lastGolden = golden[golden.length - 1];
        const endMin = Number(lastGolden.slotEnd.split(":")[0]) * 60 + Number(lastGolden.slotEnd.split(":")[1]);
        if (endMin <= sunset - 30 && endMin >= sunset - 150) {
          goldenNotes.push(`Day ${d + 1}: ${lastGolden.name} lands right before golden hour (sunset ${fmtSlot(sunset)}).`);
        }
      }
    }
    tripDays.push({
      stops,
      totalHours: Number((stops.reduce((a, s) => a + s.durationMinutes, 0) / 60 + travelTotal / 60).toFixed(1)),
      walkKm: Number((travelTotal * (4.5 / 60)).toFixed(1)),
    });
  }

  if (totalPlanned > req.days * req.hoursPerDay * 60 * 1.05) {
    feasibilityOk = false;
    feasibilityMsg = "Heads up: this plan runs over your time budget — trim a stop or add a day.";
  }

  const budgetTotal = tripDays
    .flatMap((d) => d.stops)
    .reduce((a, s) => a + (s.pricePerPerson ?? 0), 0);

  const voiceSummary = [
    `Here is your ${req.days}-day ${req.vibe ?? "balanced"} plan for ${req.cityLabel.split(",")[0]}.`,
    ...tripDays.map((d, i) => {
      const list = d.stops
        .slice(0, 5)
        .map((s) => `${s.name} at ${s.slotStart}`)
        .join(", then ");
      return `Day ${i + 1}: ${list}${d.stops.length > 5 ? ", and more" : ""}.`;
    }),
    `Estimated spend about ₹${Intl.NumberFormat("en-IN").format(budgetTotal)} for one person.`,
  ].join(" ");

  const id = `trip_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    city: req.city,
    cityLabel: req.cityLabel,
    lat: req.lat,
    lon: req.lon,
    createdAt: new Date().toISOString(),
    days: tripDays,
    voiceSummary,
    feasibility: { ok: feasibilityOk, message: feasibilityMsg },
    budgetTotal,
    budgetPerDay: req.budget ? req.budget * req.days : undefined,
    shareUrl: `/trip/${id}`,
    votes: {},
    goldenHourNotes: goldenNotes,
  };
}
