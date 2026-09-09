# UPGRADE PROMPT — "ROAM" Price Intelligence + Search-Lens Web/Image Mining + Planner Fix
## For: existing Next.js frontend + Python (FastAPI) backend running the v10 collector pipeline

> You are a senior Python backend + Next.js engineer. Our app already works: the Next.js
> frontend renders places from a Python backend that runs our proven v10 multi-source
> collector (OSM/Overpass, Wikidata, Wikipedia, Reddit, News, Books, YouTube proxies, etc.).
> Three problems to solve in this task — read fully before coding:
>
> 1. **PLANNER PRICES ARE WRONG.** The trip planner shows improper prices (fake-looking
>    ₹ numbers, ₹0, per-item shown as per-person, no ranges, no "unknown" state).
> 2. **WE ARE MISSING PLACES.** OSM/Wikidata don't cover many local spots. Fix: mine the
>    open web the way a human does — when a user searches a place in a browser, the search
>    results page's TEXT (titles/snippets/links) reveals dozens of place names. We will
>    scrape and mine those search-result pages programmatically.
> 3. **NO REAL PHOTOS + IMAGE-ONLY PLACES.** Image search results (filenames, alt text,
>    titles) both reveal missing places ("krishna-cafe-kalyan.jpg") and give us real,
>    openly-licensed photos for our cards (instead of placeholders).
>
> Rules: 100% free/open tools only. No Google paid APIs, no Mapbox, no OpenAI. Respect
> robots.txt and ToS (ToS-restricted sites stay deep-link-only). Never fabricate data —
> if there is no price signal, the UI says so. Everything cached, rate-limited, and
> failure-isolated (one source down never breaks a response).

---

## TASK 1 — PRICE INTELLIGENCE ENGINE (fix improper prices) — PRIORITY

### 1.1 Why it's broken today
- Price hints were single regex grabs with no context → treating "₹20 chai" as the venue's
  per-person meal price, mixing entry fees with meals, trusting one mention, showing ₹0.

### 1.2 Build `app/services/price_engine.py` (Python backend)

**Parser spec:**
- Currency patterns (both orders): `₹500`, `Rs. 500`, `Rs 500/-`, `INR 500`, `500 rupees`,
  `500/-`. Also words: `free`, `no entry fee`, `free entry`.
- Context classifier per match (search ±120 chars around the match):
  - `entry` — "entry fee", "ticket", "entrance", "adult/child ticket"
  - `meal`  — "per person", "per head", "pp", "for two", "thali", "meal", "dinner for"
  - `item`  — "chai", "coffee", "plate", "vada", "samosa", "snack", "per cup", "per plate"
  - `range` — "₹200–300", "₹200-300", "₹200 to 300" → store min & max
- Number hygiene: strip commas; `2k → 2000`; REJECT matches that are years (1900–2099
  adjacent to no ₹), distances ("5 km"), ratings (4.5), timings ("10 to 5"), phone
  fragments, lakh/crore amounts (usually article noise → confidence 0).
- Plausibility gates by category (drop outliers):
  item 5–300 · meal 40–2000 · entry 0–500 · adventure 300–8000.
- Multiplier handling: "for two" → per-person = value/2 (store both).

**Aggregation → `PriceHint`:**
```
priceHint = {
  mode: "meal"|"entry"|"item"|"mixed",
  min: number, max: number,          # e.g. 120–260
  per_person: number|null,           # median of normalized samples
  samples: [ {value, unit, context, source, url, date} ],
  confidence: 0..1,                  # f(sample_count, source_diversity, context_match)
}
```
- ≥3 samples & ≥2 distinct sources → confidence high; 1 sample → low (shown, but labeled).
- 0 valid samples → `priceHint = null` → UI MUST show "Varies — no reliable signal yet".
  NEVER show ₹0. NEVER invent a number.

