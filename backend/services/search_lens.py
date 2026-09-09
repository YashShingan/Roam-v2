# ─── Search Lens: SERP Text Mining & Gap-Filler ──────────────────────────────
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
from net import haversine_km, dedup_key
from db import get_db, load_places_for_city, upsert_places, save_search_candidate, save_price_samples, update_place_price_hint
from services.price_engine import parse_price_snippets, aggregate_price_hint
from pipeline import is_visitable_place

# Disk cache directory for SERP
CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "serp_cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# Engine circuit breakers & pacing locks
_engine_locks: dict[str, asyncio.Lock] = {}
_engine_last_call: dict[str, float] = {}
_engine_failures: dict[str, int] = {}
_engine_cooldown_until: dict[str, float] = {}

PACING_INTERVAL = 1.2  # 1 call per 1.2s max per engine
COOLDOWN_SECONDS = 60.0  # 1 min cooldown on 3 consecutive fails

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def _get_engine_lock(engine: str) -> asyncio.Lock:
    if engine not in _engine_locks:
        _engine_locks[engine] = asyncio.Lock()
    return _engine_locks[engine]


def _is_engine_available(engine: str) -> bool:
    cooldown = _engine_cooldown_until.get(engine, 0.0)
    return time.time() >= cooldown


def _record_engine_success(engine: str) -> None:
    _engine_failures[engine] = 0


def _record_engine_failure(engine: str) -> None:
    fails = _engine_failures.get(engine, 0) + 1
    _engine_failures[engine] = fails
    if fails >= 3:
        _engine_cooldown_until[engine] = time.time() + COOLDOWN_SECONDS


async def _pace_engine(engine: str) -> None:
    lock = _get_engine_lock(engine)
    async with lock:
        now = time.time()
        elapsed = now - _engine_last_call.get(engine, 0.0)
        if elapsed < PACING_INTERVAL:
            await asyncio.sleep(PACING_INTERVAL - elapsed)
        _engine_last_call[engine] = time.time()


# ─── SERP Fetchers ───────────────────────────────────────────────────────────
async def fetch_serp_duckduckgo(query: str) -> list[dict[str, str]]:
    """DuckDuckGo HTML POST search."""
    if not _is_engine_available("duckduckgo"):
        return []
    await _pace_engine("duckduckgo")

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.post("https://html.duckduckgo.com/html/", data={"q": query}, headers=HEADERS)
            if resp.status_code in (200, 202):
                _record_engine_success("duckduckgo")
                soup = BeautifulSoup(resp.text, "html.parser")
                results = []
                for r in soup.select(".result"):
                    a_tag = r.select_one(".result__title a.result__a")
                    snippet_tag = r.select_one(".result__snippet")
                    if a_tag:
                        raw_link = a_tag.get("href", "")
                        title = a_tag.get_text(strip=True)
                        snippet = snippet_tag.get_text(strip=True) if snippet_tag else ""
                        if "uddg=" in raw_link:
                            try:
                                m = re.search(r"uddg=([^&]+)", raw_link)
                                if m:
                                    raw_link = urllib.parse.unquote(m.group(1))
                            except Exception:
                                pass
                        if not any(spam in f"{title} {snippet}".lower() for spam in SPAM_TERMS):
                            results.append({"title": title, "snippet": snippet, "url": raw_link})
                return results
    except Exception:
        _record_engine_failure("duckduckgo")
    return []


async def fetch_serp_bing(query: str) -> list[dict[str, str]]:
    """Bing HTML search."""
    if not _is_engine_available("bing"):
        return []
    await _pace_engine("bing")

    url = f"https://www.bing.com/search?q={urllib.parse.quote(query)}"
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=HEADERS)
            if resp.status_code != 200:
                _record_engine_failure("bing")
                return []
            _record_engine_success("bing")
            soup = BeautifulSoup(resp.text, "html.parser")
            results = []
            for item in soup.select("li.b_algo"):
                h2_a = item.select_one("h2 a")
                p_tag = item.select_one(".b_caption p, .b_algoDesc")
                if h2_a:
                    title = h2_a.get_text(strip=True)
                    link = h2_a.get("href", "")
                    snippet = p_tag.get_text(strip=True) if p_tag else ""
                    if not any(spam in f"{title} {snippet}".lower() for spam in SPAM_TERMS):
                        results.append({"title": title, "snippet": snippet, "url": link})
            return results
    except Exception:
        _record_engine_failure("bing")
        return []


