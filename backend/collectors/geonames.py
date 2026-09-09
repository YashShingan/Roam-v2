# ─── GeoNames collector ──────────────────────────────────────────────────────
from __future__ import annotations

from models import GeoCtx
from net import fetch_json, haversine_km


async def collect_geonames(ctx: GeoCtx) -> list[dict]:
    """GeoNames — free API (no key for JSON search)."""
    hits = []
    try:
        # GeoNames has a free search endpoint
        data = await fetch_json(
            f"https://secure.geonames.org/searchJSON"
            f"?q={ctx.city}&maxRows=40&featureClass=S&featureClass=L&featureClass=T&featureClass=H&featureClass=V"
            f"&lat={ctx.lat}&lng={ctx.lon}&radius={int(ctx.radiusKm)}"
            f"&username=demo&style=full",
            timeout_ms=15000, retries=1,
        )

        for g in data.get("geonames", []):
            name = g.get("name", "").strip()
            if not name or len(name) < 2:
                continue

            # Skip roads/rail (featureClass R)
            fc = g.get("fclName", "").lower()
            fcode = g.get("fcode", "")
            if g.get("fcl") == "R":
                continue

            lat = float(g.get("lat", 0))
            lon = float(g.get("lng", 0))
            if lat == 0 and lon == 0:
                continue

            dist = haversine_km(ctx.lat, ctx.lon, lat, lon)
            if dist > ctx.radiusKm * 1.5:
                continue

            hits.append({
                "name": name,
                "lat": lat,
                "lon": lon,
                "category": None,  # Pipeline will categorize
                "source": "GeoNames",
                "source_url": f"https://www.geonames.org/{g.get('geonameId', '')}",
                "tags": [fcode.lower()] if fcode else [],
            })

    except Exception:
        pass

    return hits[:30]
