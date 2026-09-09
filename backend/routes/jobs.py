# ─── Long-job registry (Render free tier kills requests > ~50 s) ────────────
# POST endpoints that can scrape for minutes return 202 {job_id} immediately
# and run as FastAPI background tasks; clients poll GET /api/v1/jobs/{job_id}.
# In-memory only: jobs are ephemeral progress records — their RESULTS live in
# Turso, so a restart loses the progress record, never the data.
from __future__ import annotations

import time
import uuid
from typing import Any, Coroutine

from fastapi import APIRouter, HTTPException

router = APIRouter()

_jobs: dict[str, dict[str, Any]] = {}
_JOBS_TTL_MS = 30 * 60 * 1000
_MAX_TRACKED = 200


def _gc() -> None:
    now = time.time() * 1000
    for jid in [j for j, v in _jobs.items() if now - v["startedAt"] > _JOBS_TTL_MS]:
        _jobs.pop(jid, None)
    while len(_jobs) > _MAX_TRACKED:
        _jobs.pop(next(iter(_jobs)), None)


def create_job(kind: str) -> str:
    _gc()
    job_id = uuid.uuid4().hex[:12]
    _jobs[job_id] = {
        "job_id": job_id,
        "kind": kind,
        "status": "running",
        "startedAt": time.time() * 1000,
        "finishedAt": None,
        "result": None,
        "error": None,
    }
    return job_id


def attach_job_task(job_id: str, coro: Coroutine[Any, Any, Any], background_tasks) -> None:
    """Run the coroutine as a FastAPI background task, recording status."""

    async def _run() -> None:
        job = _jobs.get(job_id)
        try:
            result = await coro
            if job:
                job["status"] = "done"
                job["result"] = result
                job["finishedAt"] = time.time() * 1000
        except Exception as e:  # noqa: BLE001 — a job failure must never crash the worker
            job = _jobs.get(job_id)
            if job:
                job["status"] = "error"
                job["error"] = str(e)[:300]
                job["finishedAt"] = time.time() * 1000

    background_tasks.add_task(_run)


def get_job(job_id: str) -> dict[str, Any]:
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job id")
    return job


@router.get("/v1/jobs/{job_id}")
async def job_status(job_id: str):
    return get_job(job_id)
