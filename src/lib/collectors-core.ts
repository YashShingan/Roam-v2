// ─── Core collectors: Overpass, Wikidata, Wikipedia, Wikivoyage, Commons,
// ─── Photon POI sweep, GeoNames dump, amenity proximity. All keyless. ────────
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fetchWithTimeout, getJson, haversineKm, cached } from "./net";
import { hitId, validCategory, type GeoCtx, type RawHit } from "./rawhit";

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function overpassQuery(query: string, timeoutMs = 25000): Promise<OsmElement[]> {
  let lastErr: unknown = null;
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetchWithTimeout(mirror, {
        method: "POST",
        timeoutMs,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { elements?: OsmElement[] };
      return json.elements ?? [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all Overpass mirrors failed");
}

interface BBox {
  s: number;
  w: number;
  n: number;
  e: number;
}

// Theme union for one bbox tile. The ONLY cap is `out center tags 2000` per
// tile; tiling the whole search circle means the sweep has NO total cap —
// every named, visitable OSM element inside the radius gets collected.
function overpassTileQuery(bb: BBox): string {
  const box = `(${bb.s.toFixed(5)},${bb.w.toFixed(5)},${bb.n.toFixed(5)},${bb.e.toFixed(5)})`;
  return `[out:json][timeout:20];
(
  nwr[amenity~"^(cafe|food_court|marketplace|ice_cream|restaurant|pub|bar|brewery|nightclub|theatre|cinema|arts_centre)$"]${box};
  nwr[shop~"^(bakery|tea|coffee|pastry|deli|confectionery|chocolate|sweet|spices|greengrocer|mall|department_store|antiques|art|books|craft|gift|souvenir|jewelry|fabric|tailor|musical_instrument|outdoor|sports|herbalist|pottery|second_hand|seafood|butcher|cheese)$"]${box};
  nwr[tourism~"^(viewpoint|museum|attraction|artwork|gallery|zoo|aquarium)$"]${box};
  nwr[historic][historic!~"^(memorial|plaque|boundary_stone|wreck|farm)$"]${box};
  nwr[leisure~"^(park|garden|water_park)$"]${box};
  nwr[amenity=place_of_worship]${box};
  nwr[natural~"^(beach|waterfall|peak)$"]${box};
  nwr[waterway=waterfall]${box};
  nwr[craft]${box};
  rel[route~"^(hiking|foot|walking)$"]${box};
);
out center tags 2000;`;
}

// Cover the whole circle with non-overlapping bbox tiles (~20 for any radius —
// big enough to be polite to Overpass, small enough that no tile truncates).
function bboxTiles(lat: number, lon: number, radiusKm: number): BBox[] {
  const sizeKm = Math.max(3.5, (radiusKm * 2) / 4.5);
  const cos = Math.cos((lat * Math.PI) / 180) || 1;
  const dLat = sizeKm / 111.32;
  const dLon = sizeKm / (111.32 * cos);
  const steps = Math.ceil((radiusKm * 2) / sizeKm);
  const south = lat - radiusKm / 111.32;
  const west = lon - radiusKm / (111.32 * cos);
  const tiles: BBox[] = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const s = south + i * dLat;
      const w = west + j * dLon;
      const cLat = s + dLat / 2;
      const cLon = w + dLon / 2;
      if (haversineKm(lat, lon, cLat, cLon) <= radiusKm + sizeKm * 0.45) {
        tiles.push({ s, w, n: s + dLat, e: w + dLon });
      }
    }
  }
  return tiles;
}

// 1 ── Overpass: FULL-AREA tiled sweep (no result cap) + heritage walk routes.
// Streams partial hit batches through ctx.onProgress so the background
// collector can upsert places while the sweep is still running.
export async function collectOverpass(ctx: GeoCtx): Promise<RawHit[]> {
  const { lat, lon, radiusKm } = ctx;
  const r = Math.min(radiusKm, 25);
  const tiles = bboxTiles(lat, lon, r);
  const elements = new Map<string, OsmElement>();
  let failed = 0;

  const absorb = (els: OsmElement[]): void => {
    for (const el of els) elements.set(`${el.type}/${el.id}`, el);
  };
  const emit = (): RawHit[] => buildOverpassHits([...elements.values()], ctx);

  const BATCH = 3;
  for (let i = 0; i < tiles.length; i += BATCH) {
    const batch = tiles.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map((t) => overpassQuery(overpassTileQuery(t), 25000)),
    );
    for (const res of settled) {
      if (res.status === "fulfilled") absorb(res.value);
      else failed++;
    }
    ctx.onProgress?.("OpenStreetMap", emit());
  }

  if (elements.size === 0 && failed > 0) {
    // every tile failed — one last compact attempt around the center
    try {
      const q = `[out:json][timeout:6];
(
  node[amenity~"^(cafe|marketplace)$"](around:3000,${lat},${lon});
  node[tourism~"^(viewpoint|museum|attraction)$"](around:3000,${lat},${lon});
  node[historic](around:3000,${lat},${lon});
);
out 40;`;
      absorb(await overpassQuery(q, 8000));
    } catch {
      /* fail-soft: other collectors still run */
    }
  }
  return emit();
}

