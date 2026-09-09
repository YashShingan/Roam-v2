# ─── Photon POI sweep collector ──────────────────────────────────────────────
from __future__ import annotations

from models import GeoCtx
from net import fetch_json, haversine_km


async def collect_photon(ctx: GeoCtx) -> list[dict]:
    """Sweep Photon for POIs near coordinates."""
    categories = ["cafe", "museum", "temple", "market", "park", "bakery", "fort", "viewpoint"]
    hits = []

    for cat in categories:
        try:
            data = await fetch_json(
                f"https://photon.komoot.io/api/?q={cat} {ctx.city}&limit=8&lat={ctx.lat}&lon={ctx.lon}&lang=en",
                timeout_ms=8000, retries=0,
            )
            for f in data.get("features", []):
                props = f.get("properties", {})
                coords = f.get("geometry", {}).get("coordinates", [0, 0])
                name = props.get("name", "")
                if not name or len(name) < 2:
                    continue

                lat = coords[1]
                lon = coords[0]
                if haversine_km(ctx.lat, ctx.lon, lat, lon) > ctx.radiusKm * 1.5:
                    continue

                city_name = props.get("city") or props.get("county") or ""
                state = props.get("state", "")
                address = ", ".join(filter(None, [props.get("street"), city_name, state]))

                hits.append({
                    "name": name,
                    "lat": lat,
                    "lon": lon,
                    "address": address or None,
                    "category": None,  # Pipeline categorizes
                    "source": "Photon (OSM index)",
                    "source_url": None,
                    "osm_id": str(props.get("osm_id", "")),
                    "osm_type": props.get("osm_type"),
                    "tags": [cat],
                })
        except Exception:
            pass

    return hits[:40]
