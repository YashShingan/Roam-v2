// ─── Post-processing pipeline: transit filter → dedup → categorize → enrich ─
import type { Category, Experience, PriceSample, SourceRef } from "./types";
import { dedupKey, haversineKm, tokenSim, meaningfulOverlap, isBareGeoFragment } from "./net";
import { hitId, type RawHit } from "./rawhit";
import { extractCanonicalLandmark, isJunkPlace, sanitizeCategory } from "./intelligence";
import { parsePriceSnippets, aggregatePriceHint } from "./price-engine";

// 1 ── Transit/road filter (spec §3 exact regexes)
const DROP_RE =
  /(railway station|metro station|bus station|bus stop|railway|junction|terminus|halt|station|road|highway|expressway|flyover|overpass|underpass|bridge|viaduct|footpath|footway|path|track|trail|street|lane|gully|marg|creek)/i;
const KEEP_RE =
  /(fort|killa|gad|heritage|historic|monument|palace|wada|gateway|gate|market|mandai|bazaar|bazar|mithai|sweet|farsan|bakery|bakers|cafe|chai)/i;

// Strictly reject non-visitable places: schools, colleges, residential buildings, clinics, banks, etc.
const NON_VISITABLE_RE =
  /\b(school|high\s*school|primary\s*school|secondary\s*school|convent|vidyalaya|shala|prathmik|madhyamik|kindergarten|pre-?school|nursery|playgroup|coaching|classes|tutorials|polytechnic|institute|junior\s*college|degree\s*college|college|university|vidyapeeth|campus|hostel|apartment|apartments|residency|heights|enclave|housing\s*society|co-?op\s*hsg|niwas|chawl|chambers|towers?|bungalow|villa|hospital|clinic|dispensary|pathology|diagnostic|maternity|nursing\s*home|dental|polyclinic|pharmacy|chemist|medical\s*store|bank|atm|branch|petrol\s*pump|cng\s*station|gas\s*station|service\s*station|garage|motor\s*driving|police\s*station|chowki|post\s*office|municipal\s*corporation|gram\s*panchayat|talathi|ward\s*office|court|hall\s*ticket|satta|matka|dpboss|assembly\s*constituency|constituency|vidhan\s*sabha|loco\s*shed|cantonment|tehsil\s*office|bus\s*depot|metro\s*depot|fuel\s*(?:station|pump)|filling\s*station|petrol\s*(?:pump|station)|madarsa|madrasa|\bclass\b|estates\b|developers\b)\b/i;

/** Clean mined names: news/book titles leak trailing separators
 * ("Durgadi Fort -", "Gateway | Mid-Day"). Also resolves photo dump names
 * to canonical landmark entities. */
