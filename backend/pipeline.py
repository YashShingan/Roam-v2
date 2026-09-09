# ─── Post-processing pipeline: transit filter → dedup → categorize → enrich ─
from __future__ import annotations

import hashlib
import re
from typing import Optional

from models import Category, Experience, CommunitySignal, SourceRef
from net import dedup_key, token_sim, haversine_km, hit_id
from services.price_engine import parse_price_snippets, aggregate_price_hint

# 1 ── Transit/road filter
DROP_RE = re.compile(
    r"(railway station|metro station|bus station|bus stop|railway|junction|terminus|halt|station|road|highway|expressway|flyover|overpass|underpass|bridge|viaduct|footpath|footway|path|track|trail|street|lane|gully|marg|creek)",
    re.I,
)
KEEP_RE = re.compile(
    r"(fort|killa|gad|heritage|historic|monument|palace|wada|gateway|gate|market|mandai|bazaar|bazar|mithai|sweet|farsan|bakery|bakers|cafe|chai)",
    re.I,
)

# Reject non-visitable places: schools, colleges, residential buildings, clinics, banks, etc.
NON_VISITABLE_RE = re.compile(
    r"\b(school|high\s*school|primary\s*school|secondary\s*school|convent|vidyalaya|shala|prathmik|madhyamik|kindergarten|pre-?school|nursery|playgroup|coaching|classes|tutorials|polytechnic|institute|junior\s*college|degree\s*college|college|university|vidyapeeth|campus|hostel|apartment|apartments|residency|heights|enclave|housing\s*society|co-?op\s*hsg|niwas|chawl|chambers|towers?|bungalow|villa|hospital|clinic|dispensary|pathology|diagnostic|maternity|nursing\s*home|dental|polyclinic|pharmacy|chemist|medical\s*store|bank|atm|branch|petrol\s*pump|cng\s*station|gas\s*station|service\s*station|garage|motor\s*driving|police\s*station|chowki|post\s*office|municipal\s*corporation|gram\s*panchayat|talathi|ward\s*office|court|hall\s*ticket|satta|matka|dpboss)\b",
    re.I,
)


def is_visitable_place(name: str, city: str) -> bool:
    n = name.strip().lower()
    c = city.strip().lower()

    # 1. City / administrative area itself
    if (
        n == c
        or n == f"{c} city"
        or n == f"{c} town"
        or n == f"{c} taluka"
        or n == f"{c} district"
        or n == f"{c}, maharashtra"
        or n == f"{c} junction"
        or n == f"{c} east"
        or n == f"{c} west"
        or n.startswith(f"{c} (")
    ):
        return False

    # 2. Reject non-visitable patterns
    if NON_VISITABLE_RE.search(n):
        return False

    # 3. Reject transit/roads unless historic/food/market
    if DROP_RE.search(n) and not KEEP_RE.search(n):
        return False

    return True

# 3 ── Categorize
CAT_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"(cafe|coffee|chai|bakery|restaurant|eatery|food court|food|misal|vada|samosa|mithai|sweet|farsan|ice.?cream|cuisine|dhaba|canteen)", re.I), "food"),
    (re.compile(r"(market|bazaar|bazar|mandai|emporium|mall|shopping|chowk|peth|souq)", re.I), "market"),
    (re.compile(r"(fort|kill[aā]|palace|mahal|museum|temple|mandir|mosque|dargah|church|basilica|cave|heritage|monument|wada|gad|art gallery|gallery|memorial park)", re.I), "culture"),
    (re.compile(r"(park|garden|lake|talav|hill|waterfall|falls|beach|viewpoint|view point|nature|forest|sanctuary|ghat)", re.I), "nature"),
    (re.compile(r"(trek|trail|hike|adventure|kayak|raft|camp)", re.I), "adventure"),
    (re.compile(r"(bar|pub|brewery|lounge|nightlife|club)", re.I), "nightlife"),
    (re.compile(r"(workshop|studio|pottery|artisan|craft|weaving|class)", re.I), "workshop"),
]

PRICE_EST = {
    "food": 220, "market": 180, "culture": 110, "nature": 0,
    "adventure": 700, "nightlife": 500, "workshop": 450, "hidden_gem": 140,
}

DURATION_EST = {
    "food": 45, "market": 90, "culture": 75, "nature": 60,
    "adventure": 180, "nightlife": 120, "workshop": 120, "hidden_gem": 60,
}

BEST_TIME = {
    "food": "Morning 8-11 AM or Evening 5-9 PM",
    "market": "Morning 10 AM - 1 PM",
    "culture": "Morning 9-11 AM (cooler, fewer crowds)",
    "nature": "Early morning or golden hour (sunset)",
    "adventure": "Early morning 6-9 AM",
    "nightlife": "Evening 8 PM onwards",
    "workshop": "Afternoon 2-5 PM",
    "hidden_gem": "Flexible — varies by place",
}

