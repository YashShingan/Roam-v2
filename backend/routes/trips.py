# ─── Trip routes (plan, load, update, vote) ──────────────────────────────────
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from db import save_trip, get_trip, update_trip, bump_vote
from planner import plan_trip
from routes.places import get_places_for_city
from models import Experience

router = APIRouter()


class PlanRequest(BaseModel):
    city: str
    days: int = 1
    hoursPerDay: float = 8
    interests: Optional[list[str]] = None
    budget: Optional[int] = None
    vibe: Optional[str] = None


class VoteRequest(BaseModel):
    stopName: str
    delta: int = 1


@router.post("/trip/plan")
async def plan_route(req: PlanRequest):
    try:
        # Get places for city
        result = await get_places_for_city(req.city)
        places = [Experience.model_validate(p) for p in result["places"]]

        if not places:
            raise HTTPException(400, f"No places found for {req.city}")

        plan = plan_trip(
            places=places,
            city=req.city,
            city_label=result.get("cityLabel", req.city),
            lat=result["lat"],
            lon=result["lon"],
            days=req.days,
            hours_per_day=req.hoursPerDay,
            interests=req.interests,
            budget=req.budget,
            vibe=req.vibe,
        )

        await save_trip(plan)
        return {"plan": plan.model_dump()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Planning failed: {e}")


@router.get("/trip/{trip_id}")
async def get_trip_route(trip_id: str):
    plan = await get_trip(trip_id)
    if not plan:
        raise HTTPException(404, "Trip not found")
    return {"plan": plan.model_dump()}


@router.put("/trip/{trip_id}")
async def update_trip_route(trip_id: str, plan: dict):
    from models import TripPlan
    try:
        trip = TripPlan.model_validate(plan)
        await update_trip(trip)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/trip/{trip_id}/vote")
async def vote_route(trip_id: str, req: VoteRequest):
    votes = await bump_vote(trip_id, req.stopName, req.delta)
    return {"votes": votes}
