# ─── Turso (libSQL) over HTTP — drop-in async connection ────────────────────
# Implements the tiny slice of the aiosqlite interface backend/db.py actually
# uses (execute → cursor.fetchone/fetchall, commit, close, executescript,
# execute_batch). Speaks Turso HTTP v2 (Hrana-over-HTTP) via httpx — no native
# extension needed on Render's free tier. Zero-env rule: this module is only
# engaged when LIBSQL_URL is set; otherwise db.py keeps using local aiosqlite.
from __future__ import annotations

import base64
import os
import time
from typing import Any, Optional

import httpx

HranaTypes = ("null", "integer", "float", "text", "blob")


def _encode_arg(v: Any) -> dict:
    if v is None:
        return {"type": "null"}
    if isinstance(v, bool):
        return {"type": "integer", "value": 1 if v else 0}
    if isinstance(v, int):
        return {"type": "integer", "value": v}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    if isinstance(v, (bytes, bytearray)):
        return {"type": "blob", "base64": base64.b64encode(bytes(v)).decode("ascii")}
    return {"type": "text", "value": str(v)}


def _decode_cell(cell: dict) -> Any:
    t = cell.get("type")
    if t == "null":
        return None
    if t == "integer":
        return int(cell["value"])
    if t == "float":
        return float(cell["value"])
    if t == "blob":
        return base64.b64decode(cell.get("base64", ""))
    return cell.get("value")


class TursoCursor:
    """Result cursor mirroring the aiosqlite surface db.py relies on."""

    def __init__(self, rows: list[list[Any]]):
        self._rows = rows

    async def fetchone(self) -> Optional[list[Any]]:
        return self._rows[0] if self._rows else None

    async def fetchall(self) -> list[list[Any]]:
        return self._rows


class TursoHttpConnection:
    def __init__(self, url: str, auth_token: Optional[str] = None, timeout_s: float = 20.0):
        self._http_url = url.replace("libsql://", "https://", 1).rstrip("/")
        self._token = auth_token or ""
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_s),
            headers={"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"},
        )
        self.row_factory = None  # parity with aiosqlite attribute; unused here

    async def _pipeline(self, requests: list[dict]) -> list[dict]:
        res = await self._client.post(f"{self._http_url}/v2/pipeline", json={"requests": requests})
        res.raise_for_status()
        payload = res.json()
        results = payload.get("results", [])
        for r in results:
            if r.get("type") == "error":
                raise RuntimeError(f"Turso pipeline error: {r.get('error', {}).get('message', 'unknown')}")
        return results

    async def execute(self, sql: str, params: Any = ()) -> TursoCursor:
        stmt: dict = {"sql": sql}
        if params:
            stmt["args"] = [_encode_arg(p) for p in params]
        results = await self._pipeline([{"type": "execute", "stmt": stmt}])
        result = results[0]["response"].get("result", {}) if results else {}
        rows = [[_decode_cell(c) for c in row] for row in result.get("rows", [])]
        return TursoCursor(rows)

    async def execute_batch(self, statements: list[tuple[str, Any]]) -> None:
        """One HTTP round-trip for many statements (hot write loops)."""
        if not statements:
            return
        requests = [
            {"type": "execute", "stmt": {"sql": sql, "args": [_encode_arg(p) for p in params]}}
            for sql, params in statements
        ]
        await self._pipeline(requests)

    async def executescript(self, script: str) -> None:
        statements = [s.strip() for s in script.split(";") if s.strip() and not s.strip().startswith("--")]
        await self.execute_batch([(s, ()) for s in statements])

    async def commit(self) -> None:
        return None  # every pipeline call is committed server-side

    async def close(self) -> None:
        await self._client.aclose()


# ─── Shared schema (keep in sync with db/schema.sql + src/lib/db.ts) ─────────
SCHEMA_SCRIPT = """
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
"""

# Safe column additions (same as local init — Turso may predate these)
_PLACE_COLUMNS = [
    ("price_mode", "TEXT"),
    ("price_min", "REAL"),
    ("price_max", "REAL"),
    ("price_confidence", "REAL"),
    ("price_sample_count", "INTEGER DEFAULT 0"),
    ("photo_url", "TEXT"),
    ("photo_attribution", "TEXT"),
]


async def connect_turso() -> TursoHttpConnection:
    url = os.environ["LIBSQL_URL"].strip()
    conn = TursoHttpConnection(url, os.environ.get("LIBSQL_AUTH_TOKEN"))
    await conn.executescript(SCHEMA_SCRIPT)
    for col, col_type in _PLACE_COLUMNS:
        try:
            await conn.execute(f"ALTER TABLE places ADD COLUMN {col} {col_type}")
        except Exception:
            pass  # column already exists
    return conn
