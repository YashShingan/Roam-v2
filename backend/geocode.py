# ─── Geocode helpers: Nominatim + Photon ─────────────────────────────────────
from __future__ import annotations

from typing import Optional
from net import fetch_json, cached


async def nominatim_geocode(query: str) -> Optional[dict]:
    """Geocode a city name → {lat, lon, display_name, bbox}."""
    async def _fetch():
        url = (
            f"https://nominatim.openstreetmap.org/search"
            f"?q={query}&format=jsonv2&limit=1&addressdetails=1"
        )
        data = await fetch_json(url, timeout_ms=10000)
        if not data:
            return None
        hit = data[0]
        return {
            "lat": float(hit["lat"]),
            "lon": float(hit["lon"]),
            "display_name": hit.get("display_name", query),
            "bbox": hit.get("boundingbox"),
        }

    return await cached(f"geo:{query.lower().strip()}", _fetch)


async def reverse_geocode_address(lat: float, lon: float) -> str:
    """Reverse geocode coords to a human-readable street address via Photon / Nominatim."""
    cache_key = f"rev_addr:{round(lat, 3)}:{round(lon, 3)}"

    async def _fetch() -> str:
        # 1. Try Photon reverse (instant, keyless)
        try:
            url = f"https://photon.komoot.io/reverse?lat={lat}&lon={lon}"
            data = await fetch_json(url, timeout_ms=4000)
            if data and data.get("features"):
                p = data["features"][0].get("properties", {})
                parts = [
                    p.get("street") or (p.get("name") if p.get("name") != p.get("city") else None),
                    p.get("locality") or p.get("district"),
                    p.get("city"),
                ]
                clean = [x for x in parts if x and x.strip()]
                unique = list(dict.fromkeys(clean))
                if unique:
                    return ", ".join(unique)
        except Exception:
            pass

        # 2. Try Nominatim reverse
        try:
            url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=jsonv2&zoom=18&addressdetails=1"
            data = await fetch_json(url, timeout_ms=5000)
            if data:
                addr = data.get("address", {})
                road = addr.get("road") or addr.get("pedestrian") or addr.get("suburb") or addr.get("neighbourhood")
                city = addr.get("city") or addr.get("town") or addr.get("village")
                clean = [x for x in [road, city] if x]
                if clean:
                    return ", ".join(clean)
                return data.get("display_name", "").split(",")[:3]
        except Exception:
            pass

        return ""

    return await cached(cache_key, _fetch)


async def nominatim_reverse(lat: float, lon: float) -> Optional[dict]:
    """Reverse geocode → {city, display_name}."""
    url = (
        f"https://nominatim.openstreetmap.org/reverse"
        f"?lat={lat}&lon={lon}&format=jsonv2&zoom=10"
    )
    data = await fetch_json(url, timeout_ms=8000)
    if not data:
        return None
    addr = data.get("address", {})
    city = (
        addr.get("city")
        or addr.get("town")
        or addr.get("village")
        or addr.get("county")
        or data.get("display_name", "").split(",")[0]
    )
    return {"city": city, "display_name": data.get("display_name", "")}


async def photon_autocomplete(query: str, limit: int = 6) -> list[dict]:
    """Autocomplete city names via Photon (OSM index)."""
    if len(query.strip()) < 2:
        return []

    async def _fetch():
        url = (
            f"https://photon.komoot.io/api/"
            f"?q={query}&limit={limit}&osm_tag=place"
        )
        data = await fetch_json(url, timeout_ms=5000)
        features = data.get("features", [])
        results = []
        for f in features:
            props = f.get("properties", {})
            coords = f.get("geometry", {}).get("coordinates", [0, 0])
            city = props.get("city") or props.get("name") or ""
            label_parts = [city]
            if props.get("state"):
                label_parts.append(props["state"])
            if props.get("country"):
                label_parts.append(props["country"])
            results.append({
                "city": city,
                "label": ", ".join(label_parts),
                "lat": coords[1],
                "lon": coords[0],
            })
        return results

    return await cached(f"photon:{query.lower().strip()}", _fetch)


async def geocode_city(city: str) -> Optional[dict]:
    """Main geocoding entry point — tries Nominatim, returns {lat, lon, label, bbox}."""
    result = await nominatim_geocode(city)
    if not result:
        return None
    label = result["display_name"]
    return {
        "lat": result["lat"],
        "lon": result["lon"],
        "label": label,
        "bbox": result.get("bbox"),
    }
