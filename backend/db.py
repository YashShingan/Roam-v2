# ─── SQLite store (aiosqlite, zero env vars) ─────────────────────────────────
from __future__ import annotations

import json
import os
import time
from typing import Any, Optional

import aiosqlite

from models import Experience, TripPlan

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DATA_DIR, "roam.db")

_db: Optional[Any] = None  # aiosqlite.Connection OR Turso HTTP connection
_data_mode: str = "local"


def data_mode() -> str:
    """'turso' when LIBSQL_URL is set, else 'local'."""
    return _data_mode


async def get_db() -> Any:
    global _db, _data_mode
    if _db is None:
        # Turso first: every write must reach the shared cloud DB so the
        # Vercel frontend sees backend results. Local disk is never the only
        # copy when LIBSQL_URL is configured.
        if os.getenv("LIBSQL_URL"):
            from turso import connect_turso

            _db = await connect_turso()
            _data_mode = "turso"
            return _db
        _data_mode = "local"
        os.makedirs(DATA_DIR, exist_ok=True)
        _db = await aiosqlite.connect(DB_PATH, timeout=30.0)
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL;")
        await _db.execute("PRAGMA busy_timeout=15000;")
        await _db.execute("PRAGMA synchronous=NORMAL;")
        await _db.executescript("""
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
        """)
        
        # Safe column additions to places table
        cols_to_add = [
            ("price_mode", "TEXT"),
            ("price_min", "REAL"),
            ("price_max", "REAL"),
            ("price_confidence", "REAL"),
            ("price_sample_count", "INTEGER DEFAULT 0"),
            ("photo_url", "TEXT"),
            ("photo_attribution", "TEXT"),
        ]
        for col, col_type in cols_to_add:
            try:
                await _db.execute(f"ALTER TABLE places ADD COLUMN {col} {col_type}")
            except Exception:
                pass  # column already exists

        await _db.commit()
    return _db


async def close_db() -> None:
    global _db
    if _db:
        await _db.close()
        _db = None


# ─── Places ──────────────────────────────────────────────────────────────────
async def upsert_places(city: str, places: list[Experience]) -> int:
    db = await get_db()
    n = 0
    now_ms = int(time.time() * 1000)
    if hasattr(db, "execute_batch"):
        stmts = []
        for p in places:
            stmts.append(
                (
                    """INSERT INTO places (id, city, name, category, json, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at""",
                    (p.id, city.lower(), p.name, p.category.value, p.model_dump_json(), now_ms),
                )
            )
        try:
            await db.execute_batch(stmts)
            n = len(stmts)
        except Exception:
            pass
        return n
    for p in places:
        try:
            await db.execute(
                """INSERT INTO places (id, city, name, category, json, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at""",
                (p.id, city.lower(), p.name, p.category.value, p.model_dump_json(), int(time.time() * 1000)),
            )
            n += 1
        except Exception:
            pass
    await db.commit()
    return n


async def load_places_for_city(city: str, limit: int = 400) -> list[Experience]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT json FROM places WHERE city = ? ORDER BY updated_at DESC LIMIT ?",
        (city.lower(), limit),
    )
    rows = await cursor.fetchall()
    result = []
    for row in rows:
        try:
            result.append(Experience.model_validate_json(row[0]))
        except Exception:
            pass
    return result


# ─── Trips ───────────────────────────────────────────────────────────────────
async def save_trip(plan: TripPlan) -> None:
    db = await get_db()
    await db.execute(
        """INSERT INTO trips (id, city, json, votes, created_at)
           VALUES (?, ?, ?, '{}', ?)
           ON CONFLICT(id) DO UPDATE SET json=excluded.json""",
        (plan.id, plan.city.lower(), plan.model_dump_json(), int(time.time() * 1000)),
    )
    await db.commit()


async def get_trip(trip_id: str) -> Optional[TripPlan]:
    db = await get_db()
    cursor = await db.execute("SELECT json FROM trips WHERE id = ?", (trip_id,))
    row = await cursor.fetchone()
    if not row:
        return None
    try:
        return TripPlan.model_validate_json(row[0])
    except Exception:
        return None


async def update_trip(plan: TripPlan) -> None:
    db = await get_db()
    await db.execute(
        "UPDATE trips SET json = ? WHERE id = ?",
        (plan.model_dump_json(), plan.id),
    )
    await db.commit()


async def get_votes(trip_id: str) -> dict[str, int]:
    db = await get_db()
    cursor = await db.execute("SELECT votes FROM trips WHERE id = ?", (trip_id,))
    row = await cursor.fetchone()
    if not row:
        return {}
    try:
        return json.loads(row[0])
    except Exception:
        return {}


async def bump_vote(trip_id: str, stop_name: str, delta: int) -> dict[str, int]:
    votes = await get_votes(trip_id)
    votes[stop_name] = votes.get(stop_name, 0) + delta
    db = await get_db()
    await db.execute(
        "UPDATE trips SET votes = ? WHERE id = ?",
        (json.dumps(votes), trip_id),
    )
    await db.commit()
    return votes


