// ─── Social & web collectors: Reddit, News RSS, Google My Maps KML, books,
// ─── editorial deep-links, YouTube proxy ladder. Venue mining + geocoding. ──
import { XMLParser } from "fast-xml-parser";
import nlp from "compromise";
import { getJson, getText, haversineKm } from "./net";
import { hitId, type GeoCtx, type RawHit } from "./rawhit";
import { isVisitablePlace } from "./pipeline";

// ─── Venue-name mining (regex + compromise NLP) ─────────────────────────────
const BLACKLIST =
  /^(this|that|there|here|it|them|the place|place|map|google|maps|india|mumbai|pune|kalyan|thane|delhi|market|bazaar|bazar|fort|temple|cafe|coffee|food|street|area|city|town|morning|evening|today|tomorrow|one|two|three|video|channel|guy|people|anyone|someone|budget|trip|travel|vlog|day|days|hour|hours)$/i;

function properNouns(sentence: string): string[] {
  const out = new Set<string>();
  // quoted phrases
  for (const m of sentence.matchAll(/[“"']([A-Z][^“"']{2,40})[”"']/g)) out.add(m[1].trim());
  // after discovery verbs
  const verbRe =
    /\b(?:try|visit|check out|checkout|explore|head to|head over to|go to|went to|stop at|stopped at|grab(?: a coffee)? (?:at|from)|eat at|dine at|don't miss|must visit|must-see|recommend(?:s|ed)?)\s+(?:the\s+|a\s+)?([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,3})/g;
  for (const m of sentence.matchAll(verbRe)) out.add(m[1].trim());
  // compromise NLP places
  try {
    for (const p of nlp(sentence).places()?.out("array") ?? []) out.add(p.trim());
    for (const p of nlp(sentence).match("#Place+")?.out("array") ?? []) out.add(p.trim());
  } catch {
    /* nlp optional */
  }
  return [...out].filter((n) => {
    const clean = n.replace(/[.,!?;:]+$/, "");
    return (
      clean.length >= 3 &&
      clean.length <= 42 &&
      /[a-zA-Z]/.test(clean) &&
      !BLACKLIST.test(clean) &&
      !clean.match(/^\d/)
    );
  }).map((n) => n.replace(/[.,!?;:]+$/, ""));
}

export function mineSentences(text: string): string[] {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length >= 25 && s.length <= 300);
}

interface GeocodedName {
  name: string;
  lat: number;
  lon: number;
}

