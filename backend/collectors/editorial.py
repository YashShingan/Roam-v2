# ─── Editorial deep-links collector (ToS-safe) ──────────────────────────────
from __future__ import annotations

from models import GeoCtx
from collectors.gmymaps import meta_search


async def collect_editorial(ctx: GeoCtx) -> list[dict]:
    """Deep-link only — Wikiloc, AllTrails, Eventbrite, Sahapedia etc."""
    sites = [
        ("site:wikiloc.com", "Wikiloc", "adventure"),
        ("site:alltrails.com", "AllTrails", "adventure"),
        ("site:sahapedia.org", "Sahapedia", "culture"),
        ("site:eventbrite.com", "Eventbrite", "workshop"),
        ("site:meetup.com", "Meetup", "workshop"),
    ]

    hits = []
    for site_q, source_name, default_cat in sites:
        try:
            results = await meta_search(f'{site_q} "{ctx.city}"', 3)
            for r in results:
                hits.append({
                    "name": r["title"][:60],
                    "category": default_cat,
                    "source": source_name,
                    "source_url": r["url"],
                    "tags": ["editorial", source_name.lower()],
                })
        except Exception:
            pass

    return hits[:15]
