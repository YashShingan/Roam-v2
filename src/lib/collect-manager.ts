// ─── Background collection manager ──────────────────────────────────────────
// Serve-first architecture: /api/places returns whatever is already in SQLite
// immediately, while THIS module keeps scraping in the background — streaming
// partial results into the DB as sources finish. State survives process
// restarts via the kv store (a "running" state older than STALE_RUN_MS is
// treated as dead and superseded).
import { runCollectors } from "./collectors";
import { runPipeline, isVisitablePlace } from "./pipeline";
import { loadPlacesForCity, upsertPlaces, kvGet, kvSet } from "./db";
import { reverseGeocode } from "./geocode";
import { commonsPlacePhoto, openversePlacePhoto, wikipediaPlacePhoto } from "./collectors-core";
import { sleep } from "./net";
import type { GeoCtx, RawHit } from "./rawhit";
import type { Experience } from "./types";

export interface CollectState {
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  places: number; // rows in the DB for this city right now
  added: number; // net-new rows vs before this run
  sourcesDone: number;
  sourcesTotal: number;
  error?: string;
}

const SOURCES_TOTAL = 13;
const STALE_RUN_MS = 15 * 60 * 1000; // a "running" state older than this = dead process
const FRESH_MS = 6 * 60 * 60 * 1000; // auto re-scrape window after a good run
const ADDRESS_BACKFILL = 150; // reverse-geocode budget per run (keyless, cached)
const PHOTO_BACKFILL = 120; // Commons geosearch budget per run (1-2 calls/place)
const OPENVERSE_BUDGET = 20; // third chance — anonymous tier is 20 req/min, 200/day
const OPENVERSE_PACE_MS = 3200; // stay under the per-minute ceiling
const ENRICH_BATCH = 5;
const PHOTO_BATCH = 4;

const running = new Map<string, Promise<CollectState>>();

const stateKey = (city: string): string => `bgcollect:${city.toLowerCase()}`;

export async function getCollectState(city: string): Promise<CollectState | undefined> {
  const s = await kvGet<CollectState>(stateKey(city));
  if (s?.status === "running" && Date.now() - s.startedAt > STALE_RUN_MS) return undefined;
  return s;
}

/** A run counts as fresh only if it finished recently AND found something. */
export async function isCollectFresh(city: string): Promise<boolean> {
  const s = await getCollectState(city);
  return (
    !!s &&
    s.status === "done" &&
    s.places > 0 &&
    Date.now() - (s.finishedAt ?? s.startedAt) < FRESH_MS
  );
}

/** Idempotent trigger: one scrape per city per process, everyone shares it. */
export function startCollect(city: string, ctx: GeoCtx): Promise<CollectState> {
  if (process.env.VERCEL === "1") {
    // defense-in-depth: serverless functions freeze background work when the
    // response is sent — a scrape started here would only burn the 60 s cap.
    return Promise.resolve({
      status: "error",
      startedAt: Date.now(),
      finishedAt: Date.now(),
      places: 0,
      added: 0,
      sourcesDone: 0,
      sourcesTotal: SOURCES_TOTAL,
      error: "scraping is disabled on Vercel — use the Render backend or the local harvester",
    });
  }
  const key = city.toLowerCase();
  const existing = running.get(key);
  if (existing) return existing;
  const task = runCollectTask(city, ctx).finally(() => running.delete(key));
  running.set(key, task);
  return task;
}

async function countStored(city: string): Promise<number> {
  return (await loadPlacesForCity(city, 5000)).length;
}