/** Geocode candidate names via Photon (keyless, lenient rate limits). */
async function geocodeCandidates(names: string[], ctx: GeoCtx, cap: number): Promise<GeocodedName[]> {
  const uniq = [...new Set(names)].filter((n) => isVisitablePlace(n, ctx.city)).slice(0, cap);
  const out: { name: string; lat: number; lon: number }[] = [];
  const batches: string[][] = [];
  for (let i = 0; i < uniq.length; i += 8) batches.push(uniq.slice(i, i + 8));
  for (const batch of batches) {
    const res = await Promise.allSettled(
      batch.map(async (name) => {
        const j = await getJson<{
          features: { properties: Record<string, string>; geometry: { coordinates: [number, number] } }[];
        }>(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(`${name} ${ctx.city}`)}&limit=1&lang=en`,
          { timeoutMs: 7000, retries: 0 },
        );
        const f = j.features?.[0];
        if (!f) return null;
        const lat = f.geometry.coordinates[1];
        const lon = f.geometry.coordinates[0];
        if (haversineKm(ctx.lat, ctx.lon, lat, lon) > ctx.radiusKm * 1.6) return null;
        return { name, lat, lon };
      }),
    );
    for (const r of res) if (r.status === "fulfilled" && r.value) out.push(r.value);
    if (out.length >= cap) break;
  }
  return out.slice(0, cap);
}

function sourceCategory(text: string): RawHit["category"] {
  const n = text.toLowerCase();
  if (n.match(/fort|palace|museum|temple|heritage|history|cave/)) return "culture";
  if (n.match(/market|bazaar|bazar|shopping|mall/)) return "market";
  if (n.match(/cafe|coffee|food|eat|restaurant|bakery|samosa|vada|misal|street food/)) return "food";
  if (n.match(/park|lake|hill|waterfall|sunset|nature|beach/)) return "nature";
  if (n.match(/trek|trail|hike|adventure|kayak|raft/)) return "adventure";
  if (n.match(/bar|pub|brewery|lounge/)) return "nightlife";
  if (n.match(/workshop|studio|pottery|art class|craft/)) return "workshop";
  return undefined;
}

// 5 ── Reddit (RSS → old.reddit fallback → PullPush.io)
export async function collectReddit(ctx: GeoCtx): Promise<RawHit[]> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const texts: { text: string; permalink?: string; score?: number }[] = [];

  try {
    const rss = await getText(
      `https://www.reddit.com/search.rss?q=${encodeURIComponent(`${ctx.city} (cafe OR market OR fort OR bazaar OR "check out" OR "must visit")`)}&sort=top&t=year&limit=40`,
      { timeoutMs: 12000, retries: 0, headers: { "Accept-Language": "en-IN" } },
    );
    const feed = parser.parse(rss) as { feed?: { entry?: Record<string, unknown>[] } };
    for (const e of feed.feed?.entry ?? []) {
      const content = String((e.content as { "@_type"?: string; "#text"?: string } | undefined)?.["#text"] ?? "");
      const link = (e.link as { "@_href"?: string } | undefined)?.["@_href"];
      texts.push({ text: `${String(e.title ?? "")}. ${content}`, permalink: link });
    }
  } catch {
    /* reddit rss blocked — PullPush below still runs */
  }

  try {
    const pp = await getJson<{ data?: { title?: string; selftext?: string; score?: number; permalink?: string }[] }>(
      `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(ctx.city)}&size=50&sort_type=score&sort=desc`,
      { timeoutMs: 15000, retries: 0 },
    );
    for (const s of pp.data ?? []) {
      if ((s.score ?? 0) < 3) continue;
      texts.push({
        text: `${s.title ?? ""}. ${s.selftext ?? ""}`,
        permalink: s.permalink ? `https://www.reddit.com${s.permalink}` : undefined,
        score: s.score,
      });
    }
  } catch {
    /* pullpush down */
  }

  const hits: RawHit[] = [];
  for (const t of texts.slice(0, 120)) {
    for (const sentence of mineSentences(t.text)) {
      if (!sentence.match(/\b(try|visit|check out|explore|head to|go to|eat|grab|recommend|must|best)\b/i)) continue;
      if (!sentence.match(new RegExp(ctx.city.split(" ")[0], "i")) && !sourceCategory(sentence)) continue;
      for (const name of properNouns(sentence)) {
        hits.push({
          id: hitId("reddit", name, ctx.city),
          name,
          category: sourceCategory(sentence),
          source: "Reddit",
          sourceUrl: t.permalink,
          note: "Community recommendation thread",
          mentions: 1,
          upvotes: t.score ?? 0,
          quotes: [{ text: sentence.trim(), permalink: t.permalink }],
          tags: ["reddit"],
        });
        if (hits.length > 400) return hits;
      }
    }
  }
  const topNames = [...hits.slice(0, 200).reduce((m, h) => m.set(h.name, (m.get(h.name) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([n]) => n);
  const geocoded = await geocodeCandidates(topNames, ctx, 30);
  const byName = new Map(geocoded.map((g) => [g.name.toLowerCase(), g] as const));
  for (const h of hits) {
    const g = byName.get(h.name.toLowerCase());
    if (g) {
      h.lat = g.lat;
      h.lon = g.lon;
    }
  }
  return hits.filter((h) => h.lat !== undefined || (h.quotes?.length ?? 0) > 0).slice(0, 200);
}

// 6 ── Google News RSS
export async function collectNews(ctx: GeoCtx): Promise<RawHit[]> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const rss = await getText(
    `https://news.google.com/rss/search?q=${encodeURIComponent(`${ctx.city} (market OR fort OR heritage OR cafe OR bazaar)`)}&hl=en-IN&gl=IN&ceid=IN:en`,
    { timeoutMs: 12000, retries: 0 },
  );
  const feed = parser.parse(rss) as { rss?: { channel?: { item?: Record<string, unknown>[] } } };
  const items = feed.rss?.channel?.item ?? [];
  const hits: RawHit[] = [];
  for (const it of items.slice(0, 100)) {
    const title = String(it.title ?? "");
    if (!title) continue;
    for (const name of properNouns(title)) {
      if (BLACKLIST.test(name)) continue;
      hits.push({
        id: hitId("news", name, ctx.city),
        name,
        category: sourceCategory(title),
        source: "Google News",
        sourceUrl: String(it.link ?? ""),
        note: `In the news: ${String(it.source as string ?? "press")}`,
        mentions: 1,
        quotes: [{ text: title, permalink: String(it.link ?? "") }],
        tags: ["news"],
      });
      if (hits.length > 100) return hits;
    }
  }
  const topNames = [...hits.reduce((m, h) => m.set(h.name, (m.get(h.name) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([n]) => n);
  const geocoded = await geocodeCandidates(topNames, ctx, 15);
  const byName = new Map(geocoded.map((g) => [g.name.toLowerCase(), g] as const));
  for (const h of hits) {
    const g = byName.get(h.name.toLowerCase());
    if (g) {
      h.lat = g.lat;
      h.lon = g.lon;
    }
  }
  return hits.slice(0, 60);
}

// ─── Meta-search rotation (DDG html → Mojeek), keyless, fail-soft ───────────
async function metaSearch(query: string, cap = 8): Promise<{ title: string; url: string }[]> {
  try {
    const html = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      timeoutMs: 12000,
      retries: 0,
      headers: { "Accept-Language": "en-IN,en" },
    });
    const out: { title: string; url: string }[] = [];
    const seen = new Set<string>();
    for (const m of html.matchAll(/result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      let url = m[1];
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      const title = m[2].replace(/<[^>]*>/g, "").trim();
      if (!url.startsWith("http") || seen.has(url) || !title) continue;
      seen.add(url);
      out.push({ title, url });
      if (out.length >= cap) return out;
    }
    if (out.length > 0) return out;
  } catch {
    /* ddg blocked */
  }
  try {
    const html = await getText(`https://www.mojeek.com/search?q=${encodeURIComponent(query)}`, {
      timeoutMs: 12000,
      retries: 0,
    });
    const out: { title: string; url: string }[] = [];
    for (const m of html.matchAll(/<a[^>]+class="title[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const title = m[2].replace(/<[^>]*>/g, "").trim();
      if (!m[1].startsWith("http") || !title) continue;
      out.push({ title, url: m[1] });
      if (out.length >= cap) break;
    }
    return out;
  } catch {
    return [];
  }
}

// 8 ── Google My Maps KML via meta-search
export async function collectGMyMaps(ctx: GeoCtx): Promise<RawHit[]> {
  const results = await metaSearch(
    `site:google.com/maps/d "${ctx.city}" (heritage OR market OR food OR fort)`,
    10,
  );
  const mids = new Set<string>();
  for (const r of results) {
    const m = r.url.match(/mid=([A-Za-z0-9_.-]{10,})/);
    if (m) mids.add(m[1]);
    if (mids.size >= 6) break;
  }
  const parser = new XMLParser({ ignoreAttributes: false });
  const hits: RawHit[] = [];
  for (const mid of mids) {
    try {
      const kml = await getText(`https://www.google.com/maps/d/kml?mid=${mid}&force=lite`, {
        timeoutMs: 12000,
        retries: 0,
      });
      const doc = parser.parse(kml) as unknown;
      const placemarks: { name?: string; description?: string; coordinates?: string }[] = [];
      const walk = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        const obj = node as Record<string, unknown>;
        if (typeof obj["name"] === "string" && typeof obj["coordinates"] === "string") {
          placemarks.push({
            name: obj["name"],
            description: typeof obj["description"] === "string" ? obj["description"] : undefined,
            coordinates: obj["coordinates"],
          });
        }
        for (const v of Object.values(obj)) {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === "object") walk(v);
        }
      };
      walk(doc);
      for (const pm of placemarks) {
        const name = pm.name?.trim();
        const coords = pm.coordinates?.trim().split(/\s+/)[0];
        if (!name || !coords) continue;
        const [lonS, latS] = coords.split(",").map(Number);
        if (!Number.isFinite(latS) || !Number.isFinite(lonS)) continue;
        if (haversineKm(ctx.lat, ctx.lon, latS, lonS) > ctx.radiusKm * 1.6) continue;
        hits.push({
          id: hitId("gmymaps", name, ctx.city),
          name,
          lat: latS,
          lon: lonS,
          description: pm.description?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400),
          category: sourceCategory(name) ?? "hidden_gem",
          source: "Google My Maps (community)",
          sourceUrl: `https://www.google.com/maps/d/viewer?mid=${mid}`,
          note: "Community-curated custom map layer",
          tags: ["community map"],
        });
      }
      if (hits.length >= 150) break;
    } catch {
      /* kml fetch failed for this mid */
    }
  }
  return hits;
}

// 9 ── Public-domain books: Wikisource + Gutendex + Internet Archive
export async function collectBooks(ctx: GeoCtx): Promise<RawHit[]> {
  const hits: RawHit[] = [];
  const sentences: { text: string; ref: string; url?: string }[] = [];

  try {
    const ws = await getJson<{ query?: { search?: { title: string; snippet: string }[] } }>(
      `https://en.wikisource.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${ctx.city} market OR bazaar OR fort OR ghat`)}&srlimit=15&format=json&formatversion=2`,
      { timeoutMs: 12000, retries: 0 },
    );
    for (const s of ws.query?.search ?? []) {
      const clean = s.snippet.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&");
      for (const sentence of mineSentences(clean)) {
        if (sentence.match(/\b(market|bazaar|bazar|fort|temple|ghat|street|palace|cafe)\b/i)) {
          sentences.push({
            text: sentence,
            ref: `“${s.title}”, Wikisource (public domain)`,
            url: `https://en.wikisource.org/wiki/${encodeURIComponent(s.title.replaceAll(" ", "_"))}`,
          });
        }
      }
    }
  } catch {
    /* wikisource down */
  }

  try {
    const gx = await getJson<{ results?: { id: number; title: string; formats: Record<string, string> }[] }>(
      `https://gutendex.com/books?search=${encodeURIComponent(ctx.city)}&copyright=false`,
      { timeoutMs: 12000, retries: 0 },
    );
    const book = gx.results?.[0];
    const txtUrl =
      book?.formats?.["text/plain; charset=utf-8"] ?? book?.formats?.["text/plain; charset=us-ascii"];
    if (book && txtUrl) {
      const full = await getText(txtUrl, { timeoutMs: 20000, retries: 0 });
      const slice = full.slice(0, 600000);
      for (const sentence of mineSentences(slice)) {
        if (
          sentence.match(new RegExp(ctx.city.split(" ")[0], "i")) &&
          sentence.match(/\b(market|bazaar|bazar|fort|temple|ghat|street|palace)\b/i) &&
          sentences.length < 100
        ) {
          sentences.push({ text: sentence, ref: `“${book.title}”, Project Gutenberg (public domain)`, url: `https://www.gutenberg.org/ebooks/${book.id}` });
        }
      }
    }
  } catch {
    /* gutenberg down */
  }

  try {
    const ia = await getJson<{ response?: { docs?: { identifier: string; title?: string }[] } }>(
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`${ctx.city} AND mediatype:texts`)}&fl%5B%5D=identifier&fl%5B%5D=title&rows=3&output=json`,
      { timeoutMs: 12000, retries: 0 },
    );
    for (const doc of ia.response?.docs ?? []) {
      try {
        const meta = await getJson<{ server?: string; dir?: string }>(
          `https://archive.org/metadata/${doc.identifier}`,
          { timeoutMs: 8000, retries: 0 },
        );
        if (!meta.server || !meta.dir) continue;
        const inside = await getJson<{ matches?: { text: string }[] }>(
          `https://${meta.server}/fulltext/inside.php?item_id=${doc.identifier}&doc=${doc.identifier}&path=${meta.dir}&q=${encodeURIComponent(`${ctx.city} market`)}`,
          { timeoutMs: 10000, retries: 0 },
        );
        for (const m of inside.matches ?? []) {
          for (const sentence of mineSentences(m.text)) {
            if (sentence.match(/\b(market|bazaar|bazar|fort|temple|ghat|street|palace)\b/i) && sentences.length < 150) {
              sentences.push({
                text: sentence,
                ref: `“${doc.title ?? doc.identifier}”, Internet Archive (public domain)`,
                url: `https://archive.org/details/${doc.identifier}`,
              });
            }
          }
        }
      } catch {
        /* per-book failure */
      }
    }
  } catch {
    /* archive down */
  }

  const names = new Set<string>();
  for (const s of sentences) for (const n of properNouns(s.text)) names.add(n);
  const geocoded = await geocodeCandidates([...names], ctx, 30);
  const byName = new Map(geocoded.map((g) => [g.name.toLowerCase(), g] as const));

  for (const s of sentences.slice(0, 150)) {
    for (const name of properNouns(s.text)) {
      if (BLACKLIST.test(name)) continue;
      const g = byName.get(name.toLowerCase());
      hits.push({
        id: hitId("books", name, ctx.city),
        name,
        lat: g?.lat,
        lon: g?.lon,
        category: sourceCategory(s.text),
        source: "Public-domain books",
        sourceUrl: s.url,
        note: s.ref,
        mentions: 1,
        quotes: [{ text: s.text.trim(), permalink: s.url }],
        tags: ["book quote"],
      });
      if (hits.length > 150) return hits;
    }
  }
  return hits.filter((h) => h.lat !== undefined).slice(0, 60);
}

