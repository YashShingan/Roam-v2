// ─── SQLite store (node:sqlite, zero deps, zero env vars) ───────────────────
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { Experience, TripPlan } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(path.join(DATA_DIR, "roam.db"));
  try {
    _db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 15000;
      PRAGMA synchronous = NORMAL;
    `);
  } catch {
    /* pragma may fail if already in transaction or open */
  }
  _db.exec(`
    CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY,
      city TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_places_city ON places(city);
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      city TEXT NOT NULL,
      json TEXT NOT NULL,
      votes TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return _db;
}

// ─── Places (nightly harvester + /api/collect ingest) ────────────────────────
export function upsertPlaces(city: string, places: Experience[]): number {
  const d = db();
  const stmt = d.prepare(
    `INSERT INTO places (id, city, name, category, json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`,
  );
  let n = 0;
  for (const p of places) {
    try {
      stmt.run(p.id, city.toLowerCase(), p.name, p.category, JSON.stringify(p), Date.now());
      n++;
    } catch {
      /* skip malformed row */
    }
  }
  return n;
}

export function loadPlacesForCity(city: string, limit = 5000): Experience[] {
  try {
    const rows = db()
      .prepare(
        `SELECT json FROM places WHERE city = ? ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(city.toLowerCase(), limit) as { json: string }[];
    return rows
      .map((r) => {
        try {
          return JSON.parse(r.json) as Experience;
        } catch {
          return null;
        }
      })
      .filter((p): p is Experience => p !== null);
  } catch {
    return [];
  }
}

// ─── Trips ───────────────────────────────────────────────────────────────────
export function saveTrip(plan: TripPlan): void {
  db()
    .prepare(
      `INSERT INTO trips (id, city, json, votes, created_at) VALUES (?, ?, ?, '{}', ?)
       ON CONFLICT(id) DO UPDATE SET json=excluded.json`,
    )
    .run(plan.id, plan.city.toLowerCase(), JSON.stringify(plan), Date.now());
}

export function getTrip(id: string): TripPlan | null {
  try {
    const row = db().prepare(`SELECT json FROM trips WHERE id = ?`).get(id) as
      | { json: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(row.json) as TripPlan;
  } catch {
    return null;
  }
}

export function updateTrip(plan: TripPlan): void {
  db()
    .prepare(`UPDATE trips SET json = ? WHERE id = ?`)
    .run(JSON.stringify(plan), plan.id);
}

export function getVotes(id: string): Record<string, number> {
  try {
    const row = db().prepare(`SELECT votes FROM trips WHERE id = ?`).get(id) as
      | { votes: string }
      | undefined;
    return row ? (JSON.parse(row.votes) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function bumpVote(id: string, stopName: string, delta: number): Record<string, number> {
  const votes = getVotes(id);
  votes[stopName] = (votes[stopName] ?? 0) + delta;
  db().prepare(`UPDATE trips SET votes = ? WHERE id = ?`).run(JSON.stringify(votes), id);
  return votes;
}

// ─── Key/value (collector health snapshots, harvest log) ─────────────────────
export function kvSet(key: string, value: unknown): void {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      db()
        .prepare(
          `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        )
        .run(key, JSON.stringify(value), Date.now());
      return;
    } catch {
      if (attempt === 2) break;
    }
  }
}

export function kvGet<T>(key: string): T | undefined {
  try {
    const row = db().prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  } catch {
    return undefined;
  }
}