async function runCollectTask(city: string, ctx: GeoCtx): Promise<CollectState> {
  const state: CollectState = {
    status: "running",
    startedAt: Date.now(),
    places: await countStored(city),
    added: 0,
    sourcesDone: 0,
    sourcesTotal: SOURCES_TOTAL,
  };
  const save = async (): Promise<void> => {
    try {
      await kvSet(stateKey(city), state);
    } catch {
      /* state persistence optional */
    }
  };
  await save();
  const beforeIds = new Set((await loadPlacesForCity(city, 5000)).map((p) => p.id));

  // Streamed from the tiled Overpass sweep: pipeline + persist partial batches
  // so users see places landing while the deep sweep is still running.
  const ingest = async (hits: RawHit[]): Promise<Experience[]> => {
    const places = runPipeline(hits, ctx.label).filter((p) => isVisitablePlace(p.name, ctx.city));
    if (places.length) {
      try {
        await upsertPlaces(city, places);
        state.places = await countStored(city);
      } catch {
        /* db optional */
      }
    }
    return places;
  };
  ctx.onProgress = (_source, hits) => {
    void ingest(hits).then(() => save());
  };
  ctx.onSourceDone = () => {
    state.sourcesDone++;
    void save();
  };

  try {
    const { hits } = await runCollectors(ctx);
    await ingest(hits); // final merged pass — richer cross-source rows win by id

    // Address backfill (Task E): bounded, keyless, Photon-first with cache.
    const stored = await loadPlacesForCity(city, 5000);
    const needAddr = stored
      .filter(
        (p) =>
          (!p.address || p.address === "Not listed") &&
          p.lat !== undefined &&
          p.lon !== undefined,
      )
      .slice(0, ADDRESS_BACKFILL);
    for (let i = 0; i < needAddr.length; i += ENRICH_BATCH) {
      await Promise.allSettled(
        needAddr.slice(i, i + ENRICH_BATCH).map(async (p) => {
          const addr = await reverseGeocode(p.lat as number, p.lon as number);
          if (addr) {
            p.address = addr;
            try {
              await upsertPlaces(city, [p]);
            } catch {
              /* db optional */
            }
          }
        }),
      );
    }

    // Photo backfill: real location imagery for rows still without one.
    // Wikipedia lead images arrive via the collectors; this pass covers the
    // rest through Commons geosearch at the place's own coordinates.
    const needPhoto = stored
      .filter((p) => !p.imageUrl && p.lat !== undefined && p.lon !== undefined)
      .sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0))
      .slice(0, PHOTO_BACKFILL);
    for (let i = 0; i < needPhoto.length; i += PHOTO_BATCH) {
      await Promise.allSettled(
        needPhoto.slice(i, i + PHOTO_BATCH).map(async (p) => {
          // geographic first (titled Commons photo near the pin), then the
          // place's Wikipedia article lead image
          const url =
            (await commonsPlacePhoto(p.lat as number, p.lon as number, p.name, ctx.city)) ??
            (await wikipediaPlacePhoto(p.name, ctx.city, p.lat, p.lon));
          if (url) {
            p.imageUrl = url;
            try {
              await upsertPlaces(city, [p]);
            } catch {
              /* db optional */
            }
          }
        }),
      );
    }

    // third chance: Openverse for rows that Commons and Wikipedia couldn't
    // cover — sequential + paced to respect the anonymous rate ceiling
    const stillNoPhoto = [...stored]
      .filter((p) => !p.imageUrl && p.lat !== undefined && p.lon !== undefined)
      .sort((a, b) => (b.popularityScore ?? 0) - (a.popularityScore ?? 0))
      .slice(0, OPENVERSE_BUDGET);
    for (let i = 0; i < stillNoPhoto.length; i++) {
      const p = stillNoPhoto[i];
      const url = await openversePlacePhoto(p.name, ctx.city);
      if (url) {
        p.imageUrl = url;
        try {
          await upsertPlaces(city, [p]);
        } catch {
          /* db optional */
        }
      }
      if (i < stillNoPhoto.length - 1) await sleep(OPENVERSE_PACE_MS);
    }

    state.status = "done";
    state.finishedAt = Date.now();
    state.places = await countStored(city);
    state.added = (await loadPlacesForCity(city, 5000)).filter((p) => !beforeIds.has(p.id)).length;
  } catch (e) {
    state.status = "error";
    state.finishedAt = Date.now();
    state.error = e instanceof Error ? e.message.slice(0, 200) : "collect failed";
  }
  await save();
  try {
    await kvSet(`harvest:${city.toLowerCase()}`, {
      at: Date.now(),
      stored: state.places,
      added: state.added,
      status: state.status,
    });
  } catch {
    /* log optional */
  }
  return state;
}
