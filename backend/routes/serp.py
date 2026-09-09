# ─── SERP / Search Lens API routes ───────────────────────────────────────────
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel

from services.search_lens import run_search_lens

router = APIRouter()


class SerpMineRequest(BaseModel):
    city: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    radius_km: Optional[float] = 15.0
    max_geocodes: Optional[int] = 25


@router.post("/v1/serp/mine")
async def mine_serp(req: SerpMineRequest):
    result = await run_search_lens(
        city=req.city,
        lat=req.lat,
        lon=req.lon,
        radius_km=req.radius_km or 15.0,
        max_geocodes=req.max_geocodes or 25,
    )
    return result
