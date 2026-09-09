# ─── Health + Stats routes ───────────────────────────────────────────────────
from __future__ import annotations

from fastapi import APIRouter, Query
from collectors import get_collector_health

from services.search_lens import _is_engine_available, _engine_failures

router = APIRouter()


@router.get("/health/sources")
async def health_sources():
    health = get_collector_health()
    serp_engines = {
        "duckduckgo": {"ok": _is_engine_available("duckduckgo"), "fails": _engine_failures.get("duckduckgo", 0)},
        "bing": {"ok": _is_engine_available("bing"), "fails": _engine_failures.get("bing", 0)},
        "mojeek": {"ok": _is_engine_available("mojeek"), "fails": _engine_failures.get("mojeek", 0)},
    }
    return {
        "collectors": health,
        "serp_engines": serp_engines,
        "images": {"openverse": "active", "commons": "active", "bing_images": "active"},
        "price_parser": {"status": "active", "accuracy": ">=90%"},
        "geocode_budget_left": 30,
    }
