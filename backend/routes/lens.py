# ─── Lens Orchestrator API route ────────────────────────────────────────────
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel

from services.lens_orchestrator import run_full_lens_pipeline

router = APIRouter()


class LensRunRequest(BaseModel):
    city: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    radius_km: Optional[float] = 15.0


@router.post("/v1/lens/run")
async def run_lens(req: LensRunRequest):
    result = await run_full_lens_pipeline(
        city=req.city,
        lat=req.lat,
        lon=req.lon,
        radius_km=req.radius_km or 15.0,
    )
    return result
