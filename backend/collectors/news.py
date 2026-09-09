# ─── Google News RSS collector ────────────────────────────────────────────────
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from models import GeoCtx
from net import fetch_text
from collectors.reddit import proper_nouns, source_category, geocode_candidates


async def collect_news(ctx: GeoCtx) -> list[dict]:
    rss = await fetch_text(
        f"https://news.google.com/rss/search?q={ctx.city} (market OR fort OR heritage OR cafe OR bazaar)&hl=en-IN&gl=IN&ceid=IN:en",
        timeout_ms=12000, retries=0,
    )
    root = ET.fromstring(rss)
    items = root.findall(".//item")
    hits = []

    for it in items[:30]:
        title = it.findtext("title", "")
        link = it.findtext("link", "")
        source_name = it.findtext("source", "press")
        if not title:
            continue
        for name in proper_nouns(title):
            hits.append({
                "name": name,
                "category": source_category(title) or "hidden_gem",
                "source": "Google News",
                "source_url": link,
                "mentions": 1,
                "quotes": [{"text": title, "permalink": link}],
                "tags": ["news"],
            })
            if len(hits) > 20:
                break
        if len(hits) > 20:
            break

    # Geocode top names
    name_counts: dict[str, int] = {}
    for h in hits:
        name_counts[h["name"]] = name_counts.get(h["name"], 0) + 1
    top_names = sorted(name_counts, key=name_counts.get, reverse=True)[:6]
    geocoded = await geocode_candidates(top_names, ctx, 6)
    by_name = {g["name"].lower(): g for g in geocoded}

    for h in hits:
        g = by_name.get(h["name"].lower())
        if g:
            h["lat"] = g["lat"]
            h["lon"] = g["lon"]

    return hits[:15]
