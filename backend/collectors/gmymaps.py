# ─── Google My Maps KML collector ─────────────────────────────────────────────
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from models import GeoCtx
from net import fetch_text, haversine_km
from collectors.reddit import source_category


async def meta_search(query: str, cap: int = 8) -> list[dict]:
    """DDG HTML → Mojeek fallback, keyless, fail-soft."""
    try:
        html = await fetch_text(
            f"https://html.duckduckgo.com/html/?q={query}",
            timeout_ms=12000, retries=0,
            headers={"Accept-Language": "en-IN,en"},
        )
        out = []
        seen = set()
        for m in re.finditer(r'result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>', html):
            url = m.group(1)
            uddg = re.search(r"uddg=([^&]+)", url)
            if uddg:
                from urllib.parse import unquote
                url = unquote(uddg.group(1))
            title = re.sub(r"<[^>]*>", "", m.group(2)).strip()
            if not url.startswith("http") or url in seen or not title:
                continue
            seen.add(url)
            out.append({"title": title, "url": url})
            if len(out) >= cap:
                return out
        if out:
            return out
    except Exception:
        pass

    try:
        html = await fetch_text(
            f"https://www.mojeek.com/search?q={query}",
            timeout_ms=12000, retries=0,
        )
        out = []
        for m in re.finditer(r'<a[^>]+class="title[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', html):
            title = re.sub(r"<[^>]*>", "", m.group(2)).strip()
            if not m.group(1).startswith("http") or not title:
                continue
            out.append({"title": title, "url": m.group(1)})
            if len(out) >= cap:
                break
        return out
    except Exception:
        return []


async def collect_gmymaps(ctx: GeoCtx) -> list[dict]:
    results = await meta_search(
        f'site:google.com/maps/d "{ctx.city}" (heritage OR market OR food OR fort)',
        6,
    )

    mids = set()
    for r in results:
        m = re.search(r"mid=([A-Za-z0-9_.-]{10,})", r["url"])
        if m:
            mids.add(m.group(1))
        if len(mids) >= 2:
            break

    hits = []
    for mid in mids:
        try:
            kml = await fetch_text(
                f"https://www.google.com/maps/d/kml?mid={mid}&force=lite",
                timeout_ms=12000, retries=0,
            )
            # Parse KML for Placemarks
            root = ET.fromstring(kml)
            ns = {"kml": "http://www.opengis.net/kml/2.2"}

            for pm in root.iter("{http://www.opengis.net/kml/2.2}Placemark"):
                name_el = pm.find("{http://www.opengis.net/kml/2.2}name")
                name = name_el.text.strip() if name_el is not None and name_el.text else None
                if not name or len(name) < 2:
                    continue

                desc_el = pm.find("{http://www.opengis.net/kml/2.2}description")
                desc = desc_el.text.strip() if desc_el is not None and desc_el.text else None
                if desc:
                    desc = re.sub(r"<[^>]+>", "", desc)[:300]

                coord_el = pm.find(".//{http://www.opengis.net/kml/2.2}coordinates")
                lat, lon = None, None
                if coord_el is not None and coord_el.text:
                    parts = coord_el.text.strip().split(",")
                    if len(parts) >= 2:
                        try:
                            lon, lat = float(parts[0]), float(parts[1])
                        except ValueError:
                            pass

                if lat and haversine_km(ctx.lat, ctx.lon, lat, lon or 0) > ctx.radiusKm * 2:
                    continue

                hits.append({
                    "name": name,
                    "lat": lat,
                    "lon": lon,
                    "description": desc,
                    "category": source_category(f"{name} {desc or ''}"),
                    "source": "Google My Maps",
                    "source_url": f"https://www.google.com/maps/d/viewer?mid={mid}",
                    "tags": ["my_maps", "community_map"],
                })
                if len(hits) >= 30:
                    break
        except Exception:
            pass

    return hits
