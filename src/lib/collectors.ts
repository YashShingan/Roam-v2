// ─── Collector shared types, health tracking, orchestrator ──────────────────
import { kvGet, kvSet } from "./db";
import { hitId, slugify as slug, validCategory, type Collector, type GeoCtx, type HealthEntry, type RawHit } from "./rawhit";

export { hitId, slug, validCategory, type GeoCtx, type HealthEntry, type RawHit, type Collector };

const healthMap = new Map<string, HealthEntry>();
let seeded = false;

let _persistTimer: NodeJS.Timeout | null = null;

export function persistHealth(): void {
  void kvSet("health", [...healthMap.values()]).catch(() => {
    /* non-fatal */
  });
}

export function recordHealth(
  name: string,
  ok: boolean,
  latencyMs: number,
  count: number,
  error?: string,
): void {
  healthMap.set(name, {
    name,
    ok,
    latencyMs: Math.round(latencyMs),
    count,
    error: ok ? undefined : (error ?? "failed"),
    checkedAt: new Date().toISOString(),
  });
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    persistHealth();
  }, 500);
}

export async function getCollectorHealth(): Promise<HealthEntry[]> {
  if (!seeded) {
    seeded = true;
    try {
      const prev = await kvGet<HealthEntry[]>("health");
      if (prev) for (const h of prev) if (!healthMap.has(h.name)) healthMap.set(h.name, h);
    } catch {
      /* non-fatal */
    }
  }
  return [...healthMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function withTimeout(p: Promise<RawHit[]>, ms: number): Promise<RawHit[]> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("collector timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// ─── Collector registry (all 13, run in parallel, fail-soft) ────────────────
import { collectOverpass, collectAmenityProximity } from "./collectors-core";
import {
  collectReddit,
  collectNews,
  collectGMyMaps,
  collectBooks,
  collectEditorial,
  collectYouTube,
} from "./collectors-social";
import {
  collectWikidata,
  collectWikipedia,
  collectWikivoyage,
  collectCommons,
  collectPhotonPoi,
  collectGeoNames,
} from "./collectors-core";

const REGISTRY: { name: string; fn: Collector }[] = [
  { name: "Overpass (OSM)", fn: collectOverpass },
  { name: "Wikidata SPARQL", fn: collectWikidata },
  { name: "Wikipedia geo", fn: collectWikipedia },
  { name: "Wikivoyage", fn: collectWikivoyage },
  { name: "Reddit + PullPush", fn: collectReddit },
  { name: "Google News RSS", fn: collectNews },
  { name: "Wikimedia Commons", fn: collectCommons },
  { name: "Google My Maps KML", fn: collectGMyMaps },
  { name: "Public-domain books", fn: collectBooks },
  { name: "GeoNames dump", fn: collectGeoNames },
  { name: "Editorial deep-links", fn: collectEditorial },
  { name: "Photon POI sweep", fn: collectPhotonPoi },
  { name: "YouTube (Piped/Invidious)", fn: collectYouTube },
];

export interface CollectorResult {
  hits: RawHit[];
  health: HealthEntry[];
}

// Per-collector soft budgets (ms). Nothing may hang forever — but with caps
// removed the tiled Overpass sweep legitimately runs for minutes in the
// background, so it gets a long leash. Everything else stays tight.
const COLLECTOR_TIMEOUT_MS: Record<string, number> = {
  "Overpass (OSM)": 300000,
  "Photon POI sweep": 60000,
  "Wikidata SPARQL": 45000,
  "Wikipedia geo": 45000,
  "Wikimedia Commons": 45000,
  "Reddit + PullPush": 75000,
  "Google My Maps KML": 60000,
  "Public-domain books": 90000,
  "YouTube (Piped/Invidious)": 130000,
};

export async function runCollectors(ctx: GeoCtx): Promise<CollectorResult> {
  const settled = await Promise.allSettled(
    REGISTRY.map(async ({ name, fn }) => {
      const t0 = Date.now();
      try {
        const hits = await withTimeout(fn(ctx), COLLECTOR_TIMEOUT_MS[name] ?? 30000);
        recordHealth(name, true, Date.now() - t0, hits.length);
        ctx.onSourceDone?.(name, true, hits.length);
        return hits;
      } catch (e) {
        recordHealth(
          name,
          false,
          Date.now() - t0,
          0,
          e instanceof Error ? e.message.slice(0, 160) : String(e),
        );
        ctx.onSourceDone?.(name, false, 0);
        return [] as RawHit[];
      }
    }),
  );
  const hits = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  persistHealth();
  return { hits, health: await getCollectorHealth() };
}

export { collectAmenityProximity };
