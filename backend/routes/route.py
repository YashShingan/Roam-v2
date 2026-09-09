# ─── Routing API route (OSRM + Haversine fallback) ────────────────────────────
from __future__ import annotations

import math
from typing import List, Tuple
from fastapi import APIRouter, Query, Response
from net import fetch_json, haversine_km

router = APIRouter()


@router.get("/route")
async def get_route(
    waypoints: str = Query(..., description="lat,lon;lat,lon[;...]"),
    mode: str = Query("foot", description="foot or drive"),
):
    try:
        pts: List[Tuple[float, float]] = []
        for part in waypoints.split(";"):
            tokens = part.split(",")
            if len(tokens) == 2:
                try:
                    lat, lon = float(tokens[0]), float(tokens[1])
                    if math.isfinite(lat) and math.isfinite(lon):
                        pts.append((lat, lon))
                except ValueError:
                    continue

        if len(pts) < 2:
            return Response(
                content='{"error":"waypoints=lat,lon;lat,lon[;...] (min 2)"}',
                status_code=400,
                media_type="application/json",
            )

        osrm_mode = "driving" if mode == "drive" else "foot"
        coords = ";".join(f"{lon},{lat}" for lat, lon in pts)
        url = f"https://router.project-osrm.org/route/v1/{osrm_mode}/{coords}?overview=full&geometries=geojson"

        try:
            data = await fetch_json(url, timeout_ms=12000)
            routes = data.get("routes", [])
            if routes and "legs" in routes[0]:
                legs = routes[0]["legs"]
                if len(legs) == len(pts) - 1:
                    result_legs = []
                    for leg in legs:
                        dur = leg.get("duration", 0)
                        dist = leg.get("distance", 0)
                        geom = leg.get("geometry", {}).get("coordinates", [])
                        result_legs.append({
                            "minutes": max(1, round(dur / 60)),
                            "km": round(dist / 1000, 2),
                            "geometry": [[lat, lon] for lon, lat in geom],
                        })
                    return {"engine": "OSRM", "legs": result_legs}
            raise Exception("OSRM invalid response")
        except Exception:
            # Haversine fallback: walk ×1.4 at 4.5 km/h, drive ×1.3 at 28 km/h
            fallback_legs = []
            for i in range(1, len(pts)):
                p1, p2 = pts[i - 1], pts[i]
                factor = 1.4 if mode == "foot" else 1.3
                speed = 4.5 if mode == "foot" else 28.0
                dist_km = haversine_km(p1[0], p1[1], p2[0], p2[1]) * factor
                minutes = max(1, round((dist_km / speed) * 60))
                fallback_legs.append({
                    "minutes": minutes,
                    "km": round(dist_km, 2),
                    "geometry": [[p1[0], p1[1]], [p2[0], p2[1]]],
                })
            return {"engine": "haversine-fallback", "legs": fallback_legs}
    except Exception as e:
        return Response(
            content=f'{{"error":"{str(e)}"}}',
            status_code=502,
            media_type="application/json",
        )
