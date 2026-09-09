# ─── Stats route ─────────────────────────────────────────────────────────────
from __future__ import annotations

from collections import Counter
from fastapi import APIRouter, Query

from routes.places import get_places_for_city
from models import Experience

router = APIRouter()


@router.get("/stats")
async def stats_route(city: str = Query(...)):
    try:
        result = await get_places_for_city(city)
        places = [Experience.model_validate(p) for p in result["places"]]

        by_cat = Counter(p.category.value for p in places)
        mentions_total = sum(p.community.mentions for p in places)

        # Sentiment histogram
        buckets = {"very_negative": 0, "negative": 0, "neutral": 0, "positive": 0, "very_positive": 0}
        for p in places:
            s = p.community.sentiment
            if s <= -0.5:
                buckets["very_negative"] += 1
            elif s < 0:
                buckets["negative"] += 1
            elif s == 0:
                buckets["neutral"] += 1
            elif s < 0.5:
                buckets["positive"] += 1
            else:
                buckets["very_positive"] += 1

        # Top mentioned
        top = sorted(places, key=lambda p: p.community.mentions, reverse=True)[:8]
        top_mentioned = [{"name": p.name, "mentions": p.community.mentions} for p in top if p.community.mentions > 0]

        # Source counts
        src_counter: Counter = Counter()
        for p in places:
            for s in p.sources:
                src_counter[s.source] += 1
        source_counts = [{"source": s, "count": c} for s, c in src_counter.most_common(15)]

        # Radar
        radar = []
        for cat in by_cat:
            cat_places = [p for p in places if p.category.value == cat]
            signal = sum(p.community.mentions for p in cat_places)
            radar.append({"category": cat, "signal": signal, "variety": len(cat_places)})

        # Avg price
        priced = [p.pricePerPerson for p in places if p.pricePerPerson and not p.priceIsEstimate]
        avg_price = sum(priced) / len(priced) if priced else None

        return {
            "city": city,
            "total": len(places),
            "byCategory": dict(by_cat),
            "mentionsTotal": mentions_total,
            "sentimentHistogram": [{"bucket": k, "count": v} for k, v in buckets.items()],
            "topMentioned": top_mentioned,
            "sourceCounts": source_counts,
            "radar": radar,
            "avgPrice": avg_price,
        }
    except Exception as e:
        return {"city": city, "total": 0, "byCategory": {}, "mentionsTotal": 0,
                "sentimentHistogram": [], "topMentioned": [], "sourceCounts": [],
                "radar": [], "avgPrice": None}
