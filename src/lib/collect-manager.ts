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
