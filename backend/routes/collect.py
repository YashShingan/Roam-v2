# ─── Collect / Harvester route ───────────────────────────────────────────────
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from geocode import geocode_city
from collectors import run_collectors
from pipeline import run_pipeline
from db import upsert_places, kv_set
from models import GeoCtx
from routes.jobs import attach_job_task, create_job

router = APIRouter()


class CollectBody(BaseModel):
    city: str
    token: Optional[str] = None
    # Render free tier kills requests > ~50 s — default is the 202 job pattern.
    # wait=true keeps the old synchronous behavior for local/harvester use.
    wait: Optional[bool] = False


async def _collect_city(city: str) -> dict:
    geo = await geocode_city(city)
    if not geo or geo.get("lat") is None or geo.get("lon") is None:
        return {"error": f"Could not locate {city}"}

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


@router.post("/collect")
async def collect_route(body: CollectBody, background_tasks: BackgroundTasks):
    expected = os.getenv("COLLECT_TOKEN")
    if expected and body.token != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if body.wait:
        result = await _collect_city(body.city)
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        return JSONResponse(result, status_code=200)

    # pre-validate the city so bad requests fail fast, then scrape in background
    geo = await geocode_city(body.city)
    if not geo or geo.get("lat") is None or geo.get("lon") is None:
        raise HTTPException(status_code=404, detail=f"Could not locate {body.city}")

    job_id = create_job("collect")
    attach_job_task(job_id, _collect_city(body.city), background_tasks)
    return JSONResponse({"job_id": job_id, "status": "running", "poll": f"/api/v1/jobs/{job_id}"}, status_code=202)