async def fetch_serp_mojeek(query: str) -> list[dict[str, str]]:
    """Mojeek search."""
    if not _is_engine_available("mojeek"):
        return []
    await _pace_engine("mojeek")

    url = f"https://www.mojeek.com/search?q={urllib.parse.quote(query)}"
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=HEADERS)
            if resp.status_code != 200:
                _record_engine_failure("mojeek")
                return []
            _record_engine_success("mojeek")
            soup = BeautifulSoup(resp.text, "html.parser")
            results = []
            for item in soup.select(".results-standard li, ul.results li"):
                a_tag = item.select_one("a.title, h2 a")
                p_tag = item.select_one("p.snippet, p")
                if a_tag:
                    title = a_tag.get_text(strip=True)
                    link = a_tag.get("href", "")
                    snippet = p_tag.get_text(strip=True) if p_tag else ""
                    results.append({"title": title, "snippet": snippet, "url": link})
            return results
    except Exception:
        _record_engine_failure("mojeek")
        return []


# ─── Query Templates ─────────────────────────────────────────────────────────
SPAM_TERMS = {
    "satta", "matka", "dpboss", "dp boss", "chart", "lottery", "kalyanchart",
    "jeweller", "jewellers", "result", "guessing", "bazar result", "panel chart",
    "open close", "fix jodi", "mumbai chart",
}


def generate_queries(city: str) -> list[tuple[str, str]]:
    """Returns list of (engine, query) tailored per spec §2.1."""
    templates = [
        ("duckduckgo", f"{city} best cafe"),
        ("duckduckgo", f'{city} "hidden gem" food'),
        ("duckduckgo", f"{city} market shopping guide"),
        ("duckduckgo", f"{city} fort heritage timings"),
        ("duckduckgo", f"{city} famous temple"),
        ("duckduckgo", f"{city} street food price"),
        ("duckduckgo", f"{city} प्रसिद्ध मंदिरे"),
        ("duckduckgo", f"{city} मार्केट"),
    ]
    return templates


# ─── Venue Name Extraction & Category Inference ──────────────────────────────
STOPWORDS_VENUE = {
    "top", "best", "the", "in", "near", "famous", "list", "guide", "visit", "to",
    "places", "place", "things", "do", "must", "see", "tripadvisor", "zomato",
    "justdial", "holidify", "thrillophilia", "hotels", "review", "reviews",
    "travel", "tourist", "tourism", "attractions", "hidden", "gems", "food",
    "photos", "ratings", "city", "overview", "online", "official", "maharashtra",
    "india", "kalyan", "explore", "popular", "discover",
}

CATEGORY_KEYWORDS = {
    Category.food: ["cafe", "restaurant", "hotel", "dhaba", "thali", "chai", "snack", "biryani", "food", "kitchen", "sweets", "bakery", "pav", "bhurji", "kulfi", "dosa", "idli"],
    Category.culture: ["fort", "temple", "mandir", "masjid", "church", "museum", "palace", "samadhi", "heritage", "monument", "memorial", "dargah", "ashram"],
    Category.nature: ["lake", "talao", "dam", "waterfall", "park", "garden", "hill", "point", "sanctuary", "river", "forest", "falls", "talav"],
    Category.market: ["market", "bazaar", "bazar", "shopping", "lane", "road", "street", "mandi", "galli"],
    Category.adventure: ["trek", "trekking", "camping", "paragliding", "resort", "waterpark"],
    Category.nightlife: ["bar", "lounge", "brewery", "pub"],
}


def infer_category(name: str, snippet: str) -> Category:
    text = f"{name} {snippet}".lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if re.search(rf"\b{kw}\b", text):
                return cat
    return Category.hidden_gem


