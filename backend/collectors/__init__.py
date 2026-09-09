# ─── Collector registry + orchestrator ────────────────────────────────────────
from __future__ import annotations

import asyncio
import time
from typing import Any

from models import CollectorHealth, GeoCtx, RawHit
from db import kv_set, kv_get

_health_map: dict[str, dict] = {}
_seeded = False


def record_health(
    name: str, ok: bool, latency_ms: int, count: int, error: str | None = None
) -> None:
    _health_map[name] = {
        "name": name,
        "ok": ok,
        "latencyMs": latency_ms,
        "count": count,
        "error": None if ok else (error or "failed"),
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


async def persist_health() -> None:
    try:
        await kv_set("health", list(_health_map.values()))
    except Exception:
        pass


def get_collector_health() -> list[dict]:
    global _seeded
    if not _seeded:
        _seeded = True
        # Will seed from DB on first call via the route
    return sorted(_health_map.values(), key=lambda h: h["name"])


async def seed_health_from_db() -> None:
    global _seeded
    prev = await kv_get("health")
    if prev and isinstance(prev, list):
        for h in prev:
            if h.get("name") and h["name"] not in _health_map:
                _health_map[h["name"]] = h
    _seeded = True


# ─── Import all collectors ───────────────────────────────────────────────────
from collectors.overpass import collect_overpass
from collectors.wikidata import collect_wikidata
from collectors.wikipedia import collect_wikipedia
from collectors.wikivoyage import collect_wikivoyage
from collectors.reddit import collect_reddit
from collectors.news import collect_news
from collectors.commons import collect_commons
from collectors.gmymaps import collect_gmymaps
from collectors.books import collect_books
from collectors.geonames import collect_geonames
from collectors.editorial import collect_editorial
from collectors.photon import collect_photon
from collectors.youtube import collect_youtube

REGISTRY: list[tuple[str, Any]] = [
    ("Overpass (OSM)", collect_overpass),
    ("Wikidata SPARQL", collect_wikidata),
    ("Wikipedia geo", collect_wikipedia),
    ("Wikivoyage", collect_wikivoyage),
    ("Reddit + PullPush", collect_reddit),
    ("Google News RSS", collect_news),
    ("Wikimedia Commons", collect_commons),
    ("Google My Maps KML", collect_gmymaps),
    ("Public-domain books", collect_books),
    ("GeoNames dump", collect_geonames),
    ("Editorial deep-links", collect_editorial),
    ("Photon POI sweep", collect_photon),
    ("YouTube (Piped/Invidious)", collect_youtube),
]


async def _run_one(name: str, fn, ctx: GeoCtx) -> list[dict]:
    t0 = time.time()
    try:
        hits = await asyncio.wait_for(fn(ctx), timeout=26.0)
        latency = int((time.time() - t0) * 1000)
        record_health(name, True, latency, len(hits))
        return hits
    except Exception as e:
        latency = int((time.time() - t0) * 1000)
        record_health(name, False, latency, 0, str(e)[:160])
        return []


async def run_collectors(ctx: GeoCtx) -> dict:
    """Run all 13 collectors in parallel, fail-soft."""
    tasks = [_run_one(name, fn, ctx) for name, fn in REGISTRY]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_hits: list[dict] = []
    for r in results:
        if isinstance(r, list):
            all_hits.extend(r)
        # exceptions are already handled in _run_one

    await persist_health()
    return {"hits": all_hits, "health": get_collector_health()}
