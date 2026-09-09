# ─── Images API routes (Mining + Caching Proxy) ──────────────────────────────
from __future__ import annotations

import hashlib
import os
import urllib.parse
from typing import Optional
from fastapi import APIRouter, Query, Response, HTTPException
from pydantic import BaseModel
import httpx

from services.photo_lens import run_photo_lens, IMG_CACHE_DIR

router = APIRouter()


class ImageMineRequest(BaseModel):
    city: str


@router.post("/v1/images/mine")
async def mine_images(req: ImageMineRequest):
    result = await run_photo_lens(req.city)
    return result


@router.get("/v1/img")
async def proxy_image(u: str = Query(..., description="Target image URL")):
    """Caches external images locally for 7 days with timeout & size safety."""
    if not u or not u.startswith("http"):
        raise HTTPException(400, "Invalid image URL")

    cache_hash = hashlib.md5(u.encode()).hexdigest()
    cache_path = os.path.join(IMG_CACHE_DIR, f"{cache_hash}.img")

    # Check local cache
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "rb") as f:
                content = f.read()
            return Response(content=content, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})
        except Exception:
            pass

    # Fetch with 5s timeout
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            resp = await client.get(u, headers={"User-Agent": "Mozilla/5.0 RoamApp/1.0"})
            if resp.status_code == 200 and len(resp.content) > 1000:
                # Cache up to 8MB
                if len(resp.content) < 8 * 1024 * 1024:
                    try:
                        with open(cache_path, "wb") as f:
                            f.write(resp.content)
                    except Exception:
                        pass
                content_type = resp.headers.get("content-type", "image/jpeg")
                return Response(content=resp.content, media_type=content_type, headers={"Cache-Control": "public, max-age=604800"})
    except Exception:
        pass

    # Graceful redirect fallback to picsum placeholder
    seed = abs(hash(u)) % 1000
    return Response(
        status_code=307,
        headers={"Location": f"https://picsum.photos/seed/{seed}/600/400"},
    )
