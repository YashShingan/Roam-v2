-- ─── Roam schema (Turso / libSQL — SQLite-compatible) ───────────────────────
-- Applied automatically by src/lib/db.ts (ensureRemoteSchema) and manually via:
--   turso db shell roam < db/schema.sql
-- Mirrors the local SQLite schema in src/lib/db.ts and backend/db.py.

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
CREATE INDEX IF NOT EXISTS idx_trips_city ON trips(city);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS place_prices (
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
);
CREATE INDEX IF NOT EXISTS idx_place_prices_place_id ON place_prices(place_id);

CREATE TABLE IF NOT EXISTS search_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  city TEXT,
  engine TEXT,
  query TEXT,
  evidence_url TEXT,
  status TEXT,
  reason TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_search_candidates_city ON search_candidates(city);

CREATE TABLE IF NOT EXISTS place_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id TEXT,
  url TEXT,
  thumb_url TEXT,
  license TEXT,
  attribution TEXT,
  source_page TEXT,
  source TEXT,
  captured_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_place_photos_place_id ON place_photos(place_id);
