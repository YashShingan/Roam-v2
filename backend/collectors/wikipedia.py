# ─── Wikipedia multilingual geosearch + pageviews + extracts ─────────────────
from __future__ import annotations

import asyncio
import re
import urllib.parse
from models import GeoCtx
from net import fetch_json, hit_id


def wiki_api(lang: str, params: dict) -> str:
    base = {"format": "json", "formatversion": "2", **params}
    qs = urllib.parse.urlencode(base)
    return f"https://{lang}.wikipedia.org/w/api.php?{qs}"


def wiki_category(title: str) -> str | None:
    n = title.lower()
    if re.search(r"fort|palace|museum|temple|mandir|mosque|church|cave|heritage|monument|memorial garden", n):
        return "culture"
    if re.search(r"market|bazaar|bazar|mandai|mall|shopping", n):
        return "market"
    if re.search(r"park|lake|garden|hill|falls|waterfall|beach|sanctuary|forest", n):
        return "nature"
    if re.search(r"cafe|restaurant|hotel", n):
        return "food"
    if re.search(r"station|airport|stadium|college|university|school|hospital|office|building|tower bridge", n):
        return None
    return "culture"


async def collect_wikipedia(ctx: GeoCtx) -> list[dict]:
    langs = ["en", "mr", "hi"]
    all_hits = []
    en_titles = []

    # Geosearch across languages
    async def geo_search(lang: str):
        return await fetch_json(
            wiki_api(lang, {
                "action": "query",
                "list": "geosearch",
                "gscoord": f"{ctx.lat}|{ctx.lon}",
                "gsradius": "10000",
                "gslimit": "50",
            }),
            timeout_ms=12000, retries=1,
            headers={"Api-User-Agent": "RoamApp/1.0"},
        )

    results = await asyncio.gather(*[geo_search(l) for l in langs], return_exceptions=True)

    for i, r in enumerate(results):
        if isinstance(r, Exception):
            continue
        for g in r.get("query", {}).get("geosearch", []):
            lang = langs[i]
            is_en = lang == "en"
            cat = wiki_category(g.get("title", ""))
            hit = {
                "name": g["title"],
                "lat": g.get("lat"),
                "lon": g.get("lon"),
                "category": cat,
                "source": f"Wikipedia ({lang})",
                "source_url": f"https://{lang}.wikipedia.org/?curid={g['pageid']}",
                "tags": [lang],
            }
            all_hits.append(hit)
            if is_en:
                en_titles.append({"title": g["title"], "pageid": g["pageid"]})

    # Category mining
    try:
        cat_data = await fetch_json(
            wiki_api("en", {
                "action": "query",
                "list": "categorymembers",
                "cmtitle": f"Category:Tourist attractions in {ctx.city}",
                "cmlimit": "50",
                "cmprop": "ids|title",
            }),
            timeout_ms=10000, retries=0,
        )
        members = cat_data.get("query", {}).get("categorymembers", [])
        if members:
            titles_str = "|".join(m["title"] for m in members[:50])
            coords_data = await fetch_json(
                wiki_api("en", {
                    "action": "query",
                    "prop": "coordinates",
                    "coprimary": "primary",
                    "colimit": "max",
                    "titles": titles_str,
                }),
                timeout_ms=12000, retries=0,
            )
            for p in coords_data.get("query", {}).get("pages", {}).values() if isinstance(coords_data.get("query", {}).get("pages"), dict) else coords_data.get("query", {}).get("pages", []):
                if isinstance(p, dict):
                    c = (p.get("coordinates") or [{}])[0] if p.get("coordinates") else None
                    if c and "lat" in c:
                        all_hits.append({
                            "name": p.get("title", ""),
                            "lat": c["lat"],
                            "lon": c["lon"],
                            "category": wiki_category(p.get("title", "")),
                            "source": "Wikipedia (en)",
                            "source_url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(p.get('title', '').replace(' ', '_'))}",
                            "tags": ["en", "category"],
                        })
    except Exception:
        pass

    # Pageviews for en titles
    if en_titles:
        try:
            titles_str = "|".join(t["title"] for t in en_titles[:40])
            pv = await fetch_json(
                wiki_api("en", {
                    "action": "query",
                    "prop": "pageviews",
                    "pvipdays": "30",
                    "titles": titles_str,
                }),
                timeout_ms=15000, retries=0,
            )
            views_by_title = {}
            pages = pv.get("query", {}).get("pages", {})
            if isinstance(pages, dict):
                pages = pages.values()
            for p in pages:
                if isinstance(p, dict):
                    total = sum(v or 0 for v in (p.get("pageviews") or {}).values())
                    views_by_title[p.get("title")] = total

            for hit in all_hits:
                if hit["source"] == "Wikipedia (en)":
                    v = views_by_title.get(hit["name"], 0)
                    if v > 0:
                        hit["popularity"] = min(v / 20000, 1.0)
                        hit["pageviews"] = v
        except Exception:
            pass

        # Extracts
        try:
            titles_str = "|".join(t["title"] for t in en_titles[:20])
            ex = await fetch_json(
                wiki_api("en", {
                    "action": "query",
                    "prop": "extracts",
                    "exintro": "1",
                    "explaintext": "1",
                    "exlimit": "20",
                    "titles": titles_str,
                }),
                timeout_ms=15000, retries=0,
            )
            extract_by_title = {}
            pages = ex.get("query", {}).get("pages", {})
            if isinstance(pages, dict):
                pages = pages.values()
            for p in pages:
                if isinstance(p, dict) and p.get("extract"):
                    extract_by_title[p["title"]] = p["extract"]

            for hit in all_hits:
                e = extract_by_title.get(hit["name"])
                if e and len(e) > 80:
                    hit["description"] = e[:600]
        except Exception:
            pass

    return all_hits