// 11 ── Editorial deep links (ToS-safe: link out only)
const EDITORIAL_SOURCES: { site: string; label: string; cat: RawHit["category"] }[] = [
  { site: "wikiloc.com", label: "Wikiloc", cat: "adventure" },
  { site: "alltrails.com", label: "AllTrails", cat: "adventure" },
  { site: "eventbrite.com", label: "Eventbrite", cat: "workshop" },
  { site: "meetup.com", label: "Meetup", cat: "workshop" },
  { site: "sahapedia.org", label: "Sahapedia", cat: "culture" },
  { site: "puratattva.in", label: "Puratattva", cat: "culture" },
  { site: "maharashtratourism.gov.in", label: "MTDC", cat: "culture" },
  { site: "incredibleindia.org", label: "Incredible India", cat: "culture" },
];

export async function collectEditorial(ctx: GeoCtx): Promise<RawHit[]> {
  const picks = await Promise.allSettled(
    EDITORIAL_SOURCES.map((s) => metaSearch(`site:${s.site} ${ctx.city}`, 2).then((rs) => ({ s, rs }))),
  );
  const hits: RawHit[] = [];
  for (const p of picks) {
    if (p.status !== "fulfilled") continue;
    for (const r of p.value.rs.slice(0, 3)) {
      const name = r.title
        .replace(/\s*[-|–]\s*(Wikiloc|AllTrails|Eventbrite|Meetup|Sahapedia|Puratattva|MTDC|Maharashtra Tourism|Incredible India!?).*/i, "")
        .trim()
        .slice(0, 70);
      if (!name || name.length < 4) continue;
      hits.push({
        id: hitId(`editorial-${p.value.s.site}`, name, ctx.city),
        name,
        category: p.value.s.cat,
        source: `${p.value.s.label} (deep link)`,
        sourceUrl: r.url,
        note: "Curated listing on a community/official site — opens externally",
        tags: ["external guide"],
      });
    }
  }
  return hits.slice(0, 40);
}

