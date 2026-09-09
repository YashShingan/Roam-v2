# ─── Deterministic trip planner ───────────────────────────────────────────────
from __future__ import annotations

import hashlib
import time
from typing import Optional

from models import Experience, TripPlan, TripDay, ItineraryStop, Feasibility
from net import haversine_km


def score_experience(exp: Experience, interests: list[str] | None, center_lat: float, center_lon: float) -> float:
    """Score: 0.35·popularity + 0.25·sentiment + 0.2·hiddenGem + 0.1·categoryFit + 0.1·(1−distanceNorm)."""
    pop = exp.popularityScore * 0.35
    sent = max(0, (exp.community.sentiment + 1) / 2) * 0.25
    gem = 0.2 if exp.community.hiddenGem else 0
    cat_fit = 0.1 if interests and exp.category.value in interests else 0.05
    dist = 0
    if exp.lat and exp.lon:
        d = haversine_km(center_lat, center_lon, exp.lat, exp.lon)
        dist = max(0, 1 - d / 20) * 0.1
    return pop + sent + gem + cat_fit + dist


def fmt_time(minutes: int) -> str:
    minutes = minutes % 1440
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def travel_time_min(a: Experience, b: Experience) -> int:
    """Estimate walking time: Haversine × 1.4 ÷ 4.5 km/h."""
    if not a.lat or not b.lat or not a.lon or not b.lon:
        return 15  # default
    d = haversine_km(a.lat, a.lon, b.lat, b.lon) * 1.4
    return max(5, round(d / 4.5 * 60))


