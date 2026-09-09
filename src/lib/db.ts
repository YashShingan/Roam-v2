// ─── Data layer: Turso (libSQL) remote with local-SQLite fallback ───────────
// Zero-env-var rule: with no LIBSQL_URL this module behaves exactly like the
// original local SQLite store. With LIBSQL_URL set (Turso), reads go remote
// first and fall back to local on error/empty; writes go to local always and
// remote best-effort — a Turso outage degrades to the old behavior, never a
// crash. All API is async; every caller must await.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Experience, TripPlan } from "./types";

type LibSqlClient = import("@libsql/client").Client;

const LIBSQL_URL = process.env.LIBSQL_URL?.trim();
const REMOTE = !!LIBSQL_URL;

let _remote: LibSqlClient | null = null;
let _remoteInit: Promise<LibSqlClient | null> | null = null;
let _local: DatabaseSync | null = null;
let _localFailed = false;

export type DataMode = "turso" | "local";
let _mode: DataMode = REMOTE ? "turso" : "local";

/** Current data mode — surfaced on /api/health/sources. */
export function getDataMode(): DataMode {
  return _mode;
}

async function remote(): Promise<LibSqlClient | null> {
  if (!REMOTE) return null;
  if (_remote) return _remote;
  _remoteInit ??= (async () => {
    try {
      const { createClient } = await import("@libsql/client");
      const c = createClient({
        url: LIBSQL_URL!,
        authToken: process.env.LIBSQL_AUTH_TOKEN || undefined,
      });
      await c.execute("SELECT 1");
      await ensureRemoteSchema(c);
      _remote = c;
      _mode = "turso";
      console.log("[db] Turso connected:", LIBSQL_URL);
      return c;
    } catch (e) {
      console.error("[db] Turso init failed — falling back to local SQLite", e);
      _remoteInit = null; // allow retry on next call
      return null;
    }
  })();
  return _remoteInit;
}

// Shared schema — keep in sync with db/schema.sql and backend/db.py.
const SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    city TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_places_city ON places(city)`,
  `CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    city TEXT NOT NULL,
    json TEXT NOT NULL,
    votes TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trips_city ON trips(city)`,
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS place_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT NOT NULL,
    value REAL,
    value_max REAL,
    unit TEXT,
    context TEXT,
    currency TEXT DEFAULT 'INR',
    source TEXT,
    url TEXT,
    confidence REAL,
    captured_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_place_prices_place_id ON place_prices(place_id)`,
  `CREATE TABLE IF NOT EXISTS search_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    city TEXT,
    engine TEXT,
    query TEXT,
    evidence_url TEXT,
    status TEXT,
    reason TEXT,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS place_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT,
    url TEXT,
    thumb_url TEXT,
    license TEXT,
    attribution TEXT,
    source_page TEXT,
    source TEXT,
    captured_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_place_photos_place_id ON place_photos(place_id)`,
];

async function ensureRemoteSchema(c: LibSqlClient): Promise<void> {
  try {
    await c.batch(SCHEMA_DDL.map((sql) => ({ sql, args: [] })), "write");
  } catch (e) {
    console.error("[db] remote schema ensure failed (continuing)", e);
  }
}

