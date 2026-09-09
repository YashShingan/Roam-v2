# ─── Wikivoyage vcard listings collector ──────────────────────────────────────
from __future__ import annotations

import re
import urllib.parse
from models import GeoCtx
from net import fetch_json, hit_id


def param_of(body: str, key: str) -> str | None:
    m = re.search(rf"\|\s*{key}\s*=\s*([^|]*)", body, re.IGNORECASE)
    if not m:
        return None
    val = m.group(1).strip()
    val = re.sub(r"\[\[([^|\]]*\|)?([^\]]+)\]\]", r"\2", val)
    val = re.sub(r"\{\{[^}]*\}\}", "", val).strip()
    return val or None


def price_from_wv(p: str | None) -> int | None:
    if not p:
        return None
    m = re.search(r"(\d{2,5})", p.replace(",", ""))
    return int(m.group(1)) if m else None


async def collect_wikivoyage(ctx: GeoCtx) -> list[dict]:
    hits = []
    try:
        page = await fetch_json(
            f"https://en.wikivoyage.org/w/api.php?action=parse&page={urllib.parse.quote(ctx.city)}"
            f"&prop=wikitext&format=json&formatversion=2&redirects=1",
            timeout_ms=12000, retries=0,
        )
        wikitext = page.get("parse", {}).get("wikitext", "")

        pattern = re.compile(
            r"\{\{(?:vcard|see|do|buy|eat|drink|listing)\s*\|([^{}]*(?:\{\{[^}]*\}\}[^{}]*)*)\}\}",
            re.IGNORECASE,
        )
        for m in pattern.finditer(wikitext):
            if len(hits) >= 40:
                break
            body = m.group(1)
            name = param_of(body, "name")
            if not name or len(name) < 2:
                continue

            lat_s = param_of(body, "lat")
            lon_s = param_of(body, "long") or param_of(body, "lon")
            lat = float(lat_s) if lat_s else None
            lon = float(lon_s) if lon_s else None

            # Determine section for category
            preceding = wikitext[:m.start()]
            section_m = re.search(r"==+\s*([A-Za-z ]+?)\s*==+", preceding[::-1])
            section = ""
            for sm in re.finditer(r"==+\s*([A-Za-z ]+?)\s*==+", preceding):
                section = sm.group(1)

            content = param_of(body, "content") or param_of(body, "description")
            category = None
            if re.search(r"eat|drink", section, re.I):
                category = "food"
            elif re.search(r"buy", section, re.I):
                category = "market"
            elif re.search(r"see", section, re.I):
                category = "culture"
            elif re.search(r"do", section, re.I):
                category = "adventure"

            hits.append({
                "name": name,
                "lat": lat if lat and lat != 0 else None,
                "lon": lon if lon and lon != 0 else None,
                "description": content[:500] if content else None,
                "address": param_of(body, "address") or param_of(body, "directions"),
                "category": category,
                "source": "Wikivoyage",
                "source_url": f"https://en.wikivoyage.org/wiki/{urllib.parse.quote(ctx.city)}",
                "website": param_of(body, "url"),
                "opening_hours": param_of(body, "hours"),
            })
    except Exception:
        pass

    # Fallback: geosearch
    if len(hits) < 5:
        try:
            g = await fetch_json(
                f"https://en.wikivoyage.org/w/api.php?action=query&list=geosearch"
                f"&gscoord={ctx.lat}%7C{ctx.lon}&gsradius=10000&gslimit=30"
                f"&format=json&formatversion=2",
                timeout_ms=12000, retries=0,
            )
            for p in g.get("query", {}).get("geosearch", []):
                hits.append({
                    "name": p["title"],
                    "lat": p.get("lat"),
                    "lon": p.get("lon"),
                    "category": "culture",
                    "source": "Wikivoyage",
                    "source_url": f"https://en.wikivoyage.org/?curid={p['pageid']}",
                })
        except Exception:
            pass

    return hits