function buildOverpassHits(elements: OsmElement[], ctx: GeoCtx): RawHit[] {
  const hits: RawHit[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const name = t.name?.trim();
    if (!name || t.disused === "yes" || t.access === "private") continue;
    const pLat = el.lat ?? el.center?.lat;
    const pLon = el.lon ?? el.center?.lon;
    const isRoute = el.type === "relation" && !!t.route;
    const category = mapOsmCategory(t, name);
    if (!category && !isRoute) continue;
    if (isRoute && !category) {
      // heritage walk route
      hits.push({
        id: hitId(`osm-rel-${el.id}`, name, ctx.city),
        name,
        lat: pLat,
        lon: pLon,
        description: t.description || t["name:en"],
        category: "adventure",
        source: "OpenStreetMap",
        sourceUrl: `https://www.openstreetmap.org/relation/${el.id}`,
        note: "Community-mapped walking route (heritage/foot)",
        tags: ["heritage walk", "walk"],
        osmType: "relation",
        osmId: String(el.id),
        openingHoursRaw: t.opening_hours,
        website: t.website || t["contact:website"],
      });
      continue;
    }
    if (!category) continue;
    const addr = [
      [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "),
      t["addr:suburb"],
      t["addr:city"] || ctx.city,
    ]
      .filter(Boolean)
      .join(", ");
    hits.push({
      id: hitId(`osm-${el.type}-${el.id}`, name, ctx.city),
      name,
      lat: pLat,
      lon: pLon,
      address: addr || undefined,
      description: t.description,
      category,
      source: "OpenStreetMap",
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      note: kindNote(t),
      tags: [t.cuisine, t.diet_vegetarian === "yes" ? "veg" : undefined, t.outdoor_seating === "yes" ? "outdoor seating" : undefined].filter(
        (x): x is string => !!x,
      ),
      website: t.website || t["contact:website"],
      openingHoursRaw: t.opening_hours,
      isOutdoor: t.outdoor_seating === "yes" || category === "nature" || t.tourism === "viewpoint",
      wheelchair: t.wheelchair ? t.wheelchair === "yes" || t.wheelchair === "limited" : null,
      kids: t.kids_area ? true : null,
      osmType: el.type,
      osmId: String(el.id),
    });
  }
  return hits;
}

function kindNote(t: Record<string, string>): string | undefined {
  if (t.amenity) return `OSM amenity: ${t.amenity}`;
  if (t.shop) return `OSM shop: ${t.shop}`;
  if (t.tourism) return `OSM tourism: ${t.tourism}`;
  if (t.historic) return `OSM historic: ${t.historic}`;
  if (t.leisure) return `OSM leisure: ${t.leisure}`;
  if (t.craft) return `OSM craft: ${t.craft}`;
  return undefined;
}

function mapOsmCategory(t: Record<string, string>, name: string): RawHit["category"] | undefined {
  const n = name.toLowerCase();
  if (t.tourism === "viewpoint") return "nature";
  if (t.tourism === "museum" || t.tourism === "gallery" || t.tourism === "attraction" || t.tourism === "artwork")
    return "culture";
  if (t.tourism === "zoo" || t.tourism === "aquarium") return "adventure";
  if (t.natural === "beach" || t.natural === "waterfall" || t.natural === "peak" || t.waterway === "waterfall")
    return "nature";
  if (t.amenity === "place_of_worship") return "culture";
  if (t.amenity === "theatre" || t.amenity === "cinema" || t.amenity === "arts_centre") return "culture";
  if (t.amenity === "pub" || t.amenity === "bar" || t.amenity === "brewery" || t.amenity === "nightclub")
    return "nightlife";
  if (t.historic === "castle" || t.historic === "fort" || t.historic === "palace" || t.historic === "ruins" || t.historic === "monastery" || t.historic === "archaeological_site")
    return "culture";
  if (t.historic) return "culture";
  if (t.leisure === "park" || t.leisure === "garden") return "nature";
  if (t.amenity === "cafe" || t.amenity === "ice_cream" || t.shop === "bakery" || t.shop === "tea" || t.shop === "coffee" || t.shop === "pastry" || t.shop === "deli" || t.shop === "chocolate" || t.shop === "confectionery")
    return "food";
  if (t.amenity === "food_court" || t.amenity === "restaurant") return "food";
  if (t.shop === "sweet" || t.shop === "spices" || t.shop === "greengrocer" || t.shop === "seafood" || t.shop === "butcher" || t.shop === "cheese")
    return "market";
  if (t.amenity === "marketplace" || t.shop === "mall" || t.shop === "department_store") return "market";
  if (t.shop === "antiques" || t.shop === "art" || t.shop === "books" || t.shop === "craft" || t.shop === "gift" || t.shop === "souvenir" || t.shop === "fabric" || t.shop === "tailor" || t.shop === "jewelry" || t.shop === "herbalist" || t.shop === "second_hand" || t.shop === "pottery")
    return n.match(/market|bazaar|bazar|mandai/)
      ? "market"
      : "workshop";
  if (t.craft) return "workshop";
  if (t.shop) return "market";
  if (n.match(/market|bazaar|bazar|mandai|emporium/)) return "market";
  if (n.match(/cafe|coffee|chai|bakery|restaurant|sweet|mithai|farsan|food/)) return "food";
  if (n.match(/fort|palace|museum|temple|mandir|mosque|dargah|church|gad|wada|heritage|mahal/)) return "culture";
  if (n.match(/park|garden|lake|hill|falls|waterfall|view\s?point|beach|ghat/)) return "nature";
  return undefined;
}

// 2 ── Wikidata SPARQL: geo-around instances + protected heritage
interface SparqlRow {
  item?: { value: string };
  itemLabel?: { value: string };
  coord?: { value: string };
  addr?: { value: string };
  img?: { value: string };
  sl?: { value: string };
}

const WD_CLASSES =
  "wd:Q570116 wd:Q33506 wd:Q174782 wd:Q22698 wd:Q32815 wd:Q16970 wd:Q23413 wd:Q44539 wd:Q40080 wd:Q34038";

export async function collectWikidata(ctx: GeoCtx): Promise<RawHit[]> {
  const rKm = Math.round(ctx.radiusKm);
  // Class-filtered: only visitor-worthy things (attractions, museums, malls,
  // parks, places of worship, castles, temples, beaches, waterfalls) — no
  // constituencies, sheds, administrative areas or bare settlements.
  const sparql = `SELECT ?item ?itemLabel ?coord ?img WHERE {
    SERVICE wikibase:around {
      ?item wdt:P625 ?coord .
      bd:serviceParam wikibase:center "Point(${ctx.lon} ${ctx.lat})"^^geo:wktLiteral .
      bd:serviceParam wikibase:radius "${rKm}" .
    }
    ?item wdt:P31/wdt:P279* ?cls .
    VALUES ?cls { ${WD_CLASSES} }
    OPTIONAL { ?item wdt:P18 ?img }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,hi,mr". }
  } LIMIT 500`;
  const data = await getJson<{ results: { bindings: SparqlRow[] } }>(
    `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
    { timeoutMs: 30000, retries: 0, headers: { Accept: "application/sparql-results+json" } },
  );
  const hits: RawHit[] = [];
  for (const row of data.results?.bindings ?? []) {
    const name = row.itemLabel?.value;
    const qid = row.item?.value?.split("/").pop();
    if (!name || !qid) continue;
    const m = row.coord?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    const sl = Number(row.sl?.value ?? 0);
    hits.push({
      id: hitId(`wikidata-${qid}`, name, ctx.city),
      name,
      lat: m ? Number(m[2]) : undefined,
      lon: m ? Number(m[1]) : undefined,
      address: row.addr?.value,
      category: "culture",
      source: "Wikidata",
      sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
      note: "Structured open knowledge graph entry",
      imageUrl: row.img?.value ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(row.img.value.split("/").pop() ?? "")}?width=640` : undefined,
      popularityScore: Math.min(sl / 40, 1),
      popularityNote: sl > 0 ? `${sl} wiki sitelinks` : undefined,
      tags: ["wikidata"],
    });
  }
  return hits;
}

