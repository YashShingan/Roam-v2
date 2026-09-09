# ─── Collect / Harvester route ───────────────────────────────────────────────
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from geocode import geocode_city
from collectors import run_collectors
from pipeline import run_pipeline
from db import upsert_places, kv_set
from models import GeoCtx

router = APIRouter()


class CollectBody(BaseModel):
    city: str
    token: Optional[str] = None


@router.post("/collect")
async def collect_route(body: CollectBody):
    expected = os.getenv("COLLECT_TOKEN")
    if expected and body.token != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")

    geo = await geocode_city(body.city)
    if not geo or geo.get("lat") is None or geo.get("lon") is None:
        raise HTTPException(status_code=404, detail=f"Could not locate {body.city}")

    lat, lon = geo["lat"], geo["lon"]
    ctx = GeoCtx(
        city=geo["city"],
        lat=lat,
        lon=lon,
        radiusKm=15.0,
    )
    result = await run_collectors(ctx)
    hits = result["hits"]
    health = result["health"]
    places = run_pipeline(hits, geo["city"], lat, lon)
    stored = await upsert_places(geo["city"], places)
    await kv_set(f"harvest:{geo['city'].lower()}", {"at": datetime.now(timezone.utc).timestamp() * 1000, "stored": stored})

    return {
        "city": geo["city"],
        "collected": len(places),
        "stored": stored,
        "health": [h.model_dump() if hasattr(h, "model_dump") else h for h in health],
        "harvestedAt": datetime.now(timezone.utc).isoformat(),
    }