export function normalizePlaceName(name: string): string {
  let n = extractCanonicalLandmark(name);
  n = n.replace(/\s+/g, " ").trim();
  n = n.replace(/[\s\-\u2013\u2014|:;,."]+$/g, "");
  n = n.replace(/^[\s\-\u2013\u2014|:;,."]+/, "");
  // curly quotes and possessive-city prefixes: "‘City of" → "City of",
  // "Mumbai's Film City" → "Film City"
  n = n.replace(/^[\u2018\u2019\u201C\u201D'"']+/, "");
  n = n.replace(/^[\u2018\u2019\u201C\u201D'"']+/, "");
  n = n.replace(/^(?:mumbai|pune|kalyan|thane|delhi|india)['\u2019]s\s+/i, "");
  // Wikipedia disambiguator suffixes: "Mula River (India)" → "Mula River"
  n = n.replace(/\s+\((?:India|Maharashtra|Mumbai|Pune|Kalyan|Thane|Delhi|Bangalore|Bengaluru)\)$/i, "");
  return extractCanonicalLandmark(n).trim();
}

export function isVisitablePlace(name: string, city: string): boolean {
  if (isJunkPlace(name)) return false;

  const n = name.trim().toLowerCase();
  const c = city.trim().toLowerCase();

  // 1. Check if name is literally just the city/town/taluka name
  if (
    n === c ||
    n === `${c} city` ||
    n === `${c} town` ||
    n === `${c} taluka` ||
    n === `${c} district` ||
    n === `${c}, maharashtra` ||
    n === `${c} junction` ||
    n === `${c} east` ||
    n === `${c} west` ||
    n.startsWith(`${c} (`)
  ) {
    return false;
  }

  // 2. Reject non-visitable categories (schools, colleges, residential buildings, clinics, banks)
  if (NON_VISITABLE_RE.test(n)) {
    return false;
  }

  // 3. Reject transit/roads unless it is a recognized heritage / market / food spot
  if (DROP_RE.test(n) && !KEEP_RE.test(n)) {
    return false;
  }

  return true;
}

// 3 ── Categorize
const CAT_RULES: { re: RegExp; cat: Category }[] = [
  { re: /(cafe|coffee|chai|bakery|bakiers|restaurant|eatery|food court|food|misal|vada|samosa|mithai|sweet|farsan|ice.?cream|cuisine|dhaba|canteen)/i, cat: "food" },
  { re: /(market|bazaar|bazar|mandai|emporium|mall|shopping|chowk|peth|souq)/i, cat: "market" },
  { re: /(fort|kill[aā]|palace|mahal|museum|temple|mandir|mosque|dargah|church|basilica|cave|heritage|monument|wada|gad|art gallery|gallery|memorial park)/i, cat: "culture" },
  { re: /(park|garden|lake|talav|hill|waterfall|falls|beach|viewpoint|view point|nature|forest|sanctuary|ghat)/i, cat: "nature" },
  { re: /(trek|trail|hike|adventure|kayak|raft|camp)/i, cat: "adventure" },
  { re: /(bar|pub|brewery|lounge|nightlife|club)/i, cat: "nightlife" },
  { re: /(workshop|studio|pottery|artisan|craft|weaving|class)/i, cat: "workshop" },
];

function categorize(h: RawHit): Category {
  let cat: Category = h.category ?? "hidden_gem";
  if (!h.category) {
    const text = `${h.name} ${h.tags?.join(" ") ?? ""}`;
    for (const { re, cat: c } of CAT_RULES) {
      if (re.test(text)) {
        cat = c;
        break;
      }
    }
  }
  return sanitizeCategory(cat, h.name) as Category;
}

// ── Sentiment from quote text (never fabricated — 0 when no quotes)
const POS = /\b(good|great|amazing|best|lovely|love|delicious|awesome|beautiful|worth|excellent|hidden gem|must|fantastic|charming|friendly|fresh)\b/i;
const NEG = /\b(bad|worst|avoid|overrated|dirty|crowded|expensive|skip|disappointing|stale|rude|smelly|boring|waste)\b/i;

function sentimentOf(quotes: { text: string }[]): number {
  if (quotes.length === 0) return 0;
  let pos = 0;
  let neg = 0;
  for (const q of quotes) {
    const p = POS.test(q.text);
    const n = NEG.test(q.text);
    if (p && !n) pos++;
    else if (n && !p) neg++;
    else if (p && n) pos += 0.5;
  }
  const total = pos + neg;
  return total === 0 ? 0 : Number(((pos - neg) / total).toFixed(2));
}

// 4 ── Price/duration/best-time heuristics (clearly labeled as estimates)
const PRICE_EST: Record<Category, number> = {
  food: 220,
  market: 180,
  culture: 110,
  nature: 0,
  adventure: 700,
  nightlife: 500,
  workshop: 450,
  hidden_gem: 140,
};

const DURATION_EST: Record<Category, number> = {
  food: 50,
  market: 75,
  culture: 90,
  nature: 60,
  adventure: 180,
  nightlife: 120,
  workshop: 90,
  hidden_gem: 45,
};

const BEST_TIME: Record<Category, string> = {
  food: "Evenings (5–9 PM)",
  market: "Morning (8–11 AM)",
  culture: "Early morning or late afternoon",
  nature: "Sunrise or golden hour",
  adventure: "Early morning",
  nightlife: "After 8 PM",
  workshop: "Afternoon",
  hidden_gem: "Any time — locals favor off-peak",
};

function computeBestTime(h: RawHit, cat: Category): { bestTime: string; goldenHour: boolean } {
  const n = h.name.toLowerCase();
  const isGolden = /viewpoint|view point|fort|lake|beach|hill|falls|waterfall|sunset|ghat|palace/.test(n) || cat === "nature";
  if (/sunset|sunrise/.test(n)) return { bestTime: "Sunrise / sunset — the name says it", goldenHour: true };
  if (isGolden) return { bestTime: BEST_TIME[cat], goldenHour: true };
  return { bestTime: BEST_TIME[cat], goldenHour: false };
}

function fmtCompact(n: number): string {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function popularityText(h: RawHit): { note: string; score: number } {
  if (h.popularityNote) return { note: h.popularityNote, score: h.popularityScore ?? 0.2 };
  if ((h.mentions ?? 0) > 0)
    return {
      note: `🗣 ${h.mentions} community mention${(h.mentions ?? 0) > 1 ? "s" : ""}`,
      score: Math.min(0.2 + (h.mentions ?? 0) * 0.12, 0.9),
    };
  const hasWiki = h.source.startsWith("Wikipedia") || h.source === "Wikidata";
  if (hasWiki) return { note: "📖 Referenced on Wikipedia", score: 0.25 };
  return { note: "New — no community signal yet", score: 0.08 };
}

// ─── Main pipeline ───────────────────────────────────────────────────────────
export function runPipeline(hits: RawHit[], cityLabel: string): Experience[] {
  // 1. transit/road + non-visitable filter (no schools, colleges, apartments, city names)
  const rawCity = cityLabel.split(",")[0].trim();
  for (const h of hits) h.name = normalizePlaceName(h.name);
  const filtered = hits.filter((h) => {
    if (h.source === "Editorial deep-link") return true;
    // mined geography fragments ("India's", "West Asia", "Kolkata" in a
    // Pune run) are never venues — even when a category keyword leaked in
    // from the surrounding sentence
    if (isBareGeoFragment(h.name)) return false;
    // lowercase possessive fragments ("cafe's", "mani's") — never venues.
    // Capitalized ones ("Nando's") survive unless the base is a geo name.
    if (/[\u2019']s$/i.test(h.name) && /^[a-z]/.test(h.name)) return false;
    // text-mined hit with no coords AND no category signal → not a place
    // (kills "City of Trees"-style NLP misfires from Reddit/News/YouTube/books)
    if (!h.category && h.lat === undefined) return false;
    // story fragments from news/book mining ("Could", "Dwemer ruins",
    // "Pune Fort Murder") — text-mined culture/nature hits need a location;
    // food/market/nightlife recs keep working on quotes alone
    if (
      h.lat === undefined &&
      /reddit|news|youtube|books/i.test(h.source) &&
      /^(culture|hidden_gem|nature|adventure)$/.test(h.category ?? "")
    )
      return false;
    return isVisitablePlace(h.name, rawCity);
  });

  // 2. dedup: exact key OR token-sim ≥85 OR coords ≤120 m + sim ≥60.
  // Token inverted-index + coord grid keep this fast on uncapped collector
  // output (10k+ hits) instead of comparing every hit against every cluster.
  interface Cluster {
    primary: RawHit;
    members: RawHit[];
    idx: number;
  }
  const clusters: Cluster[] = [];
  const keyToCluster = new Map<string, Cluster>();
  const tokenIndex = new Map<string, Set<number>>();
  const gridIndex = new Map<string, Set<number>>();
  for (const h of filtered) {
    const key = dedupKey(h.name);
    const cell =
      h.lat !== undefined && h.lon !== undefined
        ? `${Math.round(h.lat / 0.002)}:${Math.round(h.lon / 0.002)}`
        : null;
    let target: Cluster | null = key ? keyToCluster.get(key) ?? null : null;
    if (!target) {
      const canonH = extractCanonicalLandmark(h.name).toLowerCase();
      const candidates = new Set<number>();
      if (key) for (const w of key.split(" ")) for (const i of tokenIndex.get(w) ?? []) candidates.add(i);
      if (cell) for (const i of gridIndex.get(cell) ?? []) candidates.add(i);
      for (const i of candidates) {
        const c2 = clusters[i];
        const sim = tokenSim(h.name, c2.primary.name);
        const canonC2 = extractCanonicalLandmark(c2.primary.name).toLowerCase();
        const canonSim = tokenSim(canonH, canonC2);
        const near =
          cell !== null &&
          c2.primary.lat !== undefined &&
          c2.primary.lon !== undefined &&
          haversineKm(h.lat as number, h.lon as number, c2.primary.lat, c2.primary.lon) <= 0.25;
        const sameCanon =
          canonH.length > 3 &&
          (canonH === canonC2 || canonH.includes(canonC2) || canonC2.includes(canonH));

        if (
          sim >= 85 ||
          canonSim >= 85 ||
          (near && (sim >= 40 || canonSim >= 50 || sameCanon)) ||
          (sameCanon && canonH.length > 5 && !/park|temple|garden|lake|museum/i.test(canonH))
        ) {
          target = c2;
          break;
        }
      }
    }
    if (target) {
      target.members.push(h);
    } else {
      target = { primary: h, members: [h], idx: clusters.length };
      clusters.push(target);
      if (cell) {
        let set = gridIndex.get(cell);
        if (!set) gridIndex.set(cell, (set = new Set()));
        set.add(target.idx);
      }
    }
    if (key) {
      if (!keyToCluster.has(key)) keyToCluster.set(key, target);
      for (const w of key.split(" ")) {
        let set = tokenIndex.get(w);
        if (!set) tokenIndex.set(w, (set = new Set()));
        set.add(target.idx);
      }
    }
  }

  const experiences = clusters.map((cluster): Experience => {
    const members = cluster.members;
    const primary = members.reduce((best, m) => {
      const bNoise = /[\d_-]{4,}|\b(?:am|pm)\b|\(\d+\)/i.test(best.name) ? -40 : 0;
      const mNoise = /[\d_-]{4,}|\b(?:am|pm)\b|\(\d+\)/i.test(m.name) ? -40 : 0;
      const bl =
        (best.description?.length ?? 0) +
        (best.popularityScore ?? 0) * 100 +
        (best.website ? 5 : 0) +
        (best.lat !== undefined ? 30 : 0) +
        bNoise;
      const ml =
        (m.description?.length ?? 0) +
        (m.popularityScore ?? 0) * 100 +
        (m.website ? 5 : 0) +
        (m.lat !== undefined ? 30 : 0) +
        mNoise;
      return ml > bl ? m : best;
    }, members[0]);

    // union sources
    const sources: SourceRef[] = [];
    const seenSrc = new Set<string>();
    for (const m of members) {
      const key = `${m.source}|${m.sourceUrl ?? ""}`;
      if (seenSrc.has(key)) continue;
      seenSrc.add(key);
      sources.push({ source: m.source, url: m.sourceUrl, note: m.note });
    }

    // community signal — summed/merged, never fabricated
    const quotes = members
      .flatMap((m) => m.quotes ?? [])
      .filter((q, i, arr) => arr.findIndex((x) => x.text === q.text) === i)
      .slice(0, 6);
    const mentions = members.reduce((a, m) => a + (m.mentions ?? 0), 0);
    const upvotes = members.reduce((a, m) => a + (m.upvotes ?? 0), 0);
    const priceHints = members.map((m) => m.priceHint).filter((p): p is number => !!p && p > 0);

    const category = categorize(primary);
    const pop = popularityText(primary);
    const bt = computeBestTime(primary, category);
    const name = extractCanonicalLandmark(primary.name) || primary.name;
    const lat = primary.lat;
    const lon = primary.lon;
    const description = primary.description || members.map((m) => m.description).find((d) => !!d);

    // Extract structured price samples from descriptions, community quotes, and collector hints
    const priceSamples: PriceSample[] = [];
    if (description) {
      priceSamples.push(...parsePriceSnippets(description, "description", primary.sourceUrl, category));
    }
    for (const q of quotes) {
      if (q.text) {
        priceSamples.push(...parsePriceSnippets(q.text, "community_quote", q.permalink, category));
      }
    }
    for (const m of members) {
      if (m.priceHint !== undefined && m.priceHint !== null && m.priceHint >= 0) {
        priceSamples.push({
          value: m.priceHint,
          value_max: m.priceHint,
          unit: "INR",
          context: category === "food" ? "meal" : "entry",
          source: m.source,
          url: m.sourceUrl ?? null,
          raw_snippet: m.note ?? `${m.source}: ₹${m.priceHint}`,
          confidence: 0.7,
        });
      }
    }
    const computedPriceHint = aggregatePriceHint(priceSamples, category);
    const resolvedPricePerPerson = computedPriceHint
      ? Math.round(computedPriceHint.per_person ?? computedPriceHint.min)
      : priceHints.length
        ? Math.round(Math.min(...priceHints))
        : undefined;

    const exp: Experience = {
      id: hitId("merged", `${sources[0]?.source ?? "x"}-${name}`, cityLabel.split(",")[0]),
      name,
      category,
      source: sources[0]?.source ?? "OpenStreetMap",
      sources,
      description,
      lat,
      lon,
      address: primary.address ?? "Not listed",
      popularity: pop.note,
      popularityScore: pop.score,
      community: {
        mentions,
        upvotes,
        sentiment: sentimentOf(quotes),
        quotes,
        priceHint: resolvedPricePerPerson,
        hiddenGem: mentions <= 2 && mentions > 0 && !/mall|department/i.test(name),
        crowdWarning:
          quotes.filter((q) => /crowded|queue|rush|packed|busy/i.test(q.text)).length >= 2,
      },
      pricePerPerson: resolvedPricePerPerson,
      priceIsEstimate: !computedPriceHint && priceHints.length === 0,
      priceHint: computedPriceHint,
      durationMinutes: DURATION_EST[category],
      openingHoursRaw: members.map((m) => m.openingHoursRaw).find((o) => !!o),
      isOutdoor: primary.isOutdoor ?? category === "nature",
      wheelchairAccessible: members.map((m) => m.wheelchair).find((w) => w !== null && w !== undefined) ?? null,
      goodForKids: members.map((m) => m.kids).find((w) => w !== null && w !== undefined) ?? null,
      bookingRequired: /ticket|reservation|booking/i.test(primary.description ?? "") && /advance|required|book/i.test(primary.description ?? ""),
      tags: [...new Set(members.flatMap((m) => m.tags ?? []))].slice(0, 8),
      imageUrl: members.map((m) => m.imageUrl).find((i) => !!i),
      amenities: [],
      osmId: primary.osmId,
      osmType: primary.osmType,
      website: members.map((m) => m.website).find((w) => !!w),
      gmapsUrl: lat !== undefined && lon !== undefined ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : undefined,
      gmapsDirectionsUrl: lat !== undefined && lon !== undefined ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}` : undefined,
      bestTime: bt.bestTime,
      goldenHour: bt.goldenHour,
    };
    return exp;
  });

  // Stable ids even when sources merge differently across runs
  for (const e of experiences) {
    e.id = `x_${dedupKey(e.name).replace(/\s+/g, "-").slice(0, 40) || "place"}_${e.category}`;
  }

  // 5. enrichment pass: wiki extract reuse + commons photo proximity
  const commonsShots = hits.filter((h) => h.source === "Wikimedia Commons" && h.lat !== undefined);

  for (const e of experiences) {
    if (e.imageUrl || e.lat === undefined || e.lon === undefined) continue;
    let best: { d: number; url: string } | null = null;
    for (const c of commonsShots) {
      if (c.lat === undefined || c.lon === undefined || !c.imageUrl) continue;
      // proximity alone proves nothing — the nearest geotagged photo is often
      // of something else entirely. Require a name-token match too.
      if (meaningfulOverlap(e.name, c.name, rawCity) === 0) continue;
      const d = haversineKm(e.lat, e.lon, c.lat, c.lon);
      if (d <= 0.5 && (!best || d < best.d)) best = { d, url: c.imageUrl };
    }
    if (best?.url) e.imageUrl = best.url;
  }

  return experiences;
}

// ─── Client-side filter/sort helpers (shared with UI) ────────────────────────
export function openNowFromHours(raw: string | undefined, now = new Date()): boolean | null {
  if (!raw) return null;
  const time = now.getHours() * 60 + now.getMinutes();
  // Parse common OSM forms: "Mo-Sa 09:00-21:00", "24/7", "Mo-Fr 10:00-20:00; Sa 09:00-14:00"
  if (/24\/7/.test(raw)) return true;
  const dayMap: Record<string, number> = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 0 };
  const keys = Object.keys(dayMap);
  const expandDays = (spec: string): number[] => {
    const out: number[] = [];
    for (const piece of spec.split(",")) {
      const rng = piece.trim().match(/^([A-Za-z]{2})-([A-Za-z]{2})$/);
      if (rng) {
        const i1 = keys.indexOf(rng[1].toLowerCase());
        const i2 = keys.indexOf(rng[2].toLowerCase());
        if (i1 > -1 && i2 > -1) {
          for (let i = i1; ; i = (i + 1) % 7) {
            out.push(dayMap[keys[i]]);
            if (i === i2) break;
          }
          continue;
        }
      }
      const single = dayMap[piece.trim().toLowerCase()];
      if (single !== undefined) out.push(single);
    }
    return out;
  };
  let anyRule = false;
  let open = false;
  for (const part of raw.split(";")) {
    const m = part.trim().match(/^([A-Za-z,\-]*)\s*(?:(\d{1,2}):(\d{2}))?\s*-\s*(?:(\d{1,2}):(\d{2}))?$/);
    if (!m) continue;
    const startMin = m[2] ? Number(m[2]) * 60 + Number(m[3]) : 0;
    const endMin = m[4] ? Number(m[4]) * 60 + Number(m[5]) : 1440;
    const days = m[1] ? expandDays(m[1]) : [];
    if (days.length === 0) {
      anyRule = true;
      if (time >= startMin && time <= endMin) open = true;
      continue;
    }
    anyRule = true;
    if (days.includes(now.getDay()) && time >= startMin && time <= endMin) open = true;
  }
  return anyRule ? open : null;
}
