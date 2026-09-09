# ─── YouTube collector (Piped/Invidious proxy ladder, no keys) ───────────────
from __future__ import annotations

import re
from models import GeoCtx
from net import fetch_json
from collectors.reddit import proper_nouns, source_category

PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.in.projectsegfau.lt",
]

INVIDIOUS_INSTANCES = [
    "https://inv.nadeko.net",
    "https://invidious.snopyta.org",
]


async def _search_piped(query: str) -> list[dict]:
    for base in PIPED_INSTANCES:
        try:
            data = await fetch_json(
                f"{base}/search?q={query}&filter=videos",
                timeout_ms=10000, retries=0,
            )
            items = data.get("items", data) if isinstance(data, list) else data.get("items", [])
            return items[:15] if isinstance(items, list) else []
        except Exception:
            continue
    return []


async def _search_invidious(query: str) -> list[dict]:
    for base in INVIDIOUS_INSTANCES:
        try:
            data = await fetch_json(
                f"{base}/api/v1/search?q={query}&type=video",
                timeout_ms=10000, retries=0,
            )
            return data[:15] if isinstance(data, list) else []
        except Exception:
            continue
    return []


async def collect_youtube(ctx: GeoCtx) -> list[dict]:
    query = f"{ctx.city} travel hidden gems food heritage"
    
    # Try Piped first, then Invidious
    videos = await _search_piped(query)
    if not videos:
        videos = await _search_invidious(query)

    hits = []
    for vid in videos[:12]:
        title = vid.get("title", "")
        desc = vid.get("description") or vid.get("descriptionHtml") or ""
        desc = re.sub(r"<[^>]+>", "", desc)
        views = vid.get("views", vid.get("viewCount", 0))
        video_id = vid.get("url", "").split("v=")[-1] if "v=" in vid.get("url", "") else vid.get("videoId", "")

        # Mine venue names from title + description
        text = f"{title}. {desc}"
        for name in proper_nouns(text):
            cat = source_category(text) or "hidden_gem"
            hits.append({
                "name": name,
                "category": cat,
                "source": "YouTube",
                "source_url": f"https://www.youtube.com/watch?v={video_id}" if video_id else None,
                "mentions": 1,
                "quotes": [{"text": title[:200]}],
                "tags": ["youtube", "video"],
            })
            if len(hits) >= 30:
                break
        if len(hits) >= 30:
            break

    # Add popularity for the videos themselves
    for h in hits:
        if views:
            try:
                h["popularity"] = min(int(views) / 100000, 1.0)
            except (ValueError, TypeError):
                pass

    return hits[:20]
