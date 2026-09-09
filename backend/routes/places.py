# ─── Places routes ────────────────────────────────────────────────────────────
from __future__ import annotations

from fastapi import APIRouter, Query, HTTPException
from geocode import geocode_city
from models import GeoCtx
from collectors import run_collectors
from pipeline import run_pipeline
from db import upsert_places, load_places_for_city
from net import cached

router = APIRouter()


async def get_places_for_city(city: str, radius_km: float = 15) -> dict:
    """Full 13-source aggregation → Experience[]."""

    async def _fetch():
        # Geocode
        geo = await geocode_city(city)
        if not geo:
            raise Exception(f"Could not geocode '{city}'")

        lat, lon = geo["lat"], geo["lon"]
        label = geo["label"]

        ctx = GeoCtx(city=city, lat=lat, lon=lon, radiusKm=radius_km)

        # Run all collectors
        result = await run_collectors(ctx)
        raw_hits = result["hits"]
        health = result["health"]

        # Pipeline
        places = run_pipeline(raw_hits, city, lat, lon)

        # Enrich top places with reverse geocoded OSM addresses and directions URL
        from geocode import reverse_geocode_address
        for p in places[:35]:
            if (not p.address or p.address == "Not listed") and p.lat and p.lon:
                try:
                    addr = await reverse_geocode_address(p.lat, p.lon)
                    if addr:
                        p.address = addr
                except Exception:
                    pass
            if not p.gmapsDirectionsUrl and p.lat and p.lon:
                p.gmapsDirectionsUrl = f"https://www.google.com/maps/dir/?api=1&destination={p.lat},{p.lon}"

        # Persist to SQLite
        if places:
            await upsert_places(city, places)

        # Check degradation
        degraded = any(not h.get("ok") for h in health)

        return {
            "city": city,
            "cityLabel": label,
            "lat": lat,
            "lon": lon,
            "radiusKm": radius_km,
            "places": [p.model_dump() for p in places],
            "degraded": degraded,
        }

    return await cached(f"places:{city.lower()}:{radius_km}", _fetch)


@router.get("/places")
async def places_route(
    city: str = Query(..., description="City name"),
    radius: float = Query(15, description="Search radius in km"),
    bbox: str | None = Query(None, description="Bounding box w,s,e,n"),
):
    if not city.strip():
        raise HTTPException(400, "Missing ?city= (e.g. city=Kalyan)")

    if bbox:
        from net import parse_bbox
        parsed = parse_bbox(bbox)
        if parsed:
            radius = min(round(max(parsed["e"] - parsed["w"], parsed["n"] - parsed["s"]) * 55), 25)

    try:
        result = await get_places_for_city(city.strip(), radius)
        return result
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/places/{place_id}/wiki")
async def wiki_enrichment(
    place_id: str,
    name: str = Query(""),
    lat: str = Query(""),
    lon: str = Query(""),
):
    """Wikipedia enrichment for a single place."""
    from net import fetch_json
    try:
        if not name:
            return {"extract": None, "note": "No name provided"}

        import urllib.parse
        url = (
            f"https://en.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages"
            f"&exintro=1&explaintext=1&pithumbsize=640&redirects=1"
            f"&titles={urllib.parse.quote(name)}&format=json&formatversion=2"
        )
        data = await fetch_json(url, timeout_ms=10000)
        pages = data.get("query", {}).get("pages", [])
        if isinstance(pages, dict):
            pages = list(pages.values())

        page = pages[0] if pages else {}
        extract = page.get("extract")
        thumb = page.get("thumbnail", {}).get("source")
        wiki_url = f"https://en.wikipedia.org/wiki/{urllib.parse.quote(name.replace(' ', '_'))}"

        return {
            "extract": extract[:1000] if extract else None,
            "thumbnail": thumb,
            "url": wiki_url if extract else None,
            "note": "From Wikipedia REST API (keyless)",
        }
    except Exception:
        return {"extract": None, "note": "Wikipedia enrichment unavailable"}
