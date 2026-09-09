# ─── Async HTTP helpers, geo math, TTL cache ─────────────────────────────────
from __future__ import annotations

import asyncio
import math
import time
import unicodedata
from typing import Any, Optional

import httpx

UA = "RoamApp/1.0 (open-data discovery; https://github.com/roam)"
_client: Optional[httpx.AsyncClient] = None


async def get_client() -> httpx.AsyncClient:
    """Singleton async HTTP client with connection pooling."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(25.0, connect=10.0),
            headers={"User-Agent": UA},
            follow_redirects=True,
            limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
        )
    return _client


async def close_client() -> None:
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None


class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


async def fetch_json(
    url: str,
    *,
    timeout_ms: int = 20000,
    retries: int = 2,
    headers: Optional[dict[str, str]] = None,
) -> Any:
    """GET JSON with timeout + retries. Raises on non-2xx."""
    client = await get_client()
    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            resp = await client.get(
                url,
                timeout=timeout_ms / 1000,
                headers=headers or {},
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            last_err = e
            if attempt < retries:
                await asyncio.sleep(0.4 * (attempt + 1))
    raise last_err or Exception("fetch_json failed")


async def fetch_text(
    url: str,
    *,
    timeout_ms: int = 20000,
    retries: int = 1,
    headers: Optional[dict[str, str]] = None,
) -> str:
    """GET text with timeout + retries."""
    client = await get_client()
    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            resp = await client.get(
                url,
                timeout=timeout_ms / 1000,
                headers=headers or {},
            )
            resp.raise_for_status()
            return resp.text
        except Exception as e:
            last_err = e
            if attempt < retries:
                await asyncio.sleep(0.4 * (attempt + 1))
    raise last_err or Exception("fetch_text failed")


# ─── Tiny TTL cache (30 min default) ─────────────────────────────────────────
_cache: dict[str, tuple[float, Any]] = {}
TTL_DEFAULT = 30 * 60  # seconds


def cache_get(key: str) -> Any | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    ts, value = entry
    if time.time() - ts > TTL_DEFAULT:
        del _cache[key]
        return None
    return value


def cache_set(key: str, value: Any, ttl: float = TTL_DEFAULT) -> None:
    _cache[key] = (time.time(), value)
    if len(_cache) > 400:
        # evict oldest 100
        items = sorted(_cache.items(), key=lambda x: x[1][0])
        for k, _ in items[:100]:
            del _cache[k]


async def cached(key: str, producer) -> Any:
    hit = cache_get(key)
    if hit is not None:
        return hit
    value = await producer()
    cache_set(key, value)
    return value


# ─── Geo math ─────────────────────────────────────────────────────────────────
def haversine_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    R = 6371
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lon - a_lon)
    s = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat))
        * math.cos(math.radians(b_lat))
        * math.sin(d_lon / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(s))


def bbox_around(lat: float, lon: float, radius_km: float) -> str:
    d_lat = radius_km / 111.32
    d_lon = radius_km / (111.32 * math.cos(math.radians(lat)) or 1)
    return (
        f"{lon - d_lon:.4f},{lat - d_lat:.4f},"
        f"{lon + d_lon:.4f},{lat + d_lat:.4f}"
    )


def parse_bbox(raw: Optional[str]) -> Optional[dict]:
    if not raw:
        return None
    parts = raw.split(",")
    if len(parts) != 4:
        return None
    try:
        w, s, e, n = [float(p) for p in parts]
    except ValueError:
        return None
    if w > e or s > n:
        return None
    return {"w": w, "s": s, "e": e, "n": n}


# ─── Text helpers for dedup ──────────────────────────────────────────────────
def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


STOP_WORDS = {"the", "a", "an", "cafe", "café"}


def dedup_key(name: str) -> str:
    import re
    cleaned = strip_accents(name.lower())
    cleaned = re.sub(r"[^a-z0-9\s]", " ", cleaned)
    words = sorted(w for w in cleaned.split() if w and w not in STOP_WORDS)
    return " ".join(words)


def token_sim(a: str, b: str) -> int:
    ka = dedup_key(a)
    kb = dedup_key(b)
    if not ka or not kb:
        return 0
    if ka == kb:
        return 100
    set_a = set(ka.split())
    set_b = set(kb.split())
    inter = len(set_a & set_b)
    return round(2 * inter * 100 / (len(set_a) + len(set_b)))


def slugify(name: str) -> str:
    import re
    s = strip_accents(name.lower()).strip()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80]


def hit_id(source: str, name: str, lat: Optional[float] = None) -> str:
    import hashlib
    raw = f"{source}:{name}:{lat or 0}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]
