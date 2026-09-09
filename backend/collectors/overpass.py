# ─── Overpass collector: 4 mirror rotation, 2 passes, radius fallback ────────
from __future__ import annotations

import re
import urllib.parse
from models import GeoCtx
from net import fetch_json, fetch_text, hit_id, haversine_km

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

LANDMARK_NAME_RE = r"market|mandai|bazaar|bazar|fort|killa|gad|heritage|mahal|mandir|temple|ghat|wada"


async def overpass_query(query: str, timeout_ms: int = 6000) -> list[dict]:
    import httpx
    from net import get_client

    client = await get_client()
    last_err = None
    for mirror in OVERPASS_MIRRORS:
        try:
            resp = await client.post(
                mirror,
                content=f"data={urllib.parse.quote(query)}",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=timeout_ms / 1000,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("elements", [])
        except Exception as e:
            last_err = e
    raise last_err or Exception("all Overpass mirrors failed")


def map_osm_category(tags: dict, name: str) -> str | None:
    n = name.lower()
    t = tags
    if t.get("tourism") == "viewpoint":
        return "nature"
    if t.get("tourism") in ("museum", "gallery", "attraction", "artwork"):
        return "culture"
    if t.get("tourism") in ("zoo", "aquarium"):
        return "adventure"
    if t.get("historic") in ("castle", "fort", "palace", "ruins", "monastery", "archaeological_site"):
        return "culture"
    if t.get("historic"):
        return "culture"
    if t.get("leisure") in ("park", "garden"):
        return "nature"
    if t.get("amenity") in ("cafe", "ice_cream") or t.get("shop") in (
        "bakery", "tea", "coffee", "pastry", "deli", "chocolate", "confectionery"
    ):
        return "food"
    if t.get("amenity") in ("food_court", "restaurant"):
        return "food"
    if t.get("shop") in ("sweet", "spices", "greengrocer", "seafood", "butcher", "cheese"):
        return "market"
    if t.get("amenity") == "marketplace" or t.get("shop") in ("mall", "department_store"):
        return "market"
    if t.get("shop") in (
        "antiques", "art", "books", "craft", "gift", "souvenir", "fabric", "tailor",
        "jewelry", "herbalist", "second_hand", "pottery"
    ):
        return "market" if re.search(r"market|bazaar|bazar|mandai", n) else "workshop"
    if t.get("craft"):
        return "workshop"
    if t.get("shop"):
        return "market"
    if re.search(r"market|bazaar|bazar|mandai|emporium", n):
        return "market"
    if re.search(r"cafe|coffee|chai|bakery|restaurant|sweet|mithai|farsan|food", n):
        return "food"
    if re.search(r"fort|palace|museum|temple|mandir|mosque|dargah|church|gad|wada|heritage|mahal", n):
        return "culture"
    if re.search(r"park|garden|lake|hill|falls|waterfall|view\s?point|beach|ghat", n):
        return "nature"
    return None


def kind_note(tags: dict) -> str | None:
    for k in ("amenity", "shop", "tourism", "historic", "leisure", "craft"):
        if tags.get(k):
            return f"OSM {k}: {tags[k]}"
    return None


async def collect_overpass(ctx: GeoCtx) -> list[dict]:
    lat, lon, radius_km = ctx.lat, ctx.lon, ctx.radiusKm
    r = min(radius_km, 8)
    elements = []

    q = f"""[out:json][timeout:6];
(
  nwr[amenity~"^(cafe|food_court|marketplace|ice_cream)$"](around:{r*1000},{lat},{lon});
  nwr[shop~"^(bakery|tea|coffee|pastry|deli|confectionery|chocolate|sweet|spices|greengrocer|mall|department_store|antiques|art|books|craft|gift|souvenir)$"](around:{r*1000},{lat},{lon});
  nwr[tourism~"^(viewpoint|museum|attraction|artwork|gallery|zoo|aquarium)$"](around:{r*1000},{lat},{lon});
  nwr[historic][historic!~"^(memorial|plaque|boundary_stone|wreck|farm)$"](around:{r*1000},{lat},{lon});
  nwr[leisure~"^(park|garden)$"](around:{r*1000},{lat},{lon});
  rel[route~"^(hiking|foot|walking)$"](around:{r*1000},{lat},{lon});
);
out center tags 120;"""

    try:
        elements = await overpass_query(q, 6000)
    except Exception:
        try:
            q_small = f"""[out:json][timeout:4];
(
  node[amenity~"^(cafe|marketplace)$"](around:3000,{lat},{lon});
  node[tourism~"^(viewpoint|museum|attraction)$"](around:3000,{lat},{lon});
  node[historic](around:3000,{lat},{lon});
);
out 40;"""
            elements = await overpass_query(q_small, 4000)
        except Exception:
            elements = []

    hits = []
    for el in elements:
        tags = el.get("tags", {})
        name = (tags.get("name") or "").strip()
        if not name or tags.get("disused") == "yes" or tags.get("access") == "private":
            continue

        p_lat = el.get("lat") or (el.get("center") or {}).get("lat")
        p_lon = el.get("lon") or (el.get("center") or {}).get("lon")
        is_route = el.get("type") == "relation" and "route" in tags
        category = map_osm_category(tags, name)

        if is_route and not category:
            hits.append({
                "name": name,
                "lat": p_lat,
                "lon": p_lon,
                "description": tags.get("description") or tags.get("name:en"),
                "category": "adventure",
                "source": "OpenStreetMap",
                "source_url": f"https://www.openstreetmap.org/relation/{el['id']}",
                "tags": ["heritage walk", "walk"],
                "osm_type": "relation",
                "osm_id": str(el["id"]),
                "opening_hours": tags.get("opening_hours"),
                "website": tags.get("website") or tags.get("contact:website"),
            })
            continue

        if not category and not is_route:
            continue

        addr_parts = [
            " ".join(filter(None, [tags.get("addr:housenumber"), tags.get("addr:street")])),
            tags.get("addr:suburb"),
            tags.get("addr:city") or ctx.city,
        ]
        address = ", ".join(p for p in addr_parts if p) or None

        tag_list = list(filter(None, [
            tags.get("cuisine"),
            "veg" if tags.get("diet:vegetarian") == "yes" else None,
            "outdoor seating" if tags.get("outdoor_seating") == "yes" else None,
        ]))

        hits.append({
            "name": name,
            "lat": p_lat,
            "lon": p_lon,
            "address": address,
            "description": tags.get("description"),
            "category": category,
            "source": "OpenStreetMap",
            "source_url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
            "tags": tag_list,
            "website": tags.get("website") or tags.get("contact:website"),
            "opening_hours": tags.get("opening_hours"),
            "outdoor": tags.get("outdoor_seating") == "yes" or category == "nature" or tags.get("tourism") == "viewpoint",
            "wheelchair": tags.get("wheelchair") in ("yes", "limited") if tags.get("wheelchair") else None,
            "osm_type": el.get("type"),
            "osm_id": str(el["id"]),
        })

    return hits