async function local(): Promise<DatabaseSync | null> {
  if (_local || _localFailed) return _local;
  try {
    const { DatabaseSync: D } = await import("node:sqlite");
    const dataDir = path.join(process.cwd(), "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const d = new D(path.join(dataDir, "roam.db"));
    try {
      d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 15000; PRAGMA synchronous = NORMAL;");
    } catch {
      /* pragma may fail if already in transaction */
    }
    for (const sql of SCHEMA_DDL) d.exec(sql);
    _local = d;
    if (!REMOTE) _mode = "local";
    return d;
  } catch (e) {
    console.error("[db] local SQLite unavailable (read-only FS?) — DB ops disabled", e);
    _localFailed = true;
    return null;
  }
}

/** Run a statement on both stores. Local first (fast), remote best-effort. */
async function writeLocal(sql: string, args: unknown[]): Promise<void> {
  const d = await local();
  d?.prepare(sql).run(...(args as never[]));
}
async function writeRemote(sql: string, args: unknown[]): Promise<void> {
  const c = await remote();
  if (!c) return;
  try {
    await c.execute({ sql, args: args as never[] });
  } catch (e) {
    console.error("[db] remote write failed (local kept)", e);
  }
}
/**
 * Reads the FIRST selected column (alias it as needed) as strings.
 * Remote (Turso) first when configured; on error/empty falls back to the
 * local SQLite store. Returns null only when both are unavailable.
 */
async function readFirstColumn(sql: string, args: unknown[]): Promise<string[] | null> {
  if (REMOTE) {
    const c = await remote();
    if (c) {
      try {
        const rs = await c.execute({ sql, args: args as never[] });
        return rs.rows.map((r) => String((r as unknown as Record<number, unknown>)[0]));
      } catch (e) {
        console.error("[db] remote read failed — local fallback", e);
      }
    }
  }
  try {
    const d = await local();
    if (!d) return null;
    const rows = d.prepare(sql).all(...(args as never[])) as Record<string, string | number | bigint | null>[];
    return rows.map((r) => String(Object.values(r)[0]));
  } catch {
    return null;
  }
}

// ─── Places ──────────────────────────────────────────────────────────────────
export async function upsertPlaces(city: string, places: Experience[]): Promise<number> {
  const SQL =
    "INSERT INTO places (id, city, name, category, json, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at";
  const d = await local();
  let n = 0;
  const batch: { sql: string; args: unknown[] }[] = [];
  for (const p of places) {
    const args = [p.id, city.toLowerCase(), p.name, p.category, JSON.stringify(p), Date.now()];
    try {
      d?.prepare(SQL).run(...(args as never[]));
      n++;
    } catch {
      /* skip malformed row */
    }
    if (REMOTE) batch.push({ sql: SQL, args });
  }
  if (REMOTE && batch.length) {
    const c = await remote();
    try {
      await c?.batch(batch as never, "write");
    } catch (e) {
      console.error("[db] remote batch upsert failed (local kept)", e);
    }
  }
  return n;
}

export async function loadPlacesForCity(city: string, limit = 5000): Promise<Experience[]> {
  const rows = await readFirstColumn(
    "SELECT json AS v FROM places WHERE city = ? ORDER BY updated_at DESC LIMIT ?",
    [city.toLowerCase(), limit],
  );
  if (!rows) return [];
  return rows
    .map((j) => {
      try {
        return JSON.parse(j) as Experience;
      } catch {
        return null;
      }
    })
    .filter((p): p is Experience => p !== null);
}

// ─── Trips ───────────────────────────────────────────────────────────────────
const TRIP_UPSERT =
  "INSERT INTO trips (id, city, json, votes, created_at) VALUES (?, ?, ?, '{}', ?) " +
  "ON CONFLICT(id) DO UPDATE SET json=excluded.json";

export async function saveTrip(plan: TripPlan): Promise<void> {
  const args = [plan.id, plan.city.toLowerCase(), JSON.stringify(plan), Date.now()];
  await writeLocal(TRIP_UPSERT, args);
  await writeRemote(TRIP_UPSERT, args);
}

export async function getTrip(id: string): Promise<TripPlan | null> {
  const rows = await readFirstColumn("SELECT json AS v FROM trips WHERE id = ?", [id]);
  if (!rows || rows.length === 0) return null;
  try {
    return JSON.parse(rows[0]) as TripPlan;
  } catch {
    return null;
  }
}

export async function updateTrip(plan: TripPlan): Promise<void> {
  const args = [JSON.stringify(plan), plan.id];
  await writeLocal("UPDATE trips SET json = ? WHERE id = ?", args);
  await writeRemote("UPDATE trips SET json = ? WHERE id = ?", args);
}

export async function getVotes(id: string): Promise<Record<string, number>> {
  const rows = await readFirstColumn("SELECT votes AS v FROM trips WHERE id = ?", [id]);
  if (!rows || rows.length === 0) return {};
  try {
    return JSON.parse(rows[0]) as Record<string, number>;
  } catch {
    return {};
  }
}

export async function bumpVote(id: string, stopName: string, delta: number): Promise<Record<string, number>> {
  const votes = await getVotes(id);
  votes[stopName] = (votes[stopName] ?? 0) + delta;
  const args = [JSON.stringify(votes), id];
  await writeLocal("UPDATE trips SET votes = ? WHERE id = ?", args);
  await writeRemote("UPDATE trips SET votes = ? WHERE id = ?", args);
  return votes;
}

// ─── Key/value (collector health snapshots, harvest log, geocode fixes) ──────
export async function kvSet(key: string, value: unknown): Promise<void> {
  const args = [key, JSON.stringify(value), Date.now()];
  const SQL =
    "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at";
  await writeLocal(SQL, args);
  await writeRemote(SQL, args);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const rows = await readFirstColumn("SELECT value AS v FROM kv WHERE key = ?", [key]);
  if (!rows || rows.length === 0) return undefined;
  try {
    return JSON.parse(rows[0]) as T;
  } catch {
    return undefined;
  }
}