### 1.3 Price sources to mine (all already keyless in our stack)
1. Reddit threads + comments (PullPush text) — biggest source of ₹ mentions.
2. Fetched blog article text (trafilatura) from our existing blog collector.
3. Google News RSS titles/snippets.
4. **Wikivoyage vcard listings** — they often contain explicit price text ("Entry free",
   "Meals ₹150–250") — parse the listing body we already fetch.
5. Search-result snippets from the new Search Lens (Task 2) — run the parser on every
   snippet we already collect.
6. YouTube descriptions/chapters text we already mine.

### 1.4 DB schema (SQLite via existing stack)
```sql
CREATE TABLE place_prices (
  id INTEGER PRIMARY KEY, place_id INTEGER NOT NULL,
  value REAL, value_max REAL, unit TEXT, context TEXT, currency TEXT DEFAULT 'INR',
  source TEXT, url TEXT, confidence REAL, captured_at TEXT
);
ALTER TABLE places ADD COLUMN price_mode TEXT;
ALTER TABLE places ADD COLUMN price_min REAL;
ALTER TABLE places ADD COLUMN price_max REAL;
ALTER TABLE places ADD COLUMN price_confidence REAL;
ALTER TABLE places ADD COLUMN price_sample_count INTEGER DEFAULT 0;
```

### 1.5 API
- `POST /api/v1/prices/scan` body `{city}` or `{place_ids:[]}` → runs parser over stored
  texts + fresh Search-Lens snippets, writes samples, recomputes hints. Returns summary.
- `GET /api/v1/places/{id}` now returns `priceHint` full object.
- Frontend `/api/places` proxies the new fields unchanged.

### 1.6 Frontend changes (Next.js)
- **Price chip v2:** `₹120–260 · meal · 6 mentions` with a confidence dot
  (green ≥0.7 / amber 0.3–0.7 / gray <0.3 or unknown).
- Tooltip lists up to 3 sample quotes with source links (transparency).
- Explicit **"Varies — no reliable price signal"** gray state (never ₹0, never blank).
- Formatter: `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR',
  maximumFractionDigits:0})`; round to nearest ₹10.

### 1.7 Planner integration (fixes the actual complaint)
- Each itinerary stop shows its price **basis**: `entry ₹50` / `meal ~₹180 pp` / `Varies`.
- Day total = SUM of per-person priceHints (entry + meal). If some stops unpriced:
  show `≈ ₹850–1,300 · 3 of 7 stops priced` band + note "excludes 4 unpriced stops".
- Budget slider (₹0–2500/day) now filters against `price_min`, and the feasibility banner
  uses the band: "Fits budget ₹1000 with min-sum ₹850" / "Over by ~₹300 (max-sum)".
- Reorder/re-plan MUST recompute totals (no stale numbers). Unit tests for the math.
- Currency always INR-formatted; no NaN, no ₹0 for unknown, no Infinity.

**Acceptance (Task 1):** fixture set of 25 real-world snippets → parser ≥90% correct
value+context; Kalyan run: every place has either a labeled hint or honest "Varies";
planner totals correct under reorder; zero ₹0/NaN in UI.

---

## TASK 2 — SEARCH LENS: SERP TEXT MINING (find missing places) — Python backend

### 2.1 Module `app/services/search_lens.py`
Mine the *text* of public search-engine result pages — titles, snippets, URLs — exactly
what a human sees in the browser, used for two things: **new place candidates** and
**price/context snippets** (feed into Task 1 parser).

**Engines (rotate + global pacing lock, 1 call/1.2 s max per engine):**
- DuckDuckGo HTML (`html.duckduckgo.com/html/?q=`) → parse `a.result__a` (+ `uddg=` unwrap)
- DuckDuckGo Lite fallback
- Bing (`www.bing.com/search?q=`) → parse `li.b_algo h2 a`
- Mojeek (`www.mojeek.com/search?q=`)
- SearXNG public JSON instance if reachable (nice structured results)
- ❌ NO Google scraping (blocked/brittle). NO headless browsers (Selenium/Playwright) — keep it plain `requests` + BeautifulSoup for reliability and speed.