# Sentiment analysis
POS = re.compile(r"\b(good|great|amazing|best|lovely|love|delicious|awesome|beautiful|worth|excellent|hidden gem|must|fantastic|charming|friendly|fresh)\b", re.I)
NEG = re.compile(r"\b(bad|worst|avoid|overrated|dirty|crowded|expensive|skip|disappointing|stale|rude|smelly|boring|waste)\b", re.I)


def sentiment_of(quotes: list[dict]) -> float:
    if not quotes:
        return 0.0
    pos = neg = 0
    for q in quotes:
        text = q.get("text", "")
        p = bool(POS.search(text))
        n = bool(NEG.search(text))
        if p and not n:
            pos += 1
        elif n and not p:
            neg += 1
        elif p and n:
            pos += 0.5
    total = pos + neg
    return round((pos - neg) / total, 2) if total > 0 else 0.0


def categorize(hit: dict) -> str:
    if hit.get("category"):
        return hit["category"]
    text = f"{hit.get('name', '')} {' '.join(hit.get('tags', []))}"
    for pattern, cat in CAT_RULES:
        if pattern.search(text):
            return cat
    return "hidden_gem"


def open_now_from_hours(raw: str | None) -> bool | None:
    """Parse OSM opening_hours for a rough 'open now' check."""
    if not raw:
        return None
    from datetime import datetime
    now = datetime.now()
    day_names = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
    today = day_names[now.weekday()]
    hour = now.hour
    minute = now.minute

    if raw.strip().lower() == "24/7":
        return True

    # Simple parsing: "Mo-Fr 09:00-18:00; Sa 10:00-14:00"
    for rule in raw.split(";"):
        rule = rule.strip()
        if not rule:
            continue
        # Check if today matches the day range
        time_match = re.search(r"(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})", rule)
        if not time_match:
            continue
        oh, om, ch, cm = [int(x) for x in time_match.groups()]
        # Check day
        day_part = rule[:rule.index(time_match.group(0))].strip() if rule.index(time_match.group(0)) > 0 else ""
        if day_part:
            day_range = re.match(r"([A-Za-z]{2})(?:-([A-Za-z]{2}))?", day_part)
            if day_range:
                start_day = day_range.group(1)[:2].title()
                end_day = (day_range.group(2) or start_day)[:2].title()
                if start_day in day_names and end_day in day_names:
                    si = day_names.index(start_day)
                    ei = day_names.index(end_day)
                    ti = day_names.index(today)
                    if si <= ei:
                        if not (si <= ti <= ei):
                            continue
                    else:
                        if not (ti >= si or ti <= ei):
                            continue
        current = hour * 60 + minute
        open_min = oh * 60 + om
        close_min = ch * 60 + cm
        if open_min <= current <= close_min:
            return True
    return False


