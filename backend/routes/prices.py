# ─── Price Intelligence routes ────────────────────────────────────────────────
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import load_places_for_city, get_place_by_id, save_price_samples, update_place_price_hint, load_price_samples
from services.price_engine import parse_price_snippets, aggregate_price_hint, PriceSample

router = APIRouter()


class PriceScanRequest(BaseModel):
    city: Optional[str] = None
    place_ids: Optional[list[str]] = None


@router.post("/v1/prices/scan")
async def scan_prices(req: PriceScanRequest):
    places_to_scan = []
    if req.place_ids:
        for pid in req.place_ids:
            p = await get_place_by_id(pid)
            if p:
                places_to_scan.append(p)
    elif req.city:
        places_to_scan = await load_places_for_city(req.city)

    if not places_to_scan:
        return {"scanned": 0, "updated": 0, "message": "No places found to scan"}

    updated_count = 0
    web_search_attempts = 0
    results = []

    for place in places_to_scan:
        samples: list[PriceSample] = []
        
        # 1. Mine description
        if place.description:
            samples.extend(parse_price_snippets(place.description, source="description", category=place.category.value))

        # 2. Mine community quotes
        if place.community and place.community.quotes:
            for q in place.community.quotes:
                text = q.get("text", "") if isinstance(q, dict) else getattr(q, "text", "")
                link = q.get("permalink") if isinstance(q, dict) else getattr(q, "permalink", None)
                if text:
                    samples.extend(parse_price_snippets(text, source="community_quote", url=link, category=place.category.value))

        # 3. Existing stored samples in DB
        stored = await load_price_samples(place.id)
        for s in stored:
            samples.append(
                PriceSample(
                    value=s["value"],
                    value_max=s["value_max"],
                    unit=s["unit"],
                    context=s["context"],
                    source=s["source"],
                    url=s["url"],
                    confidence=s["confidence"],
                    date=s["date"],
                )
            )

        # 4. If still no samples, mine web search snippets for realistic entry/meal prices (max 6 attempts)
        if not samples and web_search_attempts < 6:
            web_search_attempts += 1
            try:
                from services.search_lens import fetch_serp_duckduckgo
                city_hint = req.city or "India"
                query = f"{place.name} {city_hint} entry fee ticket price menu"
                serp_results = await fetch_serp_duckduckgo(query)
                for res in serp_results[:3]:
                    text = f"{res.get('title', '')}. {res.get('snippet', '')}"
                    url = res.get("url")
                    web_samples = parse_price_snippets(text, source="web_search", url=url, category=place.category.value)
                    samples.extend(web_samples)
            except Exception:
                pass

        if samples:
            await save_price_samples(place.id, samples)
            hint = aggregate_price_hint(samples, category=place.category.value)
            await update_place_price_hint(place.id, hint, sample_count=len(samples))
            updated_count += 1
            results.append({
                "id": place.id,
                "name": place.name,
                "hint": hint.model_dump() if hint else None,
                "sample_count": len(samples),
            })
        else:
            await update_place_price_hint(place.id, None, sample_count=0)

    return {
        "scanned": len(places_to_scan),
        "updated": updated_count,
        "places": results[:50],
    }


@router.get("/v1/places/{place_id}")
@router.get("/places/{place_id}")
async def get_single_place(place_id: str):
    place = await get_place_by_id(place_id)
    if not place:
        raise HTTPException(404, detail=f"Place {place_id} not found")

    samples = await load_price_samples(place_id)
    place_dict = place.model_dump()
    if place.priceHint:
        place_dict["priceHint"] = place.priceHint.model_dump()
    else:
        # compute on the fly if stored samples exist
        if samples:
            parsed_samples = [
                PriceSample(
                    value=s["value"],
                    value_max=s["value_max"],
                    unit=s["unit"],
                    context=s["context"],
                    source=s["source"],
                    url=s["url"],
                    confidence=s["confidence"],
                )
                for s in samples
            ]
            hint = aggregate_price_hint(parsed_samples, category=place.category.value)
            place_dict["priceHint"] = hint.model_dump() if hint else None
        else:
            place_dict["priceHint"] = None

    place_dict["priceSamples"] = samples[:10]
    return place_dict