def plan_trip(
    places: list[Experience],
    city: str,
    city_label: str,
    lat: float,
    lon: float,
    days: int = 1,
    hours_per_day: float = 8,
    interests: list[str] | None = None,
    budget: int | None = None,
    vibe: str | None = None,
) -> TripPlan:
    """Deterministic + explainable trip planner."""

    # Score and rank
    scored = sorted(
        places,
        key=lambda p: score_experience(p, interests, lat, lon),
        reverse=True,
    )

    # Budget filter
    if budget:
        scored = [p for p in scored if (p.pricePerPerson or 0) <= budget]

    # Vibe filter
    if vibe == "foodie":
        food_places = [p for p in scored if p.category.value == "food"]
        others = [p for p in scored if p.category.value != "food"]
        scored = food_places + others
    elif vibe == "heritage":
        culture_places = [p for p in scored if p.category.value == "culture"]
        others = [p for p in scored if p.category.value != "culture"]
        scored = culture_places + others

    # Build days
    budget_minutes = int(hours_per_day * 60)
    trip_days: list[TripDay] = []
    used = set()
    total_budget = 0

    for day_idx in range(days):
        stops: list[ItineraryStop] = []
        day_minutes = 0
        current_time = 9 * 60  # Start 9:00 AM
        last_place: Experience | None = None
        day_walk_km = 0.0

        # Meal anchoring times
        meal_times = [9 * 60, 13 * 60 + 30, 20 * 60]  # 9:00, 13:30, 20:00
        food_placed = set()

        for place in scored:
            if place.id in used:
                continue
            if day_minutes >= budget_minutes:
                break

            # Calculate travel time
            travel = travel_time_min(last_place, place) if last_place else 0
            total_needed = travel + place.durationMinutes

            if day_minutes + total_needed > budget_minutes + 30:
                continue

            # Meal anchoring: prefer food places near meal times
            is_food = place.category.value == "food"
            near_meal = any(
                abs(current_time - mt) < 60 and mt not in food_placed
                for mt in meal_times
            )
            if is_food and not near_meal and len(stops) > 0:
                # Skip food if not near a meal slot (unless we're short on options)
                if len([p for p in scored if p.id not in used and p.category.value != "food"]) > 3:
                    continue

            current_time += travel
            slot_start = fmt_time(current_time)
            current_time += place.durationMinutes
            slot_end = fmt_time(current_time)

            if is_food:
                for mt in meal_times:
                    if abs(int(slot_start.split(":")[0]) * 60 + int(slot_start.split(":")[1]) - mt) < 60:
                        food_placed.add(mt)

            if last_place and place.lat and last_place.lat:
                day_walk_km += haversine_km(last_place.lat, last_place.lon or 0, place.lat, place.lon or 0)

            # Price basis calculation
            price_basis = "Varies — no reliable signal"
            price_min = None
            price_max = None
            price_quote = None
            if place.priceHint:
                mode = place.priceHint.mode
                price_min = place.priceHint.min
                price_max = place.priceHint.max
                if mode == "entry":
                    price_basis = f"entry ₹{int(price_min)}" if price_min == price_max else f"entry ₹{int(price_min)}–{int(price_max)}"
                elif mode == "meal":
                    price_basis = f"meal ~₹{int(place.priceHint.per_person or price_min)} pp"
                elif mode == "item":
                    price_basis = f"item ~₹{int(price_min)}"
                else:
                    price_basis = f"~₹{int(place.priceHint.per_person or price_min)}"
                if place.priceHint.samples:
                    price_quote = place.priceHint.samples[0].raw_snippet
            elif place.pricePerPerson:
                price_basis = f"est. ₹{place.pricePerPerson}"
                price_min = float(place.pricePerPerson)
                price_max = float(place.pricePerPerson)

            stops.append(ItineraryStop(
                experienceId=place.id,
                name=place.name,
                category=place.category,
                slotStart=slot_start,
                slotEnd=slot_end,
                travelMinFromPrev=travel,
                lat=place.lat,
                lon=place.lon,
                durationMinutes=place.durationMinutes,
                pricePerPerson=place.pricePerPerson,
                priceBasis=price_basis,
                priceMin=price_min,
                priceMax=price_max,
                priceQuote=price_quote,
            ))

            day_minutes += total_needed
            total_budget += place.pricePerPerson or 0
            used.add(place.id)
            last_place = place

        total_hours = round(day_minutes / 60, 1)
        trip_days.append(TripDay(
            stops=stops,
            totalHours=total_hours,
            walkKm=round(day_walk_km, 1),
        ))

    # Calculate budget band
    all_stops = [s for d in trip_days for s in d.stops]
    priced_stops = [s for s in all_stops if s.priceMin is not None]
    min_sum = int(sum(s.priceMin for s in priced_stops)) if priced_stops else 0
    max_sum = int(sum(s.priceMax if s.priceMax is not None else s.priceMin for s in priced_stops)) if priced_stops else 0
    priced_count = len(priced_stops)
    total_stops = len(all_stops)
    unpriced_count = total_stops - priced_count

    if priced_count == 0:
        band_note = "All stops have variable/unknown prices"
    elif unpriced_count > 0:
        band_note = f"excludes {unpriced_count} unpriced stop{'s' if unpriced_count > 1 else ''}"
    else:
        band_note = "all stops priced"

    budget_band = {
        "min": min_sum,
        "max": max_sum,
        "pricedCount": priced_count,
        "totalStops": total_stops,
        "unpricedCount": unpriced_count,
        "note": band_note,
    }

    # Feasibility check
    feasibility_msg = ""
    if budget_per_day:
        target_budget = budget_per_day * days
        if min_sum <= target_budget:
            feasibility_msg = f"Fits budget ₹{target_budget:,} with min-sum ₹{min_sum:,}"
        else:
            diff = min_sum - target_budget
            feasibility_msg = f"Over budget by ~₹{diff:,} (min-sum ₹{min_sum:,})"
    elif priced_count > 0:
        feasibility_msg = f"≈ ₹{min_sum:,}–{max_sum:,} · {priced_count} of {total_stops} stops priced ({band_note})"
    else:
        feasibility_msg = f"{total_stops} stops · prices vary — no reliable signal"

    feasible = Feasibility(
        ok=total_stops >= days * 2,
        message=feasibility_msg,
    )

    # Voice summary
    stop_names = [s.name for d in trip_days for s in d.stops[:4]]
    price_voice = (
        f"Estimated budget between {min_sum} to {max_sum} rupees per person for the priced stops. "
        if priced_count > 0
        else "Price details vary for these stops. "
    )
    voice = (
        f"Here's your {days}-day plan for {city_label}. "
        f"I've lined up {total_stops} stops"
        + (f" including {', '.join(stop_names[:3])}" if stop_names else "")
        + f". {price_voice}"
        + (f"Walk distance about {sum(d.walkKm or 0 for d in trip_days):.1f} km. " if any(d.walkKm for d in trip_days) else "")
        + "Let me know if you want to swap anything or adjust stops!"
    )

    plan_id = hashlib.sha256(f"{city}:{time.time()}".encode()).hexdigest()[:12]

    return TripPlan(
        id=plan_id,
        city=city,
        cityLabel=city_label,
        lat=lat,
        lon=lon,
        createdAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        days=trip_days,
        voiceSummary=voice,
        feasibility=feasible,
        budgetTotal=min_sum if priced_count > 0 else 0,
        budgetPerDay=(min_sum // max(days, 1)) if priced_count > 0 else 0,
        budgetBand=budget_band,
        shareUrl=f"/trip/{plan_id}",
    )