// 3 ── Wikipedia multilingual geosearch + pageviews + extracts
interface WikiGeoSearch {
  query?: {
    geosearch?: { pageid: number; ns: number; title: string; lat: number; lon: number; dist: number }[];
    categorymembers?: { pageid: number; title: string }[];
  };
}

function wikiApi(lang: string, params: Record<string, string>): string {
  const usp = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  return `https://${lang}.wikipedia.org/w/api.php?${usp.toString()}`;
}

export async function collectWikipedia(ctx: GeoCtx): Promise<RawHit[]> {
  const langs = ["en", "mr", "hi"];
  const all: RawHit[] = [];
  const enTitles: { title: string; pageid: number; lat: number; lon: number }[] = [];

  const geoResults = await Promise.allSettled(
    langs.map((lang) =>
      getJson<WikiGeoSearch>(
        wikiApi(lang, {
          action: "query",
          list: "geosearch",
          gscoord: `${ctx.lat}|${ctx.lon}`,
          gsradius: "10000",
          gslimit: "500",
        }),
        { timeoutMs: 12000, retries: 1, headers: { "Api-User-Agent": "RoamApp/1.0" } },
      ),
    ),
  );
  geoResults.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    for (const g of r.value.query?.geosearch ?? []) {
      const isEn = langs[i] === "en";
      const category = wikiCategory(g.title);
      if (!category) continue; // admin/geo/infra titles never become pins
      all.push({
        id: hitId(`wiki-${langs[i]}-${g.pageid}`, g.title, ctx.city),
        name: g.title,
        lat: g.lat,
        lon: g.lon,
        category,
        source: `Wikipedia (${langs[i]})`,
        sourceUrl: `https://${langs[i]}.wikipedia.org/?curid=${g.pageid}`,
        note: isEn ? "Encyclopedia article near you" : `${langs[i]}-language article`,
        tags: [langs[i]],
      });
      if (isEn) enTitles.push({ title: g.title, pageid: g.pageid, lat: g.lat, lon: g.lon });
    }
  });

  // Category:{City} member mining (en)
  try {
    const cat = await getJson<WikiGeoSearch>(
      wikiApi("en", {
        action: "query",
        list: "categorymembers",
        cmtitle: `Category:Tourist attractions in ${ctx.city}`,
        cmlimit: "max",
        cmprop: "ids|title",
      }),
      { timeoutMs: 10000, retries: 0 },
    );
    const members = cat.query?.categorymembers ?? [];
    if (members.length > 0) {
      const coords = await getJson<{ query?: { pages?: { title: string; coordinates?: { lat: number; lon: number }[] }[] } }>(
        wikiApi("en", {
          action: "query",
          prop: "coordinates",
          coprimary: "primary",
          colimit: "max",
          titles: members.map((m) => m.title).slice(0, 50).join("|"),
        }),
        { timeoutMs: 12000, retries: 0 },
      );
      for (const p of coords.query?.pages ?? []) {
        const c = p.coordinates?.[0];
        if (!c) continue;
        all.push({
          id: hitId(`wiki-cat-${p.title}`, p.title, ctx.city),
          name: p.title,
          lat: c.lat,
          lon: c.lon,
          // curated tourist-attractions category → trust the list even when
          // the title carries no visitable keyword
          category: wikiCategory(p.title) ?? "culture",
          source: "Wikipedia (en)",
          sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replaceAll(" ", "_"))}`,
          note: "Listed under tourist-attractions category",
          tags: ["en", "category"],
        });
      }
    }
  } catch {
    /* category may not exist */
  }

  // 30-day pageviews for en titles (bulk prop=pageviews)
  if (enTitles.length > 0) {
    try {
      const pv = await getJson<{
        query?: { pages?: { title: string; pageviews?: Record<string, number | null> }[] };
      }>(
        wikiApi("en", {
          action: "query",
          prop: "pageviews",
          pvipdays: "30",
          piprop: "title",
          titles: enTitles.slice(0, 40).map((t) => t.title).join("|"),
        }),
        { timeoutMs: 15000, retries: 0 },
      );
      const viewsByTitle = new Map<string, number>();
      for (const p of pv.query?.pages ?? []) {
        const total = Object.values(p.pageviews ?? {}).reduce<number>((a, v) => a + (v ?? 0), 0);
        viewsByTitle.set(p.title, total);
      }
      for (const hit of all) {
        if (hit.source !== "Wikipedia (en)") continue;
        const v = viewsByTitle.get(hit.name);
        if (v && v > 0) {
          hit.popularityScore = Math.min(v / 20000, 1);
          hit.popularityNote = `📖 ${Intl.NumberFormat("en", { notation: "compact" }).format(v)} wiki views/30d`;
          hit.tags = [...(hit.tags ?? []), "pageviews"];
        }
      }
    } catch {
      /* pageviews optional */
    }

    // Intro extracts for en titles (bulk; API caps exlimit at 20 → batch)
    const extractByTitle = new Map<string, string>();
    for (let i = 0; i < Math.min(enTitles.length, 100); i += 20) {
      try {
        const ex = await getJson<{ query?: { pages?: { title: string; extract?: string }[] } }>(
          wikiApi("en", {
            action: "query",
            prop: "extracts",
            exintro: "1",
            explaintext: "1",
            exlimit: "20",
            titles: enTitles.slice(i, i + 20).map((t) => t.title).join("|"),
          }),
          { timeoutMs: 15000, retries: 0 },
        );
        for (const p of ex.query?.pages ?? []) {
          if (p.extract) extractByTitle.set(p.title, p.extract);
        }
      } catch {
        /* extracts optional */
      }
    }
    for (const hit of all) {
      const e = extractByTitle.get(hit.name);
      if (e && e.length > 80) {
        hit.description = e.slice(0, 600);
        hit.tags = [...(hit.tags ?? []), "extract"];
      }
    }
  }
  return all;
}

function wikiCategory(title: string): RawHit["category"] | undefined {
  const n = title.toLowerCase();
  // admin/geo/transport/infra titles are never visitable — explicit drops
  if (n.match(/station|airport|stadium|college|university|school|hospital|office|building|constituency|lok sabha|vidhan sabha|assembly|loco shed|shed\b|depot|junction|terminus|suburb|neighbourhood|neighborhood|village|taluka|tehsil|district|division|cantonment|municipal|corporation|council|infrastruct|power plant|factory|refinery|dockyard|cemetery|graveyard/)) return undefined;
  if (n.match(/fort|palace|museum|temple|mandir|mosque|dargah|church|cave|heritage|monument|memorial garden/)) return "culture";
  if (n.match(/market|bazaar|bazar|mandai|mall|shopping/)) return "market";
  if (n.match(/park|lake|garden|hill|falls|waterfall|beach|sanctuary|forest|ghat/)) return "nature";
  if (n.match(/cafe|restaurant|hotel/)) return "food";
  // no visitable signal in the title → not a place worth a pin
  return undefined;
}

// 4 ── Wikivoyage vcard listings
interface WVPage {
  parse?: { wikitext?: string };
  query?: { geosearch?: { pageid: number; title: string; lat: number; lon: number; dist: number }[] };
}

export async function collectWikivoyage(ctx: GeoCtx): Promise<RawHit[]> {
  const hits: RawHit[] = [];
  try {
    const page = await getJson<WVPage>(
      `https://en.wikivoyage.org/w/api.php?action=parse&page=${encodeURIComponent(ctx.city)}&prop=wikitext&format=json&formatversion=2&redirects=1`,
      { timeoutMs: 12000, retries: 0 },
    );
    const wikitext = page.parse?.wikitext ?? "";
    const re = /\{\{(?:vcard|see|do|buy|eat|drink|listing)\s*\|([^{}]*(?:\{\{[^}]*\}\}[^{}{}]*)*)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(wikitext)) && hits.length < 400) {
      const body = m[1];
      const name = paramOf(body, "name");
      if (!name || name.length < 2) continue;
      const lat = Number(paramOf(body, "lat"));
      const lon = Number(paramOf(body, "long") || paramOf(body, "lon"));
      const section =
        wikitext.lastIndexOf("==", m.index) > -1 && /==\s*(Eat|Drink|See|Buy|Do)/i.test(wikitext.slice(Math.max(0, wikitext.lastIndexOf("==", m.index) - 200), m.index))
          ? (wikitext.slice(0, m.index).match(/==+\s*([A-Za-z ]+?)\s*==+$/)?.[1] ?? "")
          : "";
      const content = paramOf(body, "content") || paramOf(body, "description");
      hits.push({
        id: hitId("wikivoyage", name, ctx.city),
        name,
        lat: Number.isFinite(lat) && lat !== 0 ? lat : undefined,
        lon: Number.isFinite(lon) && lon !== 0 ? lon : undefined,
        description: content ? content.replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, "$2").slice(0, 500) : undefined,
        address: paramOf(body, "address") || paramOf(body, "directions"),
        category: /eat|drink/i.test(section)
          ? "food"
          : /buy/i.test(section)
            ? "market"
            : /see/i.test(section)
              ? "culture"
              : /do/i.test(section)
                ? "adventure"
                : undefined,
        source: "Wikivoyage",
        sourceUrl: `https://en.wikivoyage.org/wiki/${encodeURIComponent(ctx.city)}`,
        note: section ? `Wikivoyage “${section.trim()}” listing` : "Wikivoyage community listing",
        website: paramOf(body, "url"),
        openingHoursRaw: paramOf(body, "hours"),
        priceHint: priceFromWv(paramOf(body, "price")),
      });
    }
  } catch {
    /* page may not exist */
  }
  if (hits.length < 5) {
    try {
      const g = await getJson<WVPage>(
        `https://en.wikivoyage.org/w/api.php?action=query&list=geosearch&gscoord=${ctx.lat}%7C${ctx.lon}&gsradius=10000&gslimit=30&format=json&formatversion=2`,
        { timeoutMs: 12000, retries: 0 },
      );
      for (const p of g.query?.geosearch ?? []) {
        hits.push({
          id: hitId("wikivoyage-geo", p.title, ctx.city),
          name: p.title,
          lat: p.lat,
          lon: p.lon,
          category: "culture",
          source: "Wikivoyage",
          sourceUrl: `https://en.wikivoyage.org/?curid=${p.pageid}`,
          note: "Nearest Wikivoyage guide entry",
        });
      }
    } catch {
      /* silent */
    }
  }
  return hits;
}

