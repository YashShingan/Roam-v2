# ─── Lens Orchestrator: Search + Photo + Price Pipeline ──────────────────────
from __future__ import annotations

import asyncio
from typing import Any, Optional
from services.search_lens import run_search_lens
from services.photo_lens import run_photo_lens
from db import load_places_for_city, save_price_samples, update_place_price_hint, load_price_samples
from services.price_engine import parse_price_snippets, aggregate_price_hint, PriceSample


async def run_full_lens_pipeline(
    city: str,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_km: float = 15.0,
) -> dict[str, Any]:
    """Runs Search Lens -> Photo Lens -> Price re-scan in order with full fault isolation."""
    report: dict[str, Any] = {
        "city": city,
        "search_lens": {},
        "photo_lens": {},
        "price_scan": {},
        "summary": {},
    }

    # 1. Search Lens
    try:
        search_res = await run_search_lens(city, lat=lat, lon=lon, radius_km=radius_km)
        report["search_lens"] = search_res
    except Exception as e:
        report["search_lens"] = {"error": str(e), "added": 0, "merged": 0}

    # 2. Photo Lens
    try:
        photo_res = await run_photo_lens(city)
        report["photo_lens"] = photo_res
    except Exception as e:
        report["photo_lens"] = {"error": str(e), "photos_attached": 0}

    # 3. Price Rescan
    try:
        places = await load_places_for_city(city, limit=200)
        price_updates = 0
        for p in places:
            samples: list[PriceSample] = []
            if p.description:
                samples.extend(parse_price_snippets(p.description, source="description", category=p.category.value))
            if p.community and p.community.quotes:
                for q in p.community.quotes:
                    txt = q.get("text", "") if isinstance(q, dict) else getattr(q, "text", "")
                    if txt:
                        samples.extend(parse_price_snippets(txt, source="quote", category=p.category.value))
            stored = await load_price_samples(p.id)
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
                    )
                )
            if samples:
                await save_price_samples(p.id, samples)
                hint = aggregate_price_hint(samples, category=p.category.value)
                await update_place_price_hint(p.id, hint, sample_count=len(samples))
                price_updates += 1

        report["price_scan"] = {"scanned": len(places), "prices_updated": price_updates}
    except Exception as e:
        report["price_scan"] = {"error": str(e), "prices_updated": 0}

    report["summary"] = {
        "places_added_search": report["search_lens"].get("added", 0),
        "places_added_photos": report["photo_lens"].get("places_added_from_images", 0),
        "photos_attached": report["photo_lens"].get("photos_attached", 0),
        "prices_updated": report["price_scan"].get("prices_updated", 0),
    }

    return report
