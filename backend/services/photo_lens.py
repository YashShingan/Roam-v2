# ─── Photo Lens: Openverse / Commons / Bing Image Mining ─────────────────────
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
import urllib.parse
from typing import Any, Optional
from bs4 import BeautifulSoup
import httpx
from thefuzz import fuzz

from models import Experience, Category, SourceRef, CommunitySignal
from net import haversine_km
from db import (
    load_places_for_city,
    upsert_places,
    save_place_photo,
    update_place_photo,
    save_search_candidate,
)
from services.search_lens import geocode_place, infer_category

# Image disk cache directory
IMG_CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "img_cache")
os.makedirs(IMG_CACHE_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
}


# ─── Openverse API (Primary - CC Licensed) ───────────────────────────────────
async def search_openverse(query: str) -> list[dict[str, Any]]:
    """Fetch CC-licensed images from Openverse API."""
    url = f"https://api.openverse.org/v1/images/?q={urllib.parse.quote(query)}&page_size=5"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers={"User-Agent": "RoamApp/1.0 (open-source travel)"})
            if resp.status_code == 200:
                data = resp.json()
                results = []
                for item in data.get("results", []):
                    results.append({
                        "url": item.get("url"),
                        "thumb_url": item.get("thumbnail") or item.get("url"),
                        "title": item.get("title", ""),
                        "creator": item.get("creator", "Unknown Creator"),
                        "license": (item.get("license", "CC") + " " + item.get("license_version", "")).strip().upper(),
                        "attribution": f"{item.get('creator', 'Unknown')} · {item.get('license', 'CC').upper()} · Openverse",
                        "source_page": item.get("foreign_landing_url"),
                        "source": "openverse",
                    })
                return results
    except Exception:
        pass
    return []


# ─── Wikimedia Commons Search ────────────────────────────────────────────────
async def search_commons_images(query: str) -> list[dict[str, Any]]:
    """Search Wikimedia Commons for free licensed images."""
    url = (
        f"https://commons.wikimedia.org/w/api.php?action=query&generator=search"
        f"&gsrsearch={urllib.parse.quote(query)}&gsrnamespace=6&prop=imageinfo"
        f"&iiprop=url|extmetadata|size&format=json&gsrlimit=5"
    )
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers={"User-Agent": "RoamApp/1.0 (open-source travel)"})
            if resp.status_code == 200:
                data = resp.json()
                pages = data.get("query", {}).get("pages", {})
                results = []
                for p in pages.values():
                    infos = p.get("imageinfo", [])
                    if infos:
                        info = infos[0]
                        meta = info.get("extmetadata", {})
                        creator = meta.get("Artist", {}).get("value", "Wikimedia Commons")
                        creator = re.sub(r"<[^>]+>", "", creator).strip()[:40] or "Wikimedia Commons"
                        lic = meta.get("LicenseShortName", {}).get("value", "CC BY-SA")
                        results.append({
                            "url": info.get("url"),
                            "thumb_url": info.get("thumburl") or info.get("url"),
                            "title": p.get("title", "").replace("File:", ""),
                            "creator": creator,
                            "license": lic,
                            "attribution": f"{creator} · {lic} · Wikimedia Commons",
                            "source_page": info.get("descriptionurl"),
                            "source": "commons",
                        })
                return results
    except Exception:
        pass
    return []


# ─── Bing Images HTML (Discovery & Fallback) ──────────────────────────────────
async def search_bing_images(query: str) -> list[dict[str, Any]]:
    """Parse Bing Images HTML for discovery filenames and candidate images."""
    url = f"https://www.bing.com/images/search?q={urllib.parse.quote(query)}"
    try:
        async with httpx.AsyncClient(timeout=9.0, headers=HEADERS) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                results = []
                for a_tag in soup.select("a.iusc"):
                    m_attr = a_tag.get("m")
                    if m_attr:
                        try:
                            m_data = json.loads(m_attr)
                            img_url = m_data.get("murl")
                            title = m_data.get("t", "")
                            purl = m_data.get("purl", "")
                            if img_url:
                                results.append({
                                    "url": img_url,
                                    "thumb_url": m_data.get("turl") or img_url,
                                    "title": title,
                                    "creator": "Web reference",
                                    "license": "unknown",
                                    "attribution": "Web reference · Bing Image Search",
                                    "source_page": purl,
                                    "source": "bing",
                                })
                        except Exception:
                            continue
                return results[:8]
    except Exception:
        pass
    return []