function paramOf(body: string, key: string): string | undefined {
  const m = body.match(new RegExp(`\\|\\s*${key}\\s*=\\s*([^|]*)`, "i"));
  return m ? m[1].trim().replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, "$2").replace(/\{\{[^}]*\}\}/g, "").trim() || undefined : undefined;
}

function priceFromWv(p?: string): number | undefined {
  if (!p) return undefined;
  const m = p.match(/(?:₹|Rs\.?|INR)\s*([\d,]+)/i) ?? p.match(/^([\d,]{2,6})/);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : undefined;
}

// 7 ── Wikimedia Commons geosearch (imagery + photo-documented spots)
export async function collectCommons(ctx: GeoCtx): Promise<RawHit[]> {
  const search = await getJson<{ query?: { geosearch?: { pageid: number; title: string; lat: number; lon: number; dist: number }[] } }>(
    `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gscoord=${ctx.lat}%7C${ctx.lon}&gsradius=10000&gslimit=500&format=json&formatversion=2`,
    { timeoutMs: 12000, retries: 0, headers: { "Api-User-Agent": "RoamApp/1.0" } },
  );
  const files = (search.query?.geosearch ?? []).filter((f) => {
    const clean = cleanFileName(f.title);
    return /[a-z]{4}/i.test(clean) && !/^(img|dsc|photo|picture|panorama|image|screenshot)[\s\d_-]*$/i.test(clean);
  });
  if (files.length === 0) return [];
  // imageinfo caps titles at 50 per call → batch through everything
  interface ImageInfo {
    url: string;
    thumburl?: string;
    extmetadata?: { ImageDescription?: { value: string }; GPSDateTime?: { value: string } };
  }
  const infoByTitle = new Map<string, ImageInfo[]>();
  for (let i = 0; i < Math.min(files.length, 300); i += 50) {
    try {
      const info = await getJson<{ query?: { pages?: { title: string; imageinfo?: ImageInfo[] }[] } }>(
        `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(files.slice(i, i + 50).map((f) => f.title).join("|"))}&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json&formatversion=2`,
        { timeoutMs: 15000, retries: 0 },
      );
      for (const p of info.query?.pages ?? []) infoByTitle.set(p.title, p.imageinfo ?? []);
    } catch {
      /* batch optional */
    }
  }
  const hits: RawHit[] = [];
  for (const f of files) {
    const ii = infoByTitle.get(f.title)?.[0];
    if (!ii) continue;
    const name = cleanFileName(f.title);
    hits.push({
      id: hitId("commons", name, ctx.city),
      name,
      lat: f.lat,
      lon: f.lon,
      description: stripHtml(ii.extmetadata?.ImageDescription?.value ?? "").slice(0, 400) || undefined,
      category: commonsCategory(name),
      source: "Wikimedia Commons",
      sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(f.title.replaceAll(" ", "_"))}`,
      note: "Freely-licensed community photo",
      imageUrl: ii.thumburl ?? ii.url,
      tags: ["photo"],
    });
  }
  return hits;
}

function cleanFileName(title: string): string {
  return title
    .replace(/^File:/i, "")
    .replace(/\.(jpe?g|png|webp|tiff?|gif|svg)$/i, "")
    .replaceAll("_", " ")
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim();
}

function commonsCategory(name: string): RawHit["category"] {
  const n = name.toLowerCase();
  if (n.match(/fort|palace|temple|mandir|mosque|church|cave|gate|monument|mahal|heritage|statue|street art|murals?/)) return "culture";
  if (n.match(/market|bazaar|bazar|mandai|shop|vendor/)) return "market";
  if (n.match(/food|thali|vada|samosa|chai|coffee|sweet|dish|cuisine/)) return "food";
  if (n.match(/park|lake|garden|hill|falls|waterfall|beach|river|sunset|sunrise/)) return "nature";
  return "hidden_gem";
}

// 12 ── Photon POI sweep (keyless geocoder as discovery source)
export async function collectPhotonPoi(ctx: GeoCtx): Promise<RawHit[]> {
  const bbox = `${ctx.lon - ctx.radiusKm / 90},${ctx.lat - ctx.radiusKm / 110},${ctx.lon + ctx.radiusKm / 90},${ctx.lat + ctx.radiusKm / 110}`;
  const queries: { q: string; osm: string; cat: RawHit["category"] }[] = [
    { q: "cafe", osm: "amenity:cafe", cat: "food" },
    { q: "restaurant", osm: "amenity:restaurant", cat: "food" },
    { q: "bakery", osm: "shop:bakery", cat: "food" },
    { q: "sweet shop", osm: "shop:sweet", cat: "food" },
    { q: "ice cream", osm: "amenity:ice_cream", cat: "food" },
    { q: "market", osm: "amenity:marketplace", cat: "market" },
    { q: "bazaar", osm: "shop:mall", cat: "market" },
    { q: "museum", osm: "tourism:museum", cat: "culture" },
    { q: "art gallery", osm: "tourism:gallery", cat: "culture" },
    { q: "temple", osm: "amenity:place_of_worship", cat: "culture" },
    { q: "dargah", osm: "amenity:place_of_worship", cat: "culture" },
    { q: "church", osm: "amenity:place_of_worship", cat: "culture" },
    { q: "fort", osm: "historic:castle", cat: "culture" },
    { q: "palace", osm: "historic:monument", cat: "culture" },
    { q: "park", osm: "leisure:park", cat: "nature" },
    { q: "garden", osm: "leisure:garden", cat: "nature" },
    { q: "lake", osm: "natural:water", cat: "nature" },
    { q: "waterfall", osm: "natural:waterfall", cat: "nature" },
    { q: "beach", osm: "natural:beach", cat: "nature" },
    { q: "viewpoint", osm: "tourism:viewpoint", cat: "nature" },
  ];
  const results = await Promise.allSettled(
    queries.map((c) =>
      getJson<{ features: { properties: { name?: string; osm_id?: number; osm_value?: string; osm_key?: string; street?: string; city?: string }; geometry: { coordinates: [number, number] } }[] }>(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(c.q)}&bbox=${bbox}&osm_tag=${encodeURIComponent(c.osm)}&limit=50&lang=en`,
        { timeoutMs: 12000, retries: 0 },
      ),
    ),
  );
  const hits: RawHit[] = [];
  const seen = new Set<string>();
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    for (const f of r.value.features) {
      const name = f.properties.name;
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      hits.push({
        id: hitId("photon", name, ctx.city),
        name,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        address: [f.properties.street, f.properties.city].filter(Boolean).join(", ") || undefined,
        category: queries[i].cat,
        source: "Photon (OSM index)",
        sourceUrl: "https://photon.komoot.io",
        note: `Geocoder POI match: ${queries[i].osm}`,
      });
    }
  });
  return hits;
}