def run_pipeline(raw_hits: list[dict], city: str, lat: float, lon: float) -> list[Experience]:
    """Full post-processing: filter → dedup → categorize → enrich."""

    # 1 ── Transit & non-visitable filter (no schools, colleges, apartments, city names)
    filtered = []
    for h in raw_hits:
        name = h.get("name", "")
        if not is_visitable_place(name, city):
            continue
        filtered.append(h)

    # 2 ── Dedup
    merged: dict[str, dict] = {}
    for h in filtered:
        key = dedup_key(h.get("name", ""))
        if not key:
            continue

        existing = None
        existing_key = None
        for mk, mv in merged.items():
            # Exact key match
            if mk == key:
                existing = mv
                existing_key = mk
                break
            # Token similarity
            if token_sim(key, mk) >= 85:
                existing = mv
                existing_key = mk
                break
            # Proximity + partial similarity
            if (
                h.get("lat") and mv.get("lat")
                and haversine_km(h["lat"], h.get("lon", 0), mv["lat"], mv.get("lon", 0)) <= 0.12
                and token_sim(key, mk) >= 60
            ):
                existing = mv
                existing_key = mk
                break

        if existing:
            # Merge: union sources, keep richest
            src = existing.get("_sources", [])
            new_src = h.get("source", "")
            if new_src and new_src not in [s.get("source") for s in src]:
                src.append({"source": new_src, "url": h.get("source_url"), "note": None})
            existing["_sources"] = src
            # Keep richer description
            if h.get("description") and (not existing.get("description") or len(h["description"]) > len(existing.get("description", ""))):
                existing["description"] = h["description"]
            # Accumulate quotes
            existing.setdefault("_quotes", []).extend(h.get("quotes", []))
            existing["_mentions"] = existing.get("_mentions", 0) + h.get("mentions", 0)
            existing["_upvotes"] = existing.get("_upvotes", 0) + h.get("upvotes", 0)
            # Keep coordinates if missing
            if not existing.get("lat") and h.get("lat"):
                existing["lat"] = h["lat"]
                existing["lon"] = h.get("lon")
            # Keep image
            if not existing.get("image_url") and h.get("image_url"):
                existing["image_url"] = h["image_url"]
            # Better popularity
            if (h.get("popularity") or 0) > (existing.get("_pop_score") or 0):
                existing["_pop_score"] = h.get("popularity", 0)
                existing["_pop_note"] = h.get("popularityNote")
        else:
            h["_sources"] = [{"source": h.get("source", ""), "url": h.get("source_url"), "note": None}]
            h["_quotes"] = h.get("quotes", [])
            h["_mentions"] = h.get("mentions", 0)
            h["_upvotes"] = h.get("upvotes", 0)
            h["_pop_score"] = h.get("popularity", 0)
            h["_pop_note"] = h.get("popularityNote")
            merged[key] = h

    # 3 ── Build Experience objects
    experiences: list[Experience] = []
    for h in merged.values():
        name = h.get("name", "")
        cat_str = categorize(h)
        try:
            cat = Category(cat_str)
        except ValueError:
            cat = Category.hidden_gem

        sources = [SourceRef(**s) for s in h.get("_sources", []) if s.get("source")]
        source_label = " + ".join(dict.fromkeys(s.source for s in sources))

        quotes = h.get("_quotes", [])[:10]
        mentions = max(h.get("_mentions", 0), len(quotes))
        upvotes = h.get("_upvotes", 0)
        sentiment = sentiment_of(quotes)

        # Hidden gem: few mentions but positive
        hidden_gem = mentions > 0 and mentions < 15 and sentiment >= 0.3

        # Crowd warning
        crowd_warning = any(
            re.search(r"crowded|queue|rush|packed|busy", q.get("text", ""), re.I)
            for q in quotes
        )

        # Popularity string
        pop_score = float(h.get("_pop_score") or 0)
        pop_note = h.get("_pop_note")
        if pop_note:
            popularity = pop_note
        elif mentions > 0:
            popularity = f"🗣 {mentions} community mention{'s' if mentions > 1 else ''}"
        else:
            popularity = "New — no community signal yet"

        # Price extraction from description + quotes
        price_samples = []
        if h.get("description"):
            price_samples.extend(parse_price_snippets(h["description"], source="description", category=cat_str))
        for q in quotes:
            text = q.get("text", "") if isinstance(q, dict) else getattr(q, "text", "")
            if text:
                price_samples.extend(parse_price_snippets(text, source="community_quote", category=cat_str))

        price_hint = aggregate_price_hint(price_samples, category=cat_str)
        if price_hint:
            price = int(price_hint.per_person) if price_hint.per_person is not None else None
            price_is_estimate = (price_hint.confidence < 0.7)
        else:
            price = None
            price_is_estimate = None

        # Duration
        duration = DURATION_EST.get(cat_str, 60)

        # Distance from center
        p_lat = h.get("lat")
        p_lon = h.get("lon")
        dist = haversine_km(lat, lon, p_lat, p_lon) if p_lat and p_lon else None

        # gmaps URL & direct Turn-by-Turn Directions URL
        gmaps_url = (
            f"https://www.google.com/maps/search/?api=1&query={p_lat},{p_lon}"
            if p_lat and p_lon else None
        )
        gmaps_directions_url = (
            f"https://www.google.com/maps/dir/?api=1&destination={p_lat},{p_lon}"
            if p_lat and p_lon else None
        )

        # Unique ID
        exp_id = hashlib.sha256(f"{source_label}:{name}:{p_lat or 0}".encode()).hexdigest()[:16]

        exp = Experience(
            id=exp_id,
            name=name,
            category=cat,
            source=source_label,
            sources=sources,
            description=h.get("description"),
            lat=p_lat,
            lon=p_lon,
            address=h.get("address") or "Not listed",
            popularity=popularity,
            popularityScore=min(pop_score if pop_score else (mentions / 100), 1.0),
            community=CommunitySignal(
                mentions=mentions,
                upvotes=upvotes,
                sentiment=sentiment,
                quotes=quotes,
                priceHint=price,
                crowdWarning=crowd_warning or None,
                hiddenGem=hidden_gem or None,
            ),
            pricePerPerson=price,
            priceIsEstimate=price_is_estimate,
            priceHint=price_hint,
            durationMinutes=duration,
            openingHoursRaw=h.get("opening_hours"),
            isOutdoor=h.get("outdoor"),
            wheelchairAccessible=h.get("wheelchair"),
            bookingRequired=False,
            tags=h.get("tags", []),
            imageUrl=h.get("image_url"),
            amenities=[],
            osmId=h.get("osm_id"),
            osmType=h.get("osm_type"),
            website=h.get("website"),
            gmapsUrl=gmaps_url,
            gmapsDirectionsUrl=gmaps_directions_url,
            bestTime=BEST_TIME.get(cat_str),
            goldenHour=cat_str in ("nature", "adventure"),
            distanceKm=round(dist, 2) if dist else None,
        )
        experiences.append(exp)

    # Sort by popularity score desc
    experiences.sort(key=lambda e: e.popularityScore, reverse=True)
    return experiences