# ─── Image Filename Venue Miner ──────────────────────────────────────────────
def clean_filename_to_venue(title: str, url: str) -> Optional[str]:
    """Derive venue candidate from image title, alt, or filename."""
    path = urllib.parse.urlparse(url).path
    filename = os.path.basename(path)
    base, _ = os.path.splitext(filename)
    
    candidates = [title, base]
    for raw in candidates:
        if not raw:
            continue
        cleaned = re.sub(r"[-_.]+", " ", raw)
        cleaned = re.sub(r"\b\d{3,4}x\d{3,4}\b", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\b\d{3,4}w\b", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\b(jpg|jpeg|png|webp|image|photo|pic|thumb|img|dsc|screenshot)\b", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\b(wallpaper|download|stock|clipart|icon|vector|hd|free|best|top)\b", "", cleaned, flags=re.IGNORECASE)
        cleaned = " ".join(cleaned.split()).strip()
        words = cleaned.split()
        if 2 <= len(words) <= 5 and 5 <= len(cleaned) <= 40:
            return cleaned.title()
    return None


# ─── Photo Mining & Attachment Pipeline ───────────────────────────────────────
async def run_photo_lens(city: str) -> dict[str, Any]:
    """Find real card photos for existing places and discover missing spots via image metadata."""
    places = await load_places_for_city(city, limit=200)
    photos_attached = 0
    discovery_candidates = []
    added_from_images = []

    # 1. Attach photos to existing places that lack real photos (bounded concurrency)
    sem = asyncio.Semaphore(6)

    async def attach_one(place):
        nonlocal photos_attached
        if place.photo_url and not place.photo_url.startswith("https://picsum.photos"):
            return
        async with sem:
            query = f"{place.name} {city}"
            images = await search_openverse(query)
            if not images:
                images = await search_commons_images(query)

            matched_img = None
            if images:
                for img in images:
                    sim = fuzz.partial_ratio(place.name.lower(), img["title"].lower())
                    if sim >= 70 or img["source"] == "openverse":
                        matched_img = img
                        break
                if not matched_img and images:
                    matched_img = images[0]

            if matched_img and matched_img.get("url"):
                proxy_url = f"/api/v1/img?u={urllib.parse.quote(matched_img['url'])}"
                await save_place_photo(
                    place_id=place.id,
                    url=proxy_url,
                    thumb_url=proxy_url,
                    license=matched_img.get("license", "CC"),
                    attribution=matched_img.get("attribution", ""),
                    source_page=matched_img.get("source_page", ""),
                    source=matched_img.get("source", "openverse"),
                )
                await update_place_photo(place.id, proxy_url, matched_img.get("attribution", ""))
                photos_attached += 1

    await asyncio.gather(*[attach_one(p) for p in places[:40]], return_exceptions=True)

    # 2. Bing Images for discovery mining
    bing_images = await search_bing_images(f"{city} famous places food fort")
    for bimg in bing_images:
        cand = clean_filename_to_venue(bimg.get("title", ""), bimg.get("url", ""))
        if cand and cand not in discovery_candidates:
            discovery_candidates.append(cand)
            # Check if place exists
            exists = any(fuzz.token_sort_ratio(cand.lower(), p.name.lower()) >= 80 for p in places)
            if not exists:
                # Attempt geocode
                geo = await geocode_place(cand, city)
                if geo:
                    cat = infer_category(cand, bimg.get("title", ""))
                    p_id = hashlib.sha256(f"img_discovery:{cand}".encode()).hexdigest()[:16]
                    proxy_thumb = f"/api/v1/img?u={urllib.parse.quote(bimg['url'])}"
                    discovered_place = Experience(
                        id=p_id,
                        name=cand,
                        category=cat,
                        source="Photo Lens",
                        sources=[SourceRef(source="Photo Lens", url=bimg.get("source_page"), note="Discovered from open image metadata")],
                        description=f"{cand} in {city}, discovered via open image search metadata.",
                        lat=geo["lat"],
                        lon=geo["lon"],
                        address=f"{city}, India",
                        popularity="Discovered from open image search",
                        popularityScore=0.4,
                        imageUrl=proxy_thumb,
                        photoAttribution=bimg.get("attribution", "Open Web Image"),
                        foundViaSearch=True,
                    )
                    added_from_images.append(discovered_place)
                    places.append(discovered_place)
                    await save_search_candidate(cand, city, "bing_images", "image_metadata", bimg.get("url"), "added", "Discovered via image metadata")

    if added_from_images:
        await upsert_places(city, added_from_images)

    return {
        "city": city,
        "photos_attached": photos_attached,
        "discovery_candidates_found": len(discovery_candidates),
        "places_added_from_images": len(added_from_images),
        "added_names": [p.name for p in added_from_images],
    }
