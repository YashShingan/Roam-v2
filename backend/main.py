# ─── FastAPI main app ─────────────────────────────────────────────────────────
from __future__ import annotations

import sys
import os

# Add backend dir to path so imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import get_db, close_db
from net import close_client
from collectors import seed_health_from_db

from routes.places import router as places_router
from routes.geocode import router as geocode_router
from routes.weather import router as weather_router
from routes.trips import router as trips_router
from routes.assistant import router as assistant_router
from routes.health import router as health_router
from routes.stats import router as stats_router
from routes.route import router as route_router
from routes.collect import router as collect_router
from routes.prices import router as prices_router
from routes.serp import router as serp_router
from routes.images import router as images_router
from routes.lens import router as lens_router
from routes.jobs import router as jobs_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await get_db()
    await seed_health_from_db()
    yield
    # Shutdown
    await close_db()
    await close_client()


app = FastAPI(
    title="Roam API",
    description="Open-source community-signal travel backend — 13 keyless data sources",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: allow all origins via regex so any Vercel URL (prod, preview),
# localhost, or custom domain works without CORS headaches.
_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/health/health")
@app.get("/api/health")
async def health():
    """Platform health probe (Render health-check path). No DB dependency."""
    from db import data_mode

    return {"ok": True, "version": "1.0.0", "data_mode": data_mode()}

# Mount all routes
app.include_router(places_router, prefix="/api")
app.include_router(geocode_router, prefix="/api")
app.include_router(weather_router, prefix="/api")
app.include_router(trips_router, prefix="/api")
app.include_router(assistant_router, prefix="/api")
app.include_router(health_router, prefix="/api")
app.include_router(stats_router, prefix="/api")
app.include_router(route_router, prefix="/api")
app.include_router(collect_router, prefix="/api")
app.include_router(prices_router, prefix="/api")
app.include_router(serp_router, prefix="/api")
app.include_router(images_router, prefix="/api")
app.include_router(lens_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")


@app.get("/api/autolocate")
async def autolocate():
    """IP-based city detection via ip-api.com."""
    from net import fetch_json
    try:
        data = await fetch_json("http://ip-api.com/json/?fields=city,regionName,country,lat,lon", timeout_ms=5000)
        city = data.get("city", "")
        label = f"{city}, {data.get('regionName', '')}, {data.get('country', '')}"
        return {"city": city, "label": label, "lat": data.get("lat"), "lon": data.get("lon")}
    except Exception:
        return {"city": "Pune", "label": "Pune, Maharashtra, India", "lat": 18.52, "lon": 73.86}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