def extract_candidate_names(title: str, snippet: str, city: str) -> list[str]:
    """Extract clean venue names from title and snippet, strictly filtering spam."""
    candidates = []
    combined = f"{title}. {snippet}"
    
    # Check if title or snippet is gambling spam
    lower_check = combined.lower()
    if any(spam in lower_check for spam in SPAM_TERMS):
        return []

    # 1. Clean Title candidate
    clean_title = re.sub(r"\s*[-–|•·].*$", "", title)
    clean_title = re.sub(r"^(?:\d+\s*(?:best|top)\s+.*?\s+in\s+)", "", clean_title, flags=re.IGNORECASE)
    clean_title = re.sub(rf"\b{city}\b", "", clean_title, flags=re.IGNORECASE)
    clean_title = re.sub(r"\bmaharashtra\b", "", clean_title, flags=re.IGNORECASE).strip()

    words = clean_title.split()
    if 1 <= len(words) <= 5 and 3 <= len(clean_title) <= 35:
        if not all(w.lower() in STOPWORDS_VENUE for w in words):
            if not any(spam in clean_title.lower() for spam in SPAM_TERMS):
                candidates.append(clean_title)

    # 2. Extract landmark/venue patterns (e.g. "Durgadi Fort", "Kala Talao", "Shiv Mandir")
    landmark_keywords = r"Fort|Talao|Talav|Lake|Mandir|Temple|Garden|Park|Chowk|Galli|Bazaar|Market|Waterfall|Dam"
    for match in re.finditer(rf"\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){{0,3}}\s+(?:{landmark_keywords}))\b", combined):
        cand = match.group(1).strip()
        if not any(spam in cand.lower() for spam in SPAM_TERMS):
            c_words = [w for w in cand.split() if w.lower() not in STOPWORDS_VENUE]
            if len(c_words) >= 1:
                candidates.append(" ".join(c_words))

    # 3. Look for quoted venues or 'at/near XYZ' in snippet
    for match in re.finditer(r'\b(?:visit|at|near|famous)\s+([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){1,3})\b', snippet):
        cand = match.group(1).strip()
        if cand.lower() not in STOPWORDS_VENUE:
            if not any(spam in cand.lower() for spam in SPAM_TERMS):
                candidates.append(cand)

    # Sanitize and deduplicate
    cleaned_candidates = []
    for cand in candidates:
        cand = re.sub(r"[(){}\[\]<>\"']", "", cand).strip()
        cand = re.sub(rf"^{city}\s*", "", cand, flags=re.IGNORECASE).strip()
        cand = re.sub(r"\b(guide|official|online|prices?|website|tripadvisor|photos?|reviews?|information|more info)\b", "", cand, flags=re.IGNORECASE).strip()
        c_words = [w for w in cand.split() if w.lower() not in STOPWORDS_VENUE]
        cand = " ".join(c_words).strip().title()
        if 1 <= len(c_words) <= 5 and 4 <= len(cand) <= 35:
            if cand.isdigit():
                continue
            generic_words = {"street", "temple", "fort", "market", "hotel", "cafe", "garden", "lake", "food", "mandir", "road", "city", "place", "mumbai", "pune", "thane", "delhi", "india", "kalyan", "center", "centre", "point", "hill", "bazaar"}
            if len(c_words) == 1 and c_words[0].lower() in generic_words:
                continue
            if cand.lower() in {city.lower(), "maharashtra", "india", f"{city.lower()}, maharashtra"}:
                continue
            if cand.lower() not in STOPWORDS_VENUE and not any(spam in cand.lower() for spam in SPAM_TERMS):
                if is_visitable_place(cand, city) and cand not in cleaned_candidates:
                    cleaned_candidates.append(cand)

    return cleaned_candidates


# ─── Geocoding with Rate Limiting (Nominatim) ────────────────────────────────
_nominatim_last_call = 0.0
_nominatim_lock = asyncio.Lock()


async def geocode_place(name: str, city: str) -> Optional[dict[str, float]]:
    global _nominatim_last_call
    async with _nominatim_lock:
        now = time.time()
        elapsed = now - _nominatim_last_call
        if elapsed < 1.1:
            await asyncio.sleep(1.1 - elapsed)
        _nominatim_last_call = time.time()

    url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(f'{name}, {city}')}&format=json&limit=1"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers={"User-Agent": "RoamTravelApp/1.0 (open-source community signal)"})
            if resp.status_code == 200:
                data = resp.json()
                if data and len(data) > 0:
                    return {"lat": float(data[0]["lat"]), "lon": float(data[0]["lon"])}
    except Exception:
        pass
    return None