# ─── Key/value ───────────────────────────────────────────────────────────────
async def kv_set(key: str, value: Any) -> None:
    db = await get_db()
    await db.execute(
        """INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
        (key, json.dumps(value), int(time.time() * 1000)),
    )
    await db.commit()


async def kv_get(key: str) -> Any | None:
    db = await get_db()
    cursor = await db.execute("SELECT value FROM kv WHERE key = ?", (key,))
    row = await cursor.fetchone()
    if not row:
        return None
    try:
        return json.loads(row[0])
    except Exception:
        return None


# ─── Place retrieval & updates ───────────────────────────────────────────────
async def get_place_by_id(place_id: str) -> Optional[Experience]:
    db = await get_db()
    cursor = await db.execute("SELECT json FROM places WHERE id = ?", (place_id,))
    row = await cursor.fetchone()
    if not row:
        return None
    try:
        return Experience.model_validate_json(row[0])
    except Exception:
        return None


async def save_price_samples(place_id: str, samples: list[Any]) -> None:
    if not samples:
        return
    db = await get_db()
    now_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for s in samples:
        val = s.value if hasattr(s, "value") else s.get("value")
        val_max = s.value_max if hasattr(s, "value_max") else s.get("value_max")
        unit = s.unit if hasattr(s, "unit") else s.get("unit", "INR")
        context = s.context if hasattr(s, "context") else s.get("context", "meal")
        source = s.source if hasattr(s, "source") else s.get("source", "web")
        url = s.url if hasattr(s, "url") else s.get("url")
        conf = s.confidence if hasattr(s, "confidence") else s.get("confidence", 0.5)

        await db.execute(
            """INSERT INTO place_prices (place_id, value, value_max, unit, context, currency, source, url, confidence, captured_at)
               VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?)""",
            (place_id, val, val_max, unit, context, source, url, conf, now_str),
        )
    await db.commit()


async def load_price_samples(place_id: str) -> list[dict]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT value, value_max, unit, context, currency, source, url, confidence, captured_at FROM place_prices WHERE place_id = ? ORDER BY id DESC LIMIT 50",
        (place_id,),
    )
    rows = await cursor.fetchall()
    return [
        {
            "value": r[0],
            "value_max": r[1],
            "unit": r[2],
            "context": r[3],
            "currency": r[4],
            "source": r[5],
            "url": r[6],
            "confidence": r[7],
            "date": r[8],
        }
        for r in rows
    ]


async def update_place_price_hint(place_id: str, hint: Optional[Any], sample_count: int = 0) -> None:
    db = await get_db()
    place = await get_place_by_id(place_id)
    if not place:
        return

    place.priceHint = hint
    if hint:
        if hasattr(hint, "per_person") and hint.per_person is not None:
            place.pricePerPerson = int(hint.per_person)
            place.priceIsEstimate = (hint.confidence < 0.7)
        mode = hint.mode if hasattr(hint, "mode") else hint.get("mode")
        p_min = hint.min if hasattr(hint, "min") else hint.get("min")
        p_max = hint.max if hasattr(hint, "max") else hint.get("max")
        conf = hint.confidence if hasattr(hint, "confidence") else hint.get("confidence")
    else:
        place.pricePerPerson = None
        place.priceIsEstimate = None
        mode, p_min, p_max, conf = None, None, None, 0.0

    await db.execute(
        """UPDATE places 
           SET json = ?, price_mode = ?, price_min = ?, price_max = ?, price_confidence = ?, price_sample_count = ?, updated_at = ?
           WHERE id = ?""",
        (place.model_dump_json(), mode, p_min, p_max, conf, sample_count, int(time.time() * 1000), place_id),
    )
    await db.commit()


async def update_place_photo(place_id: str, photo_url: str, photo_attribution: str) -> None:
    db = await get_db()
    place = await get_place_by_id(place_id)
    if not place:
        return
    place.imageUrl = photo_url
    place.photoAttribution = photo_attribution
    await db.execute(
        """UPDATE places 
           SET json = ?, photo_url = ?, photo_attribution = ?, updated_at = ?
           WHERE id = ?""",
        (place.model_dump_json(), photo_url, photo_attribution, int(time.time() * 1000), place_id),
    )
    await db.commit()


async def save_search_candidate(
    name: str, city: str, engine: str, query: str, evidence_url: str, status: str, reason: str = ""
) -> None:
    db = await get_db()
    now_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    await db.execute(
        """INSERT INTO search_candidates (name, city, engine, query, evidence_url, status, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (name, city.lower(), engine, query, evidence_url, status, reason, now_str),
    )
    await db.commit()


async def save_place_photo(
    place_id: str, url: str, thumb_url: str, license: str, attribution: str, source_page: str, source: str
) -> None:
    db = await get_db()
    now_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    await db.execute(
        """INSERT INTO place_photos (place_id, url, thumb_url, license, attribution, source_page, source, captured_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (place_id, url, thumb_url, license, attribution, source_page, source, now_str),
    )
    await db.commit()