**Query templates per city (run 6–10 queries):**
- `{city} best cafe`, `{city} "hidden gem" food`, `{city} market shopping guide`,
  `{city} fort heritage timings`, `{city} famous temple`,
  `{city} street food price` (price pass), plus **Hindi/Marathi variants**
  (`{city} प्रसिद्ध मंदिर`, `{city} मार्केट`) — huge coverage win for India.
- Per-place price pass: `"{place name}" entry fee OR price OR timing` for top N places.

**Extraction per result:** title, url, snippet.
- Venue-name mining: existing `VENUE_RE` regex + spaCy `en_core_web_sm` ORG/FAC/LOC on
  title+snippet (spaCy is already in our v10 backend — reuse it) + "Known-domain boost"
  (result is from tripadvisor/so.city/lokalapp/lbb/mumbai.org etc. → higher trust).
- Skip URLs from our ToS-restricted list except as *evidence* (we may cite the link, never
  scrape those pages' content beyond the snippet the engine already shows us).

### 2.2 Candidate → place pipeline (the Gap-Filler, shared with Task 3)
```
candidate name → normalize key → dedupe vs DB (thefuzz ≥85 or coords ≤120 m)
  → Nominatim geocode "{name}, {city}" (budget: 30 geocodes/run, 1.1 s apart)
  → radius check (≤ radius_km × 1.5 of center)
  → category inference from keywords (cafe/market/fort/temple/park…)
  → INSERT place (source="Search Lens", evidence_url=serp_url, confidence=geocode_ok)
  → log to search_candidates table
```
```sql
CREATE TABLE search_candidates (
  id INTEGER PRIMARY KEY, name TEXT, city TEXT, engine TEXT, query TEXT,
  evidence_url TEXT, status TEXT,       -- added | merged | no_geo | out_of_radius | dup
  reason TEXT, created_at TEXT
);
```

### 2.3 API + ops
- `POST /api/v1/serp/mine {city, lat, lon, radius_km}` → `{candidates, added, merged, skipped, engines_used}`
- Caching: per `(engine, query)` 6 h disk cache. Circuit breaker per engine (3 fails → skip 30 min).
- Politeness caps: ≤12 SERP fetches per run; browser-like UA; `robots.txt` respected;
  every failure logged, never raised to caller.

**Acceptance (Task 2):** Kalyan run yields ≥10 candidates, ≥3 become pinned places that
were NOT in OSM-only results; immediate re-run adds 0 duplicates; health drawer shows
per-engine status; run completes <90 s.

---

## TASK 3 — PHOTO LENS: IMAGE MINING + REAL CARD PHOTOS

### 3.1 Two goals
A) **Real photos for cards** (replace picsum placeholders) — openly licensed only.
B) **Image-only place discovery** — alt text / filenames / titles often name places that
   have zero text presence ("durgadi-fort-kalyan.jpg", "joshi-chai-kalyan.jpg").

### 3.2 Sources (all keyless, license-safe)
1. **Openverse API** (`api.openverse.org/v1/images/`) — CC-licensed, returns license +
   creator + foreign_landing_url. PRIMARY for card photos. Query: place name + city.
2. **Wikimedia Commons** — we already geosearch it; ALSO text-search
   `File: {place name} {city}` for per-place photo attach.
3. **Bing Images HTML** (`www.bing.com/images/search?q=`) — parse the `m` attribute JSON
   (`murl` = full image URL, `t` = title) for *discovery mining* + fallback photo. Mark
   license `unknown` → usable as DISCOVERY evidence; only attach to cards if we can pair
   it with an Openverse/Commons licensed twin, else show as small "web reference" thumb
   linking to source page.
4. **DDG Images** — skip (vqd token flow too brittle).

