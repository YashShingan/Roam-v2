# ─── Lens Orchestrator API route ────────────────────────────────────────────
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services.lens_orchestrator import run_full_lens_pipeline
from routes.jobs import attach_job_task, create_job

router = APIRouter()


class LensRunRequest(BaseModel):
    city: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    radius_km: Optional[float] = 15.0
    # Full lens runs take minutes — default is the 202 job pattern so Render's
    # free-tier request cap can't kill them. wait=true = legacy synchronous.
    wait: Optional[bool] = False


@router.post("/v1/lens/run")
async def run_lens(req: LensRunRequest, background_tasks: BackgroundTasks):
    coro = run_full_lens_pipeline(
        city=req.city,
        lat=req.lat,
        lon=req.lon,
        radius_km=req.radius_km or 15.0,
    )
    if req.wait:
        return await coro
    job_id = create_job("lens")
    attach_job_task(job_id, coro, background_tasks)
    return JSONResponse({"job_id": job_id, "status": "running", "poll": f"/api/v1/jobs/{job_id}"}, status_code=202)
