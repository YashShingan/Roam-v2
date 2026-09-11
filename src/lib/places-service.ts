// ─── Places service: RENDER-FIRST, scrape-in-background ────────────────────
// /api/places never blocks on collectors: it returns every place already in
// SQLite instantly (deduped), kicks off the uncapped background scrape when
// data is stale, and reports `pending` so the UI can poll until fresh rows
// land. Callers that need complete data (trip planning) pass awaitCollect.
import { dedupKey, haversineKm, sleep, tokenSim } from "./net";
import { geocodeCity } from "./geocode";
import { kvGet, kvSet, loadPlacesForCity } from "./db";
import { isVisitablePlace } from "./pipeline";
import { getCollectorHealth } from "./collectors";
import { getCollectState, isCollectFresh, startCollect, type CollectState } from "./collect-manager";
import type { Experience, CollectorHealth } from "./types";
import type { GeoCtx } from "./rawhit";

export interface CollectInfo {
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  sourcesDone: number;
  sourcesTotal: number;
  places: number;
  error?: string;
}

export interface PlacesResult {
  city: string;
  cityLabel: string;
  lat: number;
  lon: number;
  radiusKm: number;
  places: Experience[];
  health: CollectorHealth[];
  degraded: boolean;
  cached?: boolean;
  /** True while the background scrape is still discovering places. */
  pending: boolean;
  collecting?: CollectInfo;
}

export interface PlacesOptions {
  radiusKm?: number;
  lat?: number;
  lon?: number;
  cityLabel?: string;
  maxCount?: number;
  /** Block (capped at 90 s) until the background scrape finishes. */
  awaitCollect?: boolean;
}

interface GeoFix {
  label: string;
  city: string;
  lat: number;
  lon: number;
}

// Persisted geocode fixes make the very first served response instant too.
async function resolveGeo(city: string, opts: PlacesOptions): Promise<GeoFix | null> {
  if (opts.lat !== undefined && opts.lon !== undefined && opts.cityLabel) {
    return { label: opts.cityLabel, city, lat: opts.lat, lon: opts.lon };
  }
  const ck = `geofix:${city.toLowerCase()}`;
  const hit = await kvGet<GeoFix>(ck);
  if (hit) return hit;
  const geo = await geocodeCity(city);
  if (!geo) return null;
  const fix: GeoFix = { label: geo.label, city: geo.city, lat: geo.lat, lon: geo.lon };
  await kvSet(ck, fix);
  return fix;
}

// Rows stream into the DB in partial batches, so a place can exist under two
// ids (partial vs final merged cluster). Collapse exact-name duplicates,
// keeping the row with the strongest signal.
function dedupeStored(places: Experience[]): Experience[] {
  const rank = (p: Experience): number =>
    p.sources.length * 10 + (p.lat !== undefined ? 5 : 0) + (p.popularityScore ?? 0) * 10 + (p.description ? 1 : 0);
  const best = new Map<string, Experience>();
  for (const p of places) {
    const k = dedupKey(p.name) || `id:${p.id}`;
    const cur = best.get(k);
    if (!cur || rank(p) > rank(cur)) best.set(k, p);
  }

  // near-dup pass: the same place survives multiple harvests under slightly
  // different names ("Durgadi Fort" / "Durgadi Sea Fort"). Same category,
  // strong token overlap and ≤220 m apart ⇒ one card, the stronger row wins.
  const survivors: Experience[] = [];
  const grid = new Map<string, Experience[]>();
  for (const p of best.values()) {
    if (p.lat === undefined || p.lon === undefined) {
      survivors.push(p);
      continue;
    }
    const gx = Math.round(p.lat / 0.002);
    const gy = Math.round(p.lon / 0.002);
    let mergedInto: Experience | null = null;
    for (let dx = -1; dx <= 1 && !mergedInto; dx++) {
      for (let dy = -1; dy <= 1 && !mergedInto; dy++) {
        const cell = grid.get(`${gx + dx}:${gy + dy}`);
        if (!cell) continue;
        for (const q of cell) {
          if (q.lat === undefined || q.lon === undefined) continue;
          if (q.category !== p.category) continue;
          if (tokenSim(p.name, q.name) >= 70 && haversineKm(p.lat, p.lon, q.lat, q.lon) <= 0.22) {
            mergedInto = q;
            break;
          }
        }
      }
    }
    if (mergedInto && rank(p) > rank(mergedInto)) {
      // the newer row is stronger — replace the survivor in place
      mergedInto.id = p.id;
      mergedInto.name = p.name;
      mergedInto.category = p.category;
      mergedInto.sources = p.sources;
      mergedInto.description = p.description;
      mergedInto.imageUrl = p.imageUrl ?? mergedInto.imageUrl;
      mergedInto.address = p.address ?? mergedInto.address;
      mergedInto.popularityScore = p.popularityScore;
      mergedInto.popularity = p.popularity;
      continue; // keep the updated survivor
    }
    if (mergedInto) continue; // weaker duplicate — drop
    survivors.push(p);
    const cellKey = `${gx}:${gy}`;
    const cell = grid.get(cellKey);
    if (cell) cell.push(p);
    else grid.set(cellKey, [p]);
  }
  return survivors;
}