// 13 ── YouTube via Piped → Invidious ladder (no keys, no yt-dlp)
const PIPED = ["pipedapi.kavin.rocks", "pipedapi.adminforge.de", "api.piped.private.coffee"];
const INVIDIOUS = ["inv.nadeko.net", "invidious.nerdvpn.de", "yewtu.be", "vid.puffyan.us"];

export async function collectYouTube(ctx: GeoCtx): Promise<RawHit[]> {
  const t0 = Date.now();
  const budgetMs = 100000;
  const query = `${ctx.city} (cafe OR market OR fort OR "street food" OR heritage) walk`;

  type Video = { id: string; title: string; views: number; description?: string; engine: "piped" | "invidious" };
  let videos: Video[] = [];

  for (const inst of PIPED) {
    try {
      const j = await getJson<{ items?: { url?: string; title?: string; views?: number; description?: string }[] }>(
        `https://${inst}/search?q=${encodeURIComponent(query)}&filter=videos`,
        { timeoutMs: 9000, retries: 0 },
      );
      videos = (j.items ?? [])
        .filter((v) => v.url && v.title)
        .slice(0, 8)
        .map((v) => ({
          id: (v.url ?? "").split("v=")[1]?.split("&")[0] ?? "",
          title: v.title ?? "",
          views: v.views ?? 0,
          description: v.description,
          engine: "piped" as const,
        }))
        .filter((v) => v.id);
      if (videos.length) break;
    } catch {
      /* next instance */
    }
  }
  if (!videos.length) {
    for (const inst of INVIDIOUS) {
      try {
        const j = await getJson<{ videoId?: string; title?: string; viewCount?: number; description?: string }[]>(
          `https://${inst}/api/v1/search?q=${encodeURIComponent(query)}&type=video&region=IN`,
          { timeoutMs: 9000, retries: 0 },
        );
        videos = (Array.isArray(j) ? j : [])
          .filter((v) => v.videoId && v.title)
          .slice(0, 8)
          .map((v) => ({ id: v.videoId ?? "", title: v.title ?? "", views: v.viewCount ?? 0, description: v.description, engine: "invidious" as const }));
        if (videos.length) break;
      } catch {
        /* next instance */
      }
    }
  }
  if (!videos.length) return [];

  const hits: RawHit[] = [];
  const addFromText = (text: string, video: Video): void => {
    for (const sentence of mineSentences(text)) {
      for (const name of properNouns(sentence)) {
        if (BLACKLIST.test(name) || name.length < 4) continue;
        hits.push({
          id: hitId("youtube", name, ctx.city),
          name,
          category: sourceCategory(sentence) ?? sourceCategory(video.title),
          source: "YouTube (via open proxies)",
          sourceUrl: `https://www.youtube.com/watch?v=${video.id}`,
          note: `Mentioned in “${video.title.slice(0, 60)}”`,
          mentions: 1,
          upvotes: 0,
          quotes: [{ text: sentence.trim(), permalink: `https://www.youtube.com/watch?v=${video.id}` }],
          popularityScore: Math.min(video.views / 150000, 1),
          popularityNote: video.views > 0 ? `👁 ${Intl.NumberFormat("en", { notation: "compact" }).format(video.views)} video views` : undefined,
          tags: ["video pick"],
        });
        if (hits.length > 300) return;
      }
    }
  };

  for (const v of videos.slice(0, 6)) {
    if (Date.now() - t0 > budgetMs) break;
    if (v.description) addFromText(v.description, v);
    // chapter picks: "12:34 Place name" lines
    for (const line of (v.description ?? "").split("\n")) {
      const m = line.match(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)\s+[-–—]?\s*(.{3,60})$/);
      if (m) {
        const name = m[2].replace(/[|•].*$/, "").trim();
        if (name.length >= 3 && !BLACKLIST.test(name)) {
          hits.push({
            id: hitId("youtube-chapter", name, ctx.city),
            name,
            category: sourceCategory(v.title),
            source: "YouTube (via open proxies)",
            sourceUrl: `https://www.youtube.com/watch?v=${v.id}&t=${m[1].split(":").length === 3 ? m[1] : `0:${m[1]}`}`,
            note: `Chapter pick · “${v.title.slice(0, 60)}”`,
            mentions: 1,
            quotes: [{ text: `Chapter “${name}” in ${v.title}`, permalink: `https://www.youtube.com/watch?v=${v.id}` }],
            popularityScore: Math.min(v.views / 150000, 1),
            popularityNote: v.views > 0 ? `👁 ${Intl.NumberFormat("en", { notation: "compact" }).format(v.views)} video views` : undefined,
            tags: ["video pick", "chapter"],
          });
        }
      }
    }
    try {
      if (v.engine === "invidious") {
        const c = await getJson<{ comments?: { content?: string; likeCount?: number }[] }>(
          `https://${INVIDIOUS[0]}/api/v1/comments/${v.id}`,
          { timeoutMs: 8000, retries: 0 },
        );
        for (const cm of (c.comments ?? []).slice(0, 40)) {
          if (cm.content) addFromText(cm.content, v);
        }
      } else {
        const c = await getJson<{ comments?: { commentText?: string; likeCount?: number }[] }>(
          `https://${PIPED[0]}/streams/${v.id}`,
          { timeoutMs: 8000, retries: 0 },
        );
        for (const cm of (c.comments ?? []).slice(0, 40)) {
          if (cm.commentText) addFromText(cm.commentText, v);
        }
      }
    } catch {
      /* comments optional */
    }
  }

  const topNames = [...hits.reduce((m, h) => m.set(h.name, (m.get(h.name) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([n]) => n);
  const geocoded = await geocodeCandidates(topNames, ctx, 20);
  const byName = new Map(geocoded.map((g) => [g.name.toLowerCase(), g] as const));
  for (const h of hits) {
    const g = byName.get(h.name.toLowerCase());
    if (g) {
      h.lat = g.lat;
      h.lon = g.lon;
    }
  }
  return hits.slice(0, 120);
}
