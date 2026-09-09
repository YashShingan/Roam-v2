# ─── Weather route ───────────────────────────────────────────────────────────
from __future__ import annotations

from fastapi import APIRouter, Query, HTTPException
from weather import get_weather

router = APIRouter()


@router.get("/weather")
async def weather_route(lat: float = Query(...), lon: float = Query(...)):
    try:
        result = await get_weather(lat, lon)
        return result
    except Exception as e:
        raise HTTPException(502, f"Weather unavailable: {e}")
