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
const ENRICH_BATCH = 5;

const running = new Map<string, Promise<CollectState>>();

const stateKey = (city: string): string => `bgcollect:${city.toLowerCase()}`;

export function getCollectState(city: string): CollectState | undefined {
  const s = kvGet<CollectState>(stateKey(city));
  if (s?.status === "running" && Date.now() - s.startedAt > STALE_RUN_MS) return undefined;
  return s;
}

/** A run counts as fresh only if it finished recently AND found something. */
export function isCollectFresh(city: string): boolean {
  const s = getCollectState(city);
  return (
    !!s &&
    s.status === "done" &&
    s.places > 0 &&
    Date.now() - (s.finishedAt ?? s.startedAt) < FRESH_MS
  );
}

/** Idempotent trigger: one scrape per city per process, everyone shares it. */
export function startCollect(city: string, ctx: GeoCtx): Promise<CollectState> {
  const key = city.toLowerCase();
  const existing = running.get(key);
  if (existing) return existing;
  const task = runCollectTask(city, ctx).finally(() => running.delete(key));
  running.set(key, task);
  return task;
}

function countStored(city: string): number {
  return loadPlacesForCity(city, 5000).length;
}

async function runCollectTask(city: string, ctx: GeoCtx): Promise<CollectState> {
  const state: CollectState = {
    status: "running",
    startedAt: Date.now(),
    places: countStored(city),
    added: 0,
    sourcesDone: 0,
    sourcesTotal: SOURCES_TOTAL,
  };
  const save = (): void => {
    try {
      kvSet(stateKey(city), state);
    } catch {
      /* state persistence optional */
    }
  };
  save();
  const beforeIds = new Set(loadPlacesForCity(city, 5000).map((p) => p.id));

  // Streamed from the tiled Overpass sweep: pipeline + persist partial batches
  // so users see places landing while the deep sweep is still running.
  const ingest = (hits: RawHit[]): Experience[] => {
    const places = runPipeline(hits, ctx.label).filter((p) => isVisitablePlace(p.name, ctx.city));
    if (places.length) {
      try {
        upsertPlaces(city, places);
        state.places = countStored(city);
      } catch {
        /* db optional */
      }
    }
    return places;
  };
  ctx.onProgress = (_source, hits) => {
    ingest(hits);
    save();
  };
  ctx.onSourceDone = () => {
    state.sourcesDone++;
    save();
  };

  try {
    const { hits } = await runCollectors(ctx);
    ingest(hits); // final merged pass — richer cross-source rows win by id

    // Address backfill (Task E): bounded, keyless, Photon-first with cache.
    const stored = loadPlacesForCity(city, 5000);
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
              upsertPlaces(city, [p]);
            } catch {
              /* db optional */
            }
          }
        }),
      );
    }

    state.status = "done";
    state.finishedAt = Date.now();
    state.places = countStored(city);
    state.added = loadPlacesForCity(city, 5000).filter((p) => !beforeIds.has(p.id)).length;
  } catch (e) {
    state.status = "error";
    state.finishedAt = Date.now();
    state.error = e instanceof Error ? e.message.slice(0, 200) : "collect failed";
  }
  save();
  try {
    kvSet(`harvest:${city.toLowerCase()}`, {
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
