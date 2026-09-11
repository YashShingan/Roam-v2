// ─── HTTP + geo helpers: timeouts, retries, mirror rotation, caching ────────
export const UA = "RoamApp/1.0 (open-data discovery; https://github.com/roam)";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function fetchWithTimeout(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 9000, ...rest } = opts;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: ctrl.signal,
      headers: { "User-Agent": UA, ...(rest.headers ?? {}) },
      cache: "no-store",
    });
  } finally {
    clearTimeout(t);
  }
}

/** GET JSON with timeout + retries. Throws on non-2xx. */
export async function getJson<T>(
  url: string,
  opts: { timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const { timeoutMs = 9000, retries = 1, headers } = opts;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url, { timeoutMs, headers });
      if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} for ${url.slice(0, 120)}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(250 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** GET text with timeout + retries. */
export async function getText(
  url: string,
  opts: { timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {},
): Promise<string> {
  const { timeoutMs = 9000, retries = 0, headers } = opts;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url, { timeoutMs, headers });
      if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(250 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Tiny TTL cache (30 min default) shared across requests in this process ──
type Entry = { at: number; value: unknown };
const memCache = new Map<string, Entry>();
const TTL_DEFAULT = 30 * 60 * 1000;

export function cacheGet<T>(key: string): T | undefined {
  const e = memCache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > TTL_DEFAULT) {
    memCache.delete(key);
    return undefined;
  }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs = TTL_DEFAULT): void {
  memCache.set(key, { at: Date.now() + (ttlMs - TTL_DEFAULT), value });
  if (memCache.size > 400) {
    const oldest = [...memCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [k] of oldest) memCache.delete(k);
  }
}

/** Memoize an async producer behind the TTL cache. */
export async function cached<T>(key: string, producer: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await producer();
  cacheSet(key, value);
  return value;
}

// ─── Geo math ────────────────────────────────────────────────────────────────
export function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bboxAround(lat: number, lon: number, radiusKm: number): string {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180) || 1);
  return `${(lon - dLon).toFixed(4)},${(lat - dLat).toFixed(4)},${(lon + dLon).toFixed(4)},${(
    lat + dLat
  ).toFixed(4)}`;
}

// ─── Text helpers for dedup ──────────────────────────────────────────────────
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const STOP_WORDS = new Set(["the", "a", "an", "cafe", "café", "the"]);

export function dedupKey(name: string): string {
  return stripAccents(name.toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .sort()
    .join(" ")
    .trim();
}

// ─── Bare-geo fragment detector (shared by pipeline + text miners) ──────────
// A row named exactly one of these is a mined GEOGRAPHY fragment, never a
// venue. Possessives are handled too: "India's" → "India" → fragment, but
// "Nando's" → "Nando" → not a geo name → kept, and "Gateway of India" is
// never an exact match in the first place.
const BARE_GEO_NAMES = new Set([
  ...(
    "india bharat hindustan asia europe africa america deccan konkan malabar coromandel " +
    "maharashtra karnataka goa kerala rajasthan gujarat punjab haryana odisha orissa " +
    "bihar assam jharkhand chhattisgarh uttarakhand telangana andhra himachal " +
    "mumbai pune kalyan dombivli thane nashik nagpur aurangabad solapur " +
    "delhi bengaluru bangalore chennai kolkata hyderabad jaipur " +
    "varanasi kochi cochin udaipur mysuru mysore indore bhopal surat " +
    "kanpur lucknow patna amritsar ludhiana bhubaneswar coimbatore " +
    "noida gurgaon gurugram faridabad ghaziabad vadodara rajkot"
  ).split(" "),
  // multi-word phrases — split(" ") would shred these into single words
  "new delhi", "west asia", "east asia", "south asia", "southeast asia", "central asia",
  "middle east", "far east", "north india", "south india", "east india", "west india",
  "central india", "northeastern india", "western ghats", "eastern ghats",
  "uttar pradesh", "madhya pradesh", "tamil nadu", "west bengal",
  ..."south africa russia china japan nepal sri lanka bangladesh pakistan thailand singapore malaysia indonesia dubai london paris tokyo sydney".split(" "),
  "south africa", "sri lanka", "united states", "united kingdom", "south korea", "new zealand", "hong kong", "abu dhabi",
  "cafe", "shop", "hotel", "city of", "town of", "park", "church", "temple", "restaurant", "bar", "store", "market", "garden", "museum", "art gallery", "navi mumbai",
]);

/** Strip a trailing possessive ('s) — "India's" → "India". */
export function stripPossessive(name: string): string {
  return name
    .replace(/[\u2019']s$/i, "")
    .trim();
}

/** True when the name is a bare geography fragment (never a venue). */
export function isBareGeoFragment(name: string): boolean {
  const n = stripPossessive(name)
    .replace(/^[\u2018\u2019\u201C\u201D'"\s]+/, "")
    .replace(/[\u2018\u2019\u201C\u201D'"\s]+$/, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return n.length === 0 || BARE_GEO_NAMES.has(n);
}

// ─── Photo-title relevance (shared by collectors + pipeline) ────────────────
// words so common in venue/file names that matching them proves nothing
const GENERIC_TOKENS = new Set(
  ("restaurant hotel bar cafe coffee shop store market mall mandir temple church mosque dargah " +
    "gurudwara school college hospital bank nagar marg road street chowk park garden building " +
    "complex apartment apartments tower towers residency heights plaza centre center hall lodge " +
    "resort pure veg family food stall ice cream new old view view-point point gate lake hill " +
    "beach fort palace museum city town district station junction sectors sector phase").split(" "),
);

/** Count of place-name tokens (excluding generic words AND the city's own
 * name) found in a candidate photo/article title. Zero → no evidence the
 * image is OF this place. */
export function meaningfulOverlap(
  placeName: string,
  candidateTitle: string,
  city?: string,
): number {
  const cityTokens = new Set(
    (city ?? "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean),
  );
  const stem = (w: string): string => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  const a = dedupKey(placeName)
    .split(" ")
    .map(stem)
    .filter((w) => w.length > 2 && !GENERIC_TOKENS.has(w) && !cityTokens.has(w));
  if (a.length === 0) return 0;
  const b = new Set(dedupKey(candidateTitle).split(" ").map(stem));
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}
export function tokenSim(a: string, b: string): number {
  const ka = dedupKey(a);
  const kb = dedupKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 100;
  const A = new Set(ka.split(" "));
  const B = new Set(kb.split(" "));
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return Math.round((2 * inter * 100) / (A.size + B.size));
}

/** Normalize any bbox string "w,s,e,n" → {w,s,e,n} numbers, or null. */
export function parseBbox(raw?: string | null): { w: number; s: number; e: number; n: number } | null {
  if (!raw) return null;
  const p = raw.split(",").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = p;
  if (w > e || s > n) return null;
  return { w, s, e, n };
}