### 3.3 Processing
- Mine names from image title/alt/filename (`[-_.]` → space, strip size tokens like
  `1200x800`, strip extension) → feed the SAME Gap-Filler pipeline as Task 2.
- Card photos: match Openverse/Commons result to place by name similarity ≥85 + same city;
  store `place_photos` row with **mandatory attribution** (creator, license, source URL).
- Serve thumbnails via our own `/api/v1/img?u=<cached-url>` proxy (cache 7 d, size-capped,
  timeout 5 s, fallback → picsum seed) to avoid hotlink breakage & mixed-content issues.

```sql
CREATE TABLE place_photos (
  id INTEGER PRIMARY KEY, place_id INTEGER, url TEXT, thumb_url TEXT,
  license TEXT, attribution TEXT, source_page TEXT, source TEXT,  -- openverse|commons|bing
  captured_at TEXT
);
ALTER TABLE places ADD COLUMN photo_url TEXT;
ALTER TABLE places ADD COLUMN photo_attribution TEXT;
```

### 3.4 API
- `POST /api/v1/images/mine {city}` → `{photos_attached, discovery_candidates, added}`
- `GET /api/v1/img?u=` proxy as above.

### 3.5 Frontend
- Card `<img>`: real photo with `loading="lazy"`, shimmer, graceful fallback to picsum.
- Attribution micro-line inside detail dialog photo footer: "📷 Creator — CC BY 2.0 — source".
- New optional filters: **"Has photo"**, **"Price confirmed"**.
- Card mini-badge **"🌐 Found via web search"** when `source` includes Search/Photo Lens.

**Acceptance (Task 3):** ≥60% of top-25 Kalyan places have a real photo with visible
attribution; ≥2 places discovered purely from image filenames/alt now exist with pins;
no broken images (proxy fallback verified); every card photo has license text.

---

## TASK 4 — ORCHESTRATION & HEALTH

- New `app/services/lens_orchestrator.py`: `POST /api/v1/lens/run {city}` runs
  Search Lens → Photo Lens → Gap-Filler → Price re-scan, in that order, then returns a
  single report `{added, merged, photos, price_updates, by_engine}`.
- Nightly harvester (existing cron) now includes one Lens pass per tracked city.
- `/api/health/sources` extended: `serp_engines`, `images`, `price_parser`,
  `geocode_budget_left` — surface in the frontend admin drawer (`H`).
- All new services: pydantic schemas, tenacity retries, structured logging, per-service
  circuit breakers, 100% try/except isolation (Task-N failures never touch core places API).

---

## TASK 5 — PLANNER PRICE POLISH (final mile)

- Stop rows: price basis chip + "why" tooltip (top quote).
- Trip totals: min–max band, per-day split, INR format, excl-unpriced note.
- Budget slider interplay + feasibility banner copy per §1.7.
- "Read my plan aloud" summary now includes the total band in natural language
  ("About eight hundred to a thousand rupees per person for the day").
- Edge cases: single unpriced stop, all unpriced, huge outlier dropped, mixed entry+meal.

---

## BUILD PHASES & DEFINITION OF DONE

- **P1 Price Engine** (parser+schema+scan+UI chip+planner math) → acceptance §1.7.
- **P2 Search Lens** (SERP text mining + gap-fill) → acceptance §2.3.
- **P3 Photo Lens** (Openverse/Commons/Bing + proxy + attribution UI) → acceptance §3.5.
- **P4 Orchestrator + health + nightly cron.**
- **P5 Planner polish + edge cases + i18n strings (en/hi/mr).**

**DoD:** `pytest` suite green (parser fixtures, dedupe, totals math); manual run on Kalyan +
Pune: ≥25 places each, ≥60% with photos, planner shows honest price bands with zero ₹0/NaN;
killing any one engine/source in devtools never breaks the app; all new endpoints cached,
rate-limited, logged; attribution visible everywhere a photo shows; README updated with the
new data-flow diagram and legal notes (robots, ToS-deep-link-only list, CC attribution).
