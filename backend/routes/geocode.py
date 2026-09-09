# ─── Geocode routes ──────────────────────────────────────────────────────────
from __future__ import annotations

from fastapi import APIRouter, Query
from geocode import geocode_city, photon_autocomplete

router = APIRouter()


@router.get("/geocode")
async def geocode_route(q: str = Query(...)):
    result = await geocode_city(q)
    if not result:
        return {"error": "City not found", "lat": None, "lon": None}
    return result


@router.get("/city-suggest")
async def city_suggest(q: str = Query(...)):
    suggestions = await photon_autocomplete(q, limit=6)
    return {"suggestions": suggestions}
