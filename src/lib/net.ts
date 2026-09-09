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
  memCache.set(key, { at: Date.now(), value });
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
