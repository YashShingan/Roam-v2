# ─── Wikidata SPARQL collector ────────────────────────────────────────────────
from __future__ import annotations

import re
import urllib.parse
from models import GeoCtx
from net import fetch_json, hit_id

WD_CLASSES = "wd:Q30022 wd:Q218600 wd:Q11707 wd:Q33506 wd:Q174782 wd:Q210729 wd:Q22698 wd:Q32815 wd:Q16970 wd:Q840401 wd:Q40080 wd:Q23413 wd:Q1668562"


async def collect_wikidata(ctx: GeoCtx) -> list[dict]:
    r_km = round(ctx.radiusKm)
    sparql = f"""SELECT ?item ?itemLabel ?coord ?img WHERE {{
    SERVICE wikibase:around {{
      ?item wdt:P625 ?coord .
      bd:serviceParam wikibase:center "Point({ctx.lon} {ctx.lat})"^^geo:wktLiteral .
      bd:serviceParam wikibase:radius "{r_km}" .
    }}
    OPTIONAL {{ ?item wdt:P18 ?img }}
    SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,hi,mr". }}
  }} LIMIT 100"""

    url = f"https://query.wikidata.org/sparql?query={urllib.parse.quote(sparql)}&format=json"
    data = await fetch_json(url, timeout_ms=12000, retries=0, headers={
        "Accept": "application/sparql-results+json"
    })

    hits = []
    for row in data.get("results", {}).get("bindings", []):
        name = row.get("itemLabel", {}).get("value")
        qid_url = row.get("item", {}).get("value", "")
        qid = qid_url.split("/")[-1] if qid_url else None
        if not name or not qid:
            continue

        coord_str = row.get("coord", {}).get("value", "")
        m = re.search(r"Point\(([-\d.]+) ([-\d.]+)\)", coord_str)
        sl = int(row.get("sl", {}).get("value", 0))

        img_url = None
        img_raw = row.get("img", {}).get("value", "")
        if img_raw:
            fname = img_raw.split("/")[-1]
            img_url = f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(fname)}?width=640"

        hits.append({
            "name": name,
            "lat": float(m.group(2)) if m else None,
            "lon": float(m.group(1)) if m else None,
            "address": row.get("addr", {}).get("value"),
            "category": "culture",
            "source": "Wikidata",
            "source_url": f"https://www.wikidata.org/wiki/{qid}",
            "image_url": img_url,
            "popularity": min(sl / 40, 1.0),
            "sitelinks": sl,
            "tags": ["wikidata"],
        })

    return hits