// 10 ── GeoNames country dump (lazy one-time download, cached on disk)
interface GeoRow {
  name: string;
  lat: number;
  lon: number;
  fclass: string;
  fcode: string;
  pop: number;
}

let geoRows: GeoRow[] | null = null;

async function loadGeoNames(): Promise<GeoRow[]> {
  if (geoRows) return geoRows;
  const cacheDir = path.join(process.cwd(), "data", "cache");
  const txtPath = path.join(cacheDir, "geonames-in.txt");
  fs.mkdirSync(cacheDir, { recursive: true });
  let raw: string;
  if (fs.existsSync(txtPath)) {
    raw = fs.readFileSync(txtPath, "utf8");
  } else {
    const zipPath = path.join(cacheDir, "cities500.zip");
    if (!fs.existsSync(zipPath)) {
      const res = await fetchWithTimeout("https://download.geonames.org/export/dump/cities500.zip", {
        timeoutMs: 60000,
      });
      if (!res.ok) throw new Error(`GeoNames download HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(zipPath, buf);
    }
    raw = readSingleTxtFromZip(fs.readFileSync(zipPath)).toString("utf8");
    fs.writeFileSync(txtPath, raw.split("\n").filter((l) => l.includes("\tIN\t")).join("\n"));
  }
  geoRows = raw
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((c) => c.length > 14 && c[8] === "IN" && c[6] !== "R")
    .map((c) => ({ name: c[2] ?? "", lat: Number(c[4]), lon: Number(c[5]), fclass: c[6] ?? "", fcode: c[7] ?? "", pop: Number(c[14] ?? 0) }))
    .filter((r) => r.name);
  return geoRows;
}

function readSingleTxtFromZip(buf: Buffer): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("bad zip (no EOCD)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString();
    if (name.endsWith(".txt")) {
      const lNameLen = buf.readUInt16LE(lho + 26);
      const lExtraLen = buf.readUInt16LE(lho + 28);
      const start = lho + 30 + lNameLen + lExtraLen;
      const data = buf.slice(start, start + compSize);
      return method === 8 ? zlib.inflateRawSync(data) : data;
    }
    off += 46 + nameLen + extraLen + commLen;
  }
  throw new Error("no .txt entry in geonames zip");
}

export async function collectGeoNames(ctx: GeoCtx): Promise<RawHit[]> {
  const rows = (await loadGeoNames()).filter(
    (r) =>
      r.name.toLowerCase() !== ctx.city.toLowerCase() &&
      haversineKm(ctx.lat, ctx.lon, r.lat, r.lon) <= ctx.radiusKm &&
      r.name.match(/market|bazaar|bazar|mandai|fort|kill|gad|durg|ghat|temple|mandir|mahal|falls|hill|lake|park|garden|chowk|peth|wada|talao|talav|tank|baug|bagh|udyan|tekdi|beach|island|kund|point/i),
  );
  return rows
    .sort((a, b) => b.pop - a.pop)
    .slice(0, 250)
    .map((r) => {
      const n = r.name.toLowerCase();
      const category: RawHit["category"] = n.match(/fort|kill|gad|mahal|temple|mandir|ghat/)
        ? "culture"
        : n.match(/market|bazaar|bazar|mandai|chowk|peth/)
          ? "market"
          : n.match(/falls|hill|lake|park|garden/)
            ? "nature"
            : "hidden_gem";
      return {
        id: hitId("geonames", r.name, ctx.city),
        name: r.name,
        lat: r.lat,
        lon: r.lon,
        category,
        source: "GeoNames",
        sourceUrl: "https://www.geonames.org",
        note: `GeoNames feature ${r.fcode} · pop ${Intl.NumberFormat("en", { notation: "compact" }).format(r.pop)}`,
        tags: ["geonames", "hidden gem"],
      } satisfies RawHit;
    });
}

// ─── Amenity proximity (toilets / drinking water / ATM within 300 m) ─────────
export async function collectAmenityProximity(
  ctx: GeoCtx,
  points: { name: string; lat: number; lon: number }[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const targets = points.slice(0, 8);
  if (targets.length === 0) return out;
  const union = targets
    .map((p) => `node[amenity~"^(toilets|drinking_water|atm|pharmacy)$"](around:300,${p.lat},${p.lon});`)
    .join("\n");
  try {
    const els = await cached(
      `amenities:${ctx.city}:${targets.map((t) => t.name).join("|").slice(0, 120)}`,
      () => overpassQuery(`[out:json][timeout:20];\n(\n${union}\n);\nout tags 60;`, 14000),
    );
    for (const t of targets) {
      const found: string[] = [];
      for (const el of els) {
        const a = el.tags?.amenity;
        if (!a) continue;
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        if (elLat === undefined || elLon === undefined) continue;
        if (haversineKm(t.lat, t.lon, elLat, elLon) <= 0.4) {
          const label = a === "drinking_water" ? "Drinking water" : a === "toilets" ? "Toilets" : a === "atm" ? "ATM" : "Pharmacy";
          if (!found.includes(label)) found.push(label);
        }
      }
      if (found.length) out.set(t.name, found);
    }
  } catch {
    /* optional */
  }
  return out;
}

function stripHtml(s: string): string {
  return s.replaceAll(/<[^>]*>/g, "").trim();
}
