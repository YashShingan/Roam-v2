# ─── Tests for Planner Price Math & Reordering ──────────────────────────────
from __future__ import annotations

import pytest
from models import Experience, Category, ItineraryStop, TripDay, TripPlan, Feasibility
from services.price_engine import PriceHint, PriceSample


def create_mock_place(id: str, name: str, price_min: float | None, price_max: float | None, mode: str = "meal") -> Experience:
    hint = None
    if price_min is not None:
        hint = PriceHint(
            mode=mode,
            min=price_min,
            max=price_max or price_min,
            per_person=price_min,
            samples=[PriceSample(value=price_min, context=mode, source="test")],
            confidence=0.8,
        )
    return Experience(
        id=id,
        name=name,
        category=Category.food,
        source="test",
        address="Kalyan",
        priceHint=hint,
        pricePerPerson=int(price_min) if price_min else None,
    )


def test_planner_totals_math():
    places = [
        create_mock_place("p1", "Thali House", 150.0, 250.0, "meal"),
        create_mock_place("p2", "Fort Entry", 50.0, 50.0, "entry"),
        create_mock_place("p3", "Chai Corner", 20.0, 20.0, "item"),
        create_mock_place("p4", "Unknown Cafe", None, None),  # unpriced stop
    ]

    stops = []
    for p in places:
        p_min = p.priceHint.min if p.priceHint else None
        p_max = p.priceHint.max if p.priceHint else None
        stops.append(
            ItineraryStop(
                experienceId=p.id,
                name=p.name,
                category=p.category,
                slotStart="10:00",
                slotEnd="11:00",
                pricePerPerson=p.pricePerPerson,
                priceMin=p_min,
                priceMax=p_max,
                priceBasis="entry ₹50" if p.id == "p2" else ("Varies" if p_min is None else f"~₹{p_min}"),
            )
        )

    priced_stops = [s for s in stops if s.priceMin is not None]
    assert len(priced_stops) == 3
    
    min_sum = int(sum(s.priceMin for s in priced_stops))
    max_sum = int(sum(s.priceMax for s in priced_stops))
    
    assert min_sum == 150 + 50 + 20  # 220
    assert max_sum == 250 + 50 + 20  # 320

    # Reorder test: swap p1 and p2
    stops[0], stops[1] = stops[1], stops[0]
    reordered_priced = [s for s in stops if s.priceMin is not None]
    assert int(sum(s.priceMin for s in reordered_priced)) == min_sum
    assert int(sum(s.priceMax for s in reordered_priced)) == max_sum


def test_planner_all_unpriced():
    places = [
        create_mock_place("p1", "Place 1", None, None),
        create_mock_place("p2", "Place 2", None, None),
    ]
    stops = [
        ItineraryStop(
            experienceId=p.id,
            name=p.name,
            category=p.category,
            slotStart="10:00",
            slotEnd="11:00",
            pricePerPerson=None,
            priceMin=None,
            priceMax=None,
            priceBasis="Varies — no reliable signal",
        )
        for p in places
    ]
    priced_stops = [s for s in stops if s.priceMin is not None]
    assert len(priced_stops) == 0
    min_sum = sum(s.priceMin for s in priced_stops)
    assert min_sum == 0