/** Vercel serverless: read-only FS, frozen background tasks, 60 s cap — the
 * scrape pipeline never runs there by design. Vercel serves Turso rows; live
 * scraping happens on the Render backend or the local harvester. */
const ON_VERCEL = process.env.VERCEL === "1";

export async function getPlacesForCity(cityRaw: string, opts: PlacesOptions = {}): Promise<PlacesResult> {
  const city = cityRaw.trim();
  if (!city) throw new Error("City required");
  const radius = Math.min(Math.max(opts.radiusKm ?? 15, 3), 25);

  const geo = await resolveGeo(city, opts);
  if (!geo) throw new Error(`Could not locate “${city}”. Try a nearby larger city.`);
  const label = `${geo.label.split(",").slice(0, 2).join(", ")}`;
  const ctx: GeoCtx = { city: geo.city, label, lat: geo.lat, lon: geo.lon, radiusKm: radius };
  // Canonical key = geocoded city. The raw input key is loaded too so places
  // harvested under older/looser naming still render.
  const cityKey = geo.city.toLowerCase();

  // Distance fence: only rows within (radius + slack) of the city center
  // are served. Bbox-tile overshoot and geocoder drift otherwise leak
  // neighboring-city venues into the grid (a 126 km temple is not a Kalyan
  // place). Slack absorbs tile edges; no-coord rows stay (already gated by
  // the story-fragment rule).
  const FENCE_KM = radius + 4;
  const inFence = (p: Experience): boolean =>
    p.lat === undefined || p.lon === undefined || haversineKm(geo.lat, geo.lon, p.lat, p.lon) <= FENCE_KM;
  const loadStored = async (): Promise<Experience[]> =>
    dedupeStored(
      [...(await loadPlacesForCity(cityKey, 5000)), ...(await loadPlacesForCity(city.toLowerCase(), 5000))].filter(
        (p) => inFence(p) && isVisitablePlace(p.name, geo.city),
      ),
    );

  // ── render-first: serve stored rows immediately ──────────────────────────
  let stored = await loadStored();

  // ── scrape-in-background: trigger when data is stale (never in the ───────
  // request path; per-city singleton, state visible across processes via kv)
  let collectPromise: Promise<CollectState> | null = null;
  const state = await getCollectState(cityKey);
  if (!ON_VERCEL && !(await isCollectFresh(cityKey)) && state?.status !== "running") {
    collectPromise = startCollect(cityKey, ctx);
  }
  let pending = state?.status === "running" || !!collectPromise;

  if (collectPromise && opts.awaitCollect) {
    await Promise.race([collectPromise, sleep(90_000)]);
    stored = await loadStored();
    pending = (await getCollectState(cityKey))?.status === "running";
  }

  const live = await getCollectState(cityKey);
  const collecting: CollectInfo | undefined =
    pending && live
      ? {
          status: live.status,
          startedAt: live.startedAt,
          finishedAt: live.finishedAt,
          sourcesDone: live.sourcesDone,
          sourcesTotal: live.sourcesTotal,
          places: live.places,
          error: live.error,
        }
      : undefined;

  const health = await getCollectorHealth();
  return {
    city: geo.city,
    cityLabel: label,
    lat: geo.lat,
    lon: geo.lon,
    radiusKm: radius,
    places: opts.maxCount ? stored.slice(0, opts.maxCount) : stored,
    health,
    degraded: health.some((h) => !h.ok),
    cached: !pending,
    pending,
    collecting,
  };
}