# ─── Main Search Lens Mining Pipeline ────────────────────────────────────────
async def run_search_lens(
    city: str,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius_km: float = 15.0,
    max_geocodes: int = 25,
) -> dict[str, Any]:
    """Mine open search results for new venue candidates and price snippets."""
    queries = generate_queries(city)
    all_snippets: list[dict[str, str]] = []
    engines_used = set()

    # 1. Fetch search results across engines
    for engine, q in queries[:10]:
        cache_key = hashlib.md5(f"{engine}:{q}".encode()).hexdigest()
        cache_file = os.path.join(CACHE_DIR, f"{cache_key}.json")

        results = None
        if os.path.exists(cache_file):
            try:
                # 6 hours cache
                if time.time() - os.path.getmtime(cache_file) < 21600:
                    with open(cache_file, "r", encoding="utf-8") as f:
                        results = json.load(f)
            except Exception:
                pass

        if results is None:
            if engine == "duckduckgo":
                results = await fetch_serp_duckduckgo(q)
            elif engine == "bing":
                results = await fetch_serp_bing(q)
            elif engine == "mojeek":
                results = await fetch_serp_mojeek(q)
            else:
                results = []

            if results:
                try:
                    with open(cache_file, "w", encoding="utf-8") as f:
                        json.dump(results, f)
                except Exception:
                    pass

        if results:
            engines_used.add(engine)
            for r in results:
                r["engine"] = engine
                r["query"] = q
            all_snippets.extend(results)

    # 2. Load existing places to check duplicates
    existing_places = await load_places_for_city(city, limit=500)
    existing_names = [p.name.lower() for p in existing_places]

    candidates_found: list[str] = []
    added_places: list[Experience] = []
    seen_candidates: set[str] = set()
    merged_count = 0
    skipped_count = 0
    geocode_budget = max_geocodes

    for item in all_snippets:
        title = item.get("title", "")
        snippet = item.get("snippet", "")
        url = item.get("url", "")
        engine = item.get("engine", "")
        query = item.get("query", "")

        names = extract_candidate_names(title, snippet, city)
        for cand_name in names:
            if not cand_name or len(cand_name) < 3:
                continue

            norm_name = cand_name.lower()
            if norm_name in seen_candidates:
                continue
            seen_candidates.add(norm_name)

            candidates_found.append(cand_name)

            # Dedupe check vs existing DB using token similarity
            is_dup = False
            for ex in existing_places:
                sim = fuzz.token_sort_ratio(norm_name, ex.name.lower())
                if sim >= 85:
                    is_dup = True
                    # Price pass on matched place
                    p_samples = parse_price_snippets(f"{title}. {snippet}", source="search_lens", url=url, category=ex.category.value)
                    if p_samples:
                        await save_price_samples(ex.id, p_samples)
                        all_stored = await load_price_samples(ex.id)
                        from services.price_engine import PriceSample
                        re_samples = [PriceSample(**s) for s in all_stored] if all_stored else p_samples
                        hint = aggregate_price_hint(re_samples, category=ex.category.value)
                        await update_place_price_hint(ex.id, hint, sample_count=len(re_samples))
                    merged_count += 1
                    await save_search_candidate(cand_name, city, engine, query, url, "merged", f"Matched {ex.name} (sim={sim})")
                    break

            if is_dup:
                continue

            # If not duplicate, attempt geocoding within budget
            if geocode_budget <= 0:
                skipped_count += 1
                await save_search_candidate(cand_name, city, engine, query, url, "no_geo", "Geocode budget exhausted")
                continue

            geo = await geocode_place(cand_name, city)
            geocode_budget -= 1

            if not geo:
                skipped_count += 1
                await save_search_candidate(cand_name, city, engine, query, url, "no_geo", "Nominatim returned no result")
                continue

            # Radius check if center is provided
            p_lat, p_lon = geo["lat"], geo["lon"]
            if lat is not None and lon is not None:
                dist = haversine_km(lat, lon, p_lat, p_lon)
                if dist > radius_km * 1.5:
                    skipped_count += 1
                    await save_search_candidate(cand_name, city, engine, query, url, "out_of_radius", f"Distance {dist:.1f}km > {radius_km*1.5}km")
                    continue

            # Infer category
            cat = infer_category(cand_name, snippet)

            # Mine prices from snippet
            price_samples = parse_price_snippets(f"{title}. {snippet}", source="search_lens", url=url, category=cat.value)
            price_hint = aggregate_price_hint(price_samples, category=cat.value)

            # Create place
            place_id = hashlib.sha256(f"search_lens:{cand_name}:{p_lat}".encode()).hexdigest()[:16]
            new_place = Experience(
                id=place_id,
                name=cand_name,
                category=cat,
                source="Search Lens",
                sources=[SourceRef(source="Search Lens", url=url, note=f"Mined via {engine}")],
                description=snippet[:300] if snippet else f"{cand_name} in {city}, discovered via web search.",
                lat=p_lat,
                lon=p_lon,
                address=f"{city}, India",
                popularity="Discovered via open web search",
                popularityScore=0.5,
                community=CommunitySignal(
                    mentions=1,
                    sentiment=0.3,
                    quotes=[{"text": snippet[:200], "permalink": url}] if snippet else [],
                    priceHint=int(price_hint.per_person) if (price_hint and price_hint.per_person) else None,
                ),
                pricePerPerson=int(price_hint.per_person) if (price_hint and price_hint.per_person) else None,
                priceIsEstimate=(price_hint.confidence < 0.7) if price_hint else None,
                priceHint=price_hint,
                foundViaSearch=True,
            )

            added_places.append(new_place)
            existing_places.append(new_place)
            if price_samples:
                await save_price_samples(new_place.id, price_samples)
            await save_search_candidate(cand_name, city, engine, query, url, "added", "Successfully pinned place")

    # Persist newly added places to DB
    if added_places:
        await upsert_places(city, added_places)

    return {
        "city": city,
        "snippets_mined": len(all_snippets),
        "candidates_found": len(candidates_found),
        "added": len(added_places),
        "merged": merged_count,
        "skipped": skipped_count,
        "engines_used": list(engines_used),
        "added_names": [p.name for p in added_places],
    }
