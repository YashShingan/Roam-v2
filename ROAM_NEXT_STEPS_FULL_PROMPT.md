# ROAM — FULL CONTEXT + NEXT TWO STEPS (Turso DB → Render Backend)

> **AI AGENT: Read this ENTIRE file before writing any code.** It contains all project
> context (nothing else was given to you), hard rules, and the two tasks to complete,
> in order. Complete STEP 1 (Turso) fully and verify before starting STEP 2 (Render).
> If anything is ambiguous, inspect the repo first and report findings — do not guess.

---

## PART A — PROJECT CONTEXT (everything you need to know)

### What the app is
**Roam** — a travel discovery web app for India. Users search any Indian city and see
real local places (cafes, bazaars, forts, temples, heritage walks) with community signal
(Reddit mentions, quotes, upvotes), prices, hours, photos, and Google-Maps links.
Flagship feature: a **voice trip planner** ("Plan a one-day food trip in Kalyan under ₹500")
that builds an itinerary and narrates it aloud.

### Architecture already built
1. **Frontend:** Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind 4 +
   shadcn/ui + Framer Motion + MapLibre GL 3D map (OpenFreeMap tiles) + Zustand +
   TanStack Query. Design system: "Drift Claymorphism" (oatmeal #F5F2EB, terracotta
   #D96B43, sage #7A9A7B). Includes: hero, filter bar, card grid, detail dialog,
   day-plan sheet, compare sheet, community pulse charts, voice orb (Web Speech API),
   keyboard shortcuts, dark mode.
2. **Backend (Python):** FastAPI + a proven multi-source collector pipeline ("v10"):
   Overpass (4 mirrors), Wikidata SPARQL, Wikipedia (en/mr/hi geosearch), Wikivoyage,
   Reddit RSS → PullPush fallback, Google News RSS, Wikimedia Commons, Google My Maps
   KML, Books (Gutenberg/Archive.org/Wikisource/Google Books), GeoNames, SERP text
   mining (DDG→Bing→Mojeek rotation), Openverse/Commons photos, price parser with
   evidence quotes, transit/road filter, fuzzy dedup, address backfill. Runs locally
   with `uvicorn main:app` from `backend/` (repo reality — NOT `app.main:app`).
3. **Data model (key tables):** places (name, category, lat/lon, address, price fields,
   sources JSON, photo, popularity), trips + itinerary stops, price_history,
   place_addresses, place_photos, search_candidates.
   (Repo reality: shared schema is places, trips, kv, place_prices, search_candidates,
   place_photos — see `db/schema.sql`.)

### Current deployment state (IMPORTANT)
- ✅ Frontend is **already deployed to Vercel — MANUALLY** (via dashboard/CLI upload).
  **NOT yet connected to GitHub auto-deploy.**
- The live URL is **permanent — the user already submitted it.** Every change must keep
  that exact URL working.
- ❌ No database in the cloud yet. Any local SQLite file does NOT persist on Vercel.
- ❌ Python backend is NOT hosted anywhere yet.
- App currently shows **seed/curated data** (it must — there's no backend).

### HARD RULES (never violate)
1. **The Vercel URL never changes.** After every step, the site must still load there.
2. **Zero-env-var rule:** the app must always build and run in seed mode with NO env
   vars. Unset vars = valid config with fallbacks — never a crash, never a blank page.
3. **Zero paid services, forever.** No required API keys. Open-source stack only.
4. **Never run heavy scraping inside Vercel serverless functions** (60 s Hobby limit).
5. **Never commit secrets.** Tokens go in Vercel/Render dashboards + GitHub Secrets only.
   `.env*` must be in `.gitignore`.
6. **Inspect before coding.** This file describes the project from memory of its build;
   the repo may differ in small details (file names, whether Prisma is used, etc.).
   Run the STEP-0 inspection for each part and report findings before changing code.
7. **Rollback safety:** every change must be reversible by removing env vars alone —
   the seed-mode fallback is the escape hatch.
8. **Update progress:** at the end, edit the checklist in PART D of this file and commit.

### Prerequisite the USER must do once (tell them, verify before deploying changes)
The repo must be on GitHub and linked to the Vercel project so env-var changes trigger
redeploys:
1. `git init && git add -A && git commit -m "pre-turso"` → push to a new GitHub repo
   (same code that was manually uploaded).
2. Vercel → Project → Settings → Git → **Connect** that repo → branch `main`.
3. Verify: pushing a trivial commit triggers an auto-deploy and the URL still works.
Do this BEFORE Step 1 changes deploy.

---

## PART B — STEP 1: TURSO DATABASE (do this first, fully)

Turso = hosted libSQL = SQLite-compatible over HTTP. Free tier (~9 GB) — matches our
SQLite-based code with near-zero migration.

### 1.0 — Inspect first (report findings, then code)  ✅ DONE — see PART F
1. Prisma or raw SQL or none? → **No Prisma anywhere → Path B.**
2. Where does the frontend load places? → **`src/lib/places-service.ts` → `src/lib/db.ts`
   (node:sqlite over `data/roam.db`). NOT seed-only: the frontend has its own TS
   collector pipeline + render-first background scraping.**
3. Is there a local SQLite file / CSV harvest worth migrating into Turso? → **YES:
   `data/roam.db` — 745 places across 5 cities (mumbai 319, kalyan-dombivli 176,
   dadar 133, pune 96, thane 21), 2 trips, kv, place_prices, search_candidates,
   place_photos — 838 rows total.** ⚠️ `data/` is in `.gitignore`, so a git-based
   deploy would DROP all of it — this migration is load-bearing.
4. Current `build` script: **`"build": "next build"`** (no prisma generate anywhere).
5. `src/lib/db.ts` exists → **rewritten as the single dual-driver data layer.**

### 1.1 — Instruct the USER to provision Turso (user runs locally)  ← YOUR ACTION
```bash
# Install Turso CLI: https://docs.turso.com/download
turso auth signup
turso db create roam
turso db show roam --url          # → LIBSQL_URL      (libsql://roam-xxx.turso.io)
turso db tokens create roam       # → LIBSQL_AUTH_TOKEN
```
User pastes both values into Vercel → Settings → Environment Variables
(Production + Preview) as `LIBSQL_URL` and `LIBSQL_AUTH_TOKEN`.
Then seed: `LIBSQL_URL=… LIBSQL_AUTH_TOKEN=… node scripts/seed.mjs` (or `npm run seed`).

### 1.2 — Code changes  ✅ DONE (Path B)
- `npm i @libsql/client` ✅
- `src/lib/db.ts` rewritten as **one dual-driver data module** (better than a
  seed-only helper because this repo already has a working local store):
  - `LIBSQL_URL` set → @libsql/client: reads go Turso-first, **fall back to local
    SQLite on error/empty — never throw to the UI**; writes go to local always +
    Turso best-effort (rollback safety by removing the env vars).
  - No `LIBSQL_URL` → byte-for-byte the old local-SQLite behavior.
  - Schema auto-ensured remotely on first connect (idempotent DDL, same as
    `db/schema.sql`).
- All read/write paths go through this one module (they already did; the async API
  is propagated at every call site).
- `db/schema.sql` created: places, trips, kv, place_prices, search_candidates,
  place_photos (+ indexes).

### 1.3 — Migrate + seed  ✅ CODE DONE — run when Turso exists
1. `scripts/seed.mjs`: idempotent migration of ALL local rows into Turso, upsert by
   primary key, per-table before/after counts, prints cities breakdown. `npm run seed`
   wraps it; `--check` prints remote counts only.
2. Schema: applied automatically by the app/seed (or manually:
   `turso db shell roam < db/schema.sql`).
3. Local verification of the EXACT driver path (no Turso account needed):
   `LIBSQL_URL=file:./data/turso-e2e.db node scripts/seed.mjs` →
   **838 rows migrated; marker-row proof served via the API.**
4. Expected report after real Turso seed: places 745 · total 838 rows.

### 1.4 — Deploy + verify  ← YOUR ACTION after 1.1
- Add the two env vars in Vercel → redeploy happens automatically (Git connected).
- **Verify the SAME production URL** serves DB rows: the seed ships only real
  collected rows — pick any place shown and confirm with
  `turso db shell roam "SELECT name FROM places WHERE name='…';"`.
  (Marker-row trick validated locally: insert `__turso_check__` → served by API → delete.)
- ✅ Local build test PASSED both ways: zero env vars (fallback) AND env vars set
  (Turso/libsql driver path, proven end-to-end with a local libsql file DB).

### 1.5 — STEP 1 acceptance (report each)
- [x] 1.0 findings summary delivered before coding (PART F)
- [x] Schema applied; seed count > 0 — **838 rows / 745 places verified on the real
      driver path (local libsql file DB); run `npm run seed` against Turso to repeat**
- [ ] **USER: provision Turso + set Vercel env vars + seed + redeploy** (1.1/1.4)
- [x] Build passes with zero env vars AND with env vars (local proof)
- [ ] **USER: confirm same Vercel URL live with DB-backed rows** (proof procedure in 1.4)
- [x] No secrets in git; `.env*` gitignored (verified — only next-env.d.ts exists)
- [x] PART D checklist updated

---

## PART C — STEP 2: RENDER BACKEND + LIVE MODE (after Step 1 passes)

Deploy the Python FastAPI backend to Render free tier for on-demand scraping/verify,
writing to the SAME Turso DB so the frontend sees results.

### 2.0 — Inspect first (report findings, then code)  ✅ DONE — see PART F
1. Backend entry: **`backend/main.py`** (`uvicorn main:app` from `backend/`).
2. Routers: places, geocode, weather, trips, assistant, health (sources), stats,
   route, collect, prices, serp, images, lens. **No root `/health` existed** → added.
3. Persistence: **`backend/db.py` (aiosqlite → `data/roam.db`, shared with the TS
   app) via ~20 helper functions** → Turso branch added inside `get_db()`.
4. `backend/requirements.txt` used `>=` → **now version-pinned `==`**.
5. Endpoints that can run > 50 s: **POST /api/collect, POST /api/v1/lens/run** →
   both converted to the 202 job pattern (`wait: true` preserves legacy sync).

### 2.1 — Backend hardening (code changes)  ✅ DONE
1. **`GET /health`** → `{"ok": true, "version": "1.0.0", "data_mode": "local|turso"}`
   — no DB dependency (Render Health Check Path).
2. **CORS from env:** `ALLOWED_ORIGINS` comma-separated; unset → `["*"]` (zero-env rule).
3. **Turso writes:** new `backend/turso.py` — Turso HTTP v2 (Hrana) over httpx, no
   native deps; drop-in for the aiosqlite surface db.py uses; schema auto-ensured;
   `upsert_places` batched to one HTTP round-trip. **No data lives only on Render's
   disk when LIBSQL_URL is set.**
4. **Long-job pattern:** `backend/routes/jobs.py` — POST /api/collect and
   POST /api/v1/lens/run return `202 {"job_id", "poll"}` and run as FastAPI
   background tasks; **GET /api/v1/jobs/{id}** reports running/done/error + result.
   `wait: true` body flag keeps the old synchronous contract for local harvests.
5. **Timeout budgets kept:** untouched (all collector budgets preserved).
6. **requirements.txt:** pinned to the versions verified working.

### 2.2 — Instruct the USER to create the Render service  ← YOUR ACTION
1. Render → New → **Web Service** → connect the GitHub repo.
2. Settings: Root Directory `backend` · Build `pip install -r requirements.txt` ·
   Start `uvicorn main:app --host 0.0.0.0 --port $PORT` (repo reality: NOT app.main)
   · Health Check Path **`/health`** · Instance Type **Free**.
3. Env vars (Render dashboard):
```
LIBSQL_URL=<same as Vercel>
LIBSQL_AUTH_TOKEN=<same as Vercel>
ALLOWED_ORIGINS=https://<exact-vercel-url>
ENABLE_GOOGLE_BROWSER_LENS=0
```
4. Deploy → note URL: `https://<backend>.onrender.com`
5. Optional (not required): free UptimeRobot monitor pinging `/health` every 10 min
   to prevent cold starts. Never point it at scrape endpoints.

### 2.3 — Frontend live mode (code changes)  ✅ DONE
1. API base = `process.env.NEXT_PUBLIC_API_URL ?? ""` (in `src/lib/live-backend.ts`).
   When empty → **ALL live-mode UI hidden (today's behavior preserved exactly)**.
2. When set: "Live backend" panel inside the Source-health drawer (H key) with a
   **"Run live scrape"** button → 202 job → polls `/api/v1/jobs/{id}` every 5 s →
   toast on done/error → refetches places. Every call: 1 retry on network error,
   never crashes the page.
3. Cold start: `/health` probe with 90 s first-ping budget then 15 s, cached 5 min;
   shows "Waking up the local data engine…" and disables the button while down.
4. Live-scraped rows land in Turso (same DB the frontend reads) and appear on
   normal loads — no special merge path needed.

### 2.4 — Deploy + verify  ← YOUR ACTION
- Vercel env var: `NEXT_PUBLIC_API_URL=https://<backend>.onrender.com` → redeploy.
- Verify: same URL works; live controls visible in the health drawer; ONE real
  collector run from the UI writes rows to Turso (prove with COUNT(*) before/after
  via `turso db shell roam "SELECT COUNT(*) FROM places;"`).
- Rollback proof: remove `NEXT_PUBLIC_API_URL` → redeploy → pure current mode again
  (and removing `LIBSQL_URL` restores the local-SQLite fallback by design).

### 2.5 — STEP 2 acceptance (report each)
- [x] 2.0 findings summary delivered before coding (PART F)
- [x] `/health` returns 200 locally (`{"ok":true,"version":"1.0.0","data_mode":"local"}`);
      **USER: confirm 200 on Render**
- [x] CORS from `ALLOWED_ORIGINS` (verified logic + middleware mount)
- [ ] **USER: UI-triggered scrape writes to Turso (before/after counts)** (2.4)
- [ ] **USER: same production URL works; cold start shows friendly state** (2.4)
- [x] Rollback verified at code level: unset env vars → seed/local mode (build +
      runtime proof done with and without env vars)
- [x] No secrets committed; PART D checklist updated

---

## PART D — PROGRESS CHECKLIST (AI updates this file after each step)

- [x] Frontend built and manually deployed to Vercel (URL permanent, submitted)
- [x] Python backend + v10 collectors built (local)
- [x] **STEP 1: Turso code path complete + locally verified — awaiting USER: provision
      Turso → set Vercel env vars → `npm run seed` → redeploy proof**  ← current
- [x] STEP 2: Render backend hardening + live mode code complete — awaiting USER:
      create Render service → set `NEXT_PUBLIC_API_URL` → verify
- [ ] (future, not in this task) GitHub Actions nightly harvest → Turso

**Production URL:** `https://<your-project>.vercel.app`   ← user: fill exact URL
**Last updated:** 2026-09-10 · Current phase: STEP 1 (Turso) — code done, user deploy pending

---

## PART E — TROUBLESHOOTING QUICK REFERENCE

- Build fails on Prisma → ensure `prisma generate` in build script (Step 1) or temporarily
  defer Prisma entirely. (Repo reality: no Prisma — not applicable.)
- Blank page on Vercel but fine locally → an env var is referenced without a fallback;
  restore the zero-env-var rule.
- CORS error in browser console → `ALLOWED_ORIGINS` must exactly match the Vercel URL,
  `https://` prefix, no trailing slash.
- Render returns 502 right after deploy → check start command + `$PORT` binding.
- First Render request hangs >60 s → cold start; the UI must show the waking-up state.
- `turso db shell` auth error → token missing/expired; recreate with `turso db tokens create roam`.
- Turso row count not changing after a scrape → backend is still writing to a local file;
  check `GET /health` shows `"data_mode":"turso"` (it flips only when LIBSQL_URL is set).

---

## PART F — EXECUTION FINDINGS (filled by the AI agent, 2026-09-10)

Repo realities that differ from the memory in PART A/B/C (all handled in code):
1. **No Prisma** → Path B. The frontend already had a real data layer
   (`src/lib/db.ts`, node:sqlite) feeding a render-first UI — so STEP 1 was
   implemented as a **dual-driver module** (Turso-first reads with local fallback,
   dual writes) instead of a seed-only helper. The zero-env fallback is the
   previous behavior exactly, satisfying rules 1/2/7.
2. **The frontend is not seed-only** — it runs its own uncapped TS collector
   pipeline with background scraping and serves from SQLite. `data/roam.db` holds
   **745 real collected places (5 cities) + trips/kv/prices/photos = 838 rows**.
3. **`.gitignore` ignores `data/`** — the GitHub-connected redeploy would silently
   drop all collected data. Seeding Turso (1.3) is what keeps the site populated;
   do it BEFORE deleting the manual deployment.
4. **Backend entry is `backend/main.py`** → Render start command
   `uvicorn main:app --host 0.0.0.0 --port $PORT` (Root Directory `backend`).
5. Backend + frontend **share one SQLite file**; with Turso both write to the same
   cloud DB via their respective drivers (`@libsql/client` and Turso HTTP v2 over
   httpx — no native extensions needed on Render).
6. Verification performed locally (no Turso/Render accounts needed):
   - `npm run build` passes with zero env vars AND with `LIBSQL_URL=file:…`
   - Seed script: 838 rows migrated, per-table counts + cities breakdown
   - Marker-row proof: a row existing only in the libsql DB was served by
     `/api/places` through the remote driver, then deleted
   - Zero-env runtime: identical local behavior, no marker leak
   - Backend: `py_compile` clean, boots, `/health` 200, `/api/v1/jobs/{id}` 404,
     adapter arg/result encoding round-trip unit-tested for all scalar types

### USER ACTION LIST (in order)
1. Push repo to GitHub; connect it in Vercel (Settings → Git, branch `main`).
   Confirm a trivial push redeploys and the permanent URL still works.
2. `turso db create roam` → put `LIBSQL_URL` + `LIBSQL_AUTH_TOKEN` in Vercel
   (Production + Preview).
3. Seed: `LIBSQL_URL=… LIBSQL_AUTH_TOKEN=… node scripts/seed.mjs` → expect
   "745 places / 838 rows"; spot-check `turso db shell roam "SELECT COUNT(*) FROM places;"`.
4. Confirm the permanent URL now serves DB-backed rows (procedure in 1.4).
5. Create the Render service (settings in 2.2 — note `uvicorn main:app`!) with the
   same `LIBSQL_URL`/`LIBSQL_AUTH_TOKEN` + `ALLOWED_ORIGINS=https://<vercel-url>`
   + `ENABLE_GOOGLE_BROWSER_LENS=0`; Health check path `/health`.
6. Add `NEXT_PUBLIC_API_URL=https://<backend>.onrender.com` in Vercel → redeploy →
   open the app → press `H` → "Live backend" panel → "Run live scrape" → watch
   `SELECT COUNT(*) FROM places` grow.
7. Fill in the production URL in PART D. Rollback at any time = remove env vars.
