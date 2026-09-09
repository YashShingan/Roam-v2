# ─── Wikimedia Commons geosearch collector ───────────────────────────────────
from __future__ import annotations

import re
import urllib.parse
from models import GeoCtx
from net import fetch_json


async def collect_commons(ctx: GeoCtx) -> list[dict]:
    # Geosearch for images near coordinates
    hits = []
    try:
        data = await fetch_json(
            f"https://commons.wikimedia.org/w/api.php?action=query&list=geosearch"
            f"&gscoord={ctx.lat}|{ctx.lon}&gsradius=10000&gslimit=50"
            f"&gsnamespace=6&format=json&formatversion=2",
            timeout_ms=12000, retries=1,
        )
        pages = data.get("query", {}).get("geosearch", [])
        if not pages:
            # Fallback: text search
            data = await fetch_json(
                f"https://commons.wikimedia.org/w/api.php?action=query&list=search"
                f"&srnamespace=6&srsearch={urllib.parse.quote(ctx.city)} filetype:bitmap"
                f"&srlimit=30&format=json&formatversion=2",
                timeout_ms=12000, retries=0,
            )
            pages = data.get("query", {}).get("search", [])

        # Get image info in batches
        page_ids = [str(p.get("pageid", p.get("pageid", ""))) for p in pages[:40]]
        if page_ids:
            batch_size = 20
            for i in range(0, len(page_ids), batch_size):
                batch = page_ids[i:i + batch_size]
                info = await fetch_json(
                    f"https://commons.wikimedia.org/w/api.php?action=query"
                    f"&pageids={'|'.join(batch)}&prop=imageinfo"
                    f"&iiprop=url|extmetadata|size&iiurlwidth=640"
                    f"&format=json&formatversion=2",
                    timeout_ms=12000, retries=0,
                )
                for p in info.get("query", {}).get("pages", {}).values() if isinstance(info.get("query", {}).get("pages"), dict) else info.get("query", {}).get("pages", []):
                    if not isinstance(p, dict):
                        continue
                    ii = (p.get("imageinfo") or [{}])[0]
                    title = p.get("title", "").replace("File:", "").replace("_", " ")
                    title = re.sub(r"\.\w{2,4}$", "", title).strip()
                    if not title or len(title) < 3:
                        continue

                    # Extract GPS from metadata
                    meta = ii.get("extmetadata", {})
                    lat = None
                    lon = None
                    gps_lat = meta.get("GPSLatitude", {}).get("value")
                    gps_lon = meta.get("GPSLongitude", {}).get("value")
                    if gps_lat and gps_lon:
                        try:
                            lat = float(gps_lat)
                            lon = float(gps_lon)
                        except ValueError:
                            pass

                    # Also check original geosearch coords
                    for orig in pages:
                        if str(orig.get("pageid")) == str(p.get("pageid")):
                            if not lat and orig.get("lat"):
                                lat = orig["lat"]
                                lon = orig.get("lon")
                            break

                    desc = meta.get("ImageDescription", {}).get("value", "")
                    desc = re.sub(r"<[^>]+>", "", desc)[:300] if desc else None

                    hits.append({
                        "name": title[:60],
                        "lat": lat,
                        "lon": lon,
                        "description": desc,
                        "category": None,
                        "source": "Wikimedia Commons",
                        "source_url": f"https://commons.wikimedia.org/?curid={p.get('pageid')}",
                        "image_url": ii.get("thumburl") or ii.get("url"),
                        "tags": ["commons", "photo"],
                    })

    except Exception:
        pass

    return hits[:30]
