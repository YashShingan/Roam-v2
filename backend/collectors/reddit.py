# ─── Reddit + PullPush collector (venue mining from community threads) ───────
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from models import GeoCtx
from net import fetch_json, fetch_text, hit_id, haversine_km

BLACKLIST_RE = re.compile(
    r"^(this|that|there|here|it|them|the place|place|map|google|maps|india|mumbai|pune|kalyan|thane|delhi|market|bazaar|bazar|fort|temple|cafe|coffee|food|street|area|city|town|morning|evening|today|tomorrow|one|two|three|video|channel|guy|people|anyone|someone|budget|trip|travel|vlog|day|days|hour|hours)$",
    re.I,
)

VERB_RE = re.compile(
    r"\b(?:try|visit|check out|checkout|explore|head to|go to|went to|stop at|stopped at|eat at|dine at|don't miss|must visit|must-see|recommends?|recommended?)\s+(?:the\s+|a\s+)?([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,3})",
)


def proper_nouns(sentence: str) -> list[str]:
    out = set()
    # Quoted phrases
    for m in re.finditer(r'["\u201c\u201d\'"]([A-Z][^"\u201c\u201d\'\"]{2,40})["\u201c\u201d\'"]', sentence):
        out.add(m.group(1).strip())
    # After discovery verbs
    for m in VERB_RE.finditer(sentence):
        out.add(m.group(1).strip())
    return [
        n.rstrip(".,!?;:")
        for n in out
        if 3 <= len(n) <= 42 and re.search(r"[a-zA-Z]", n) and not BLACKLIST_RE.match(n) and not n[0].isdigit()
    ]


def mine_sentences(text: str) -> list[str]:
    text = re.sub(r"https?://\S+", " ", text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'")
    text = re.sub(r"\s+", " ", text)
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if 25 <= len(s.strip()) <= 300]


def source_category(text: str) -> str | None:
    n = text.lower()
    if re.search(r"fort|palace|museum|temple|heritage|history|cave", n): return "culture"
    if re.search(r"market|bazaar|bazar|shopping|mall", n): return "market"
    if re.search(r"cafe|coffee|food|eat|restaurant|bakery|samosa|vada|misal|street food", n): return "food"
    if re.search(r"park|lake|hill|waterfall|sunset|nature|beach", n): return "nature"
    if re.search(r"trek|trail|hike|adventure|kayak|raft", n): return "adventure"
    if re.search(r"bar|pub|brewery|lounge", n): return "nightlife"
    if re.search(r"workshop|studio|pottery|art class|craft", n): return "workshop"
    return None


async def geocode_candidates(names: list[str], ctx: GeoCtx, cap: int) -> list[dict]:
    import asyncio
    from pipeline import is_visitable_place
    unique = list(dict.fromkeys(n for n in names if is_visitable_place(n, ctx.city)))[:cap * 2]
    out = []
    for batch_start in range(0, len(unique), 4):
        batch = unique[batch_start:batch_start + 4]
        tasks = []
        for name in batch:
            async def _geo(n=name):
                try:
                    j = await fetch_json(
                        f"https://photon.komoot.io/api/?q={n} {ctx.city}&limit=1&lang=en",
                        timeout_ms=7000, retries=0,
                    )
                    f = (j.get("features") or [None])[0]
                    if not f: return None
                    lat = f["geometry"]["coordinates"][1]
                    lon = f["geometry"]["coordinates"][0]
                    if haversine_km(ctx.lat, ctx.lon, lat, lon) > ctx.radiusKm * 1.6:
                        return None
                    return {"name": n, "lat": lat, "lon": lon}
                except Exception:
                    return None
            tasks.append(_geo())
        results = await asyncio.gather(*tasks)
        for r in results:
            if r:
                out.append(r)
        if len(out) >= cap:
            break
    return out[:cap]


async def collect_reddit(ctx: GeoCtx) -> list[dict]:
    texts = []

    # Reddit RSS
    try:
        rss = await fetch_text(
            f'https://www.reddit.com/search.rss?q={ctx.city} (cafe OR market OR fort OR bazaar OR "check out" OR "must visit")&sort=top&t=year&limit=40',
            timeout_ms=12000, retries=0,
            headers={"Accept-Language": "en-IN"},
        )
        root = ET.fromstring(rss)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall(".//atom:entry", ns):
            title = (entry.findtext("atom:title", "", ns) or "")
            content = (entry.findtext("atom:content", "", ns) or "")
            link_el = entry.find("atom:link", ns)
            link = link_el.get("href", "") if link_el is not None else ""
            texts.append({"text": f"{title}. {content}", "permalink": link, "score": 0})
    except Exception:
        pass

    # PullPush
    try:
        pp = await fetch_json(
            f"https://api.pullpush.io/reddit/search/submission/?q={ctx.city}&size=50&sort_type=score&sort=desc",
            timeout_ms=15000, retries=0,
        )
        for s in pp.get("data", []):
            if (s.get("score", 0)) < 3:
                continue
            texts.append({
                "text": f"{s.get('title', '')}. {s.get('selftext', '')}",
                "permalink": f"https://www.reddit.com{s['permalink']}" if s.get("permalink") else None,
                "score": s.get("score", 0),
            })
    except Exception:
        pass

    hits = []
    for t in texts[:60]:
        for sentence in mine_sentences(t["text"]):
            if not re.search(r"\b(try|visit|check out|explore|head to|go to|eat|grab|recommend|must|best)\b", sentence, re.I):
                continue
            city_word = ctx.city.split()[0]
            if not re.search(city_word, sentence, re.I) and not source_category(sentence):
                continue
            for name in proper_nouns(sentence):
                hits.append({
                    "name": name,
                    "category": source_category(sentence) or "hidden_gem",
                    "source": "Reddit",
                    "source_url": t.get("permalink"),
                    "mentions": 1,
                    "upvotes": t.get("score", 0),
                    "quotes": [{"text": sentence.strip(), "permalink": t.get("permalink")}],
                    "tags": ["reddit"],
                })
                if len(hits) > 80:
                    break
            if len(hits) > 80:
                break
        if len(hits) > 80:
            break

    # Geocode top names
    name_counts: dict[str, int] = {}
    for h in hits[:60]:
        name_counts[h["name"]] = name_counts.get(h["name"], 0) + 1
    top_names = sorted(name_counts, key=name_counts.get, reverse=True)[:10]
    geocoded = await geocode_candidates(top_names, ctx, 10)
    by_name = {g["name"].lower(): g for g in geocoded}

    for h in hits:
        g = by_name.get(h["name"].lower())
        if g:
            h["lat"] = g["lat"]
            h["lon"] = g["lon"]

    return [h for h in hits if h.get("lat") is not None or h.get("quotes")][:40]
