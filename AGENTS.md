<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Roam MapLibre & Routing Invariants

1. **MapLibre Marker Positioning (`src/components/map.tsx`)**:
   - Never apply CSS `transform` or `transition: transform` (such as `.map-pin` rotation or `:hover` scale) to the root DOM element passed to `new maplibre.Marker({ element })`, because MapLibre uses inline `transform: translate3d(...)` on that root node to position the marker on the canvas. Always wrap the styled/interactive `<button>` inside an untransformed `<div class="map-marker-root">` container.
2. **OSRM Walk vs. Drive Durations (`src/lib/planner.ts`, `src/app/api/route/route.ts`)**:
   - The public `router.project-osrm.org` endpoint returns car speeds (~40 km/h) in `leg.duration` even on `/route/v1/foot/`. Always calculate `minutes` from `leg.distance / 1000` using mode-specific speeds (`4.8 km/h` for `walk`, `24 km/h` for urban `drive`).
3. **Route Map Pin Isolation (`src/components/map.tsx`, `src/components/plan.tsx`)**:
   - When a trip plan is active, route preview maps must render only the start anchor and numbered itinerary stop markers (`1..N`) by default so unselected city places do not obscure the route.
4. **Keyless Map Provider Invariant (`src/components/map.tsx`)**:
   - Never use tile endpoints that require proprietary API keys or produce watermarks/authentication errors (such as CARTO Voyager). Default to OpenStreetMap Standard (`osm`: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`) and Esri World Imagery (`satellite`).
5. **Selective Stop Locking & Re-plan Invariants (`src/components/plan.tsx`, `src/lib/planner.ts`)**:
   - Only stops explicitly liked (`reactions[id] === 1`) or locked (`s.locked === true`) may be sent in `lockedPlaceIds`.
   - Never default unreacted stops to locked on re-plan when dislikes exist.
   - Newly generated replacement stops from `buildTripPlan` must always be initialized with `locked: false` and neutral reaction state (`reactions[id] = 0`), so they display neutral reaction icons rather than auto-marking as "Keep".
6. **City Switching & Start Anchor Invariant (`src/app/page.tsx`, `src/components/plan.tsx`, `src/lib/planner.ts`)**:
   - Switching cities must invalidate or clear any active itinerary from a different city (`plan.city.toLowerCase() !== nextCity.toLowerCase()`).
   - The `"city"` start anchor must strictly resolve to the currently selected city's geocoded center (`cityCenter.lat`, `cityCenter.lon`, and `${currentCityLabel} Center`), never falling back to a previous city's coordinates.
   - In `buildTripPlan`, when `startAnchor.type === "city"`, always use the target city's geocoded coordinates (`req.lat`, `req.lon`) and label (`${req.cityLabel.split(",")[0]} Center`).
7. **Realistic Price Brackets & Category Defaults (`src/lib/price-engine.ts`, `src/components/cards.tsx`)**:
   - When exact quotes or crawled price hints exist, use them.
   - When raw snippets are missing, fall back to realistic Google Maps/Zomato typical category price brackets (`Free entry` for nature/temples, `₹150–₹350 pp` for food, `₹20–₹50 pp` for culture/monuments, `₹300–₹800 pp` for adventure) instead of leaving places unpriced.
8. **Emotion-Aware Trek & Fatigue Pacing (`src/lib/planner.ts`, `src/components/plan.tsx`)**:
   - Strenuous treks/climbs (`durationMinutes >= 180` or matching `/trek|hike|climb|fort|summit|ghat|waterfall|peak/i`) must inject an automatic 45-minute biological recovery & chai buffer.
   - When heavy afternoon stops remain after a climb, the engine must offer a 1-click action to move remaining stops to Day 2 to preserve human stamina.
9. **First-Class Meal Anchors (`src/lib/planner.ts`, `src/components/plan.tsx`)**:
   - Breakfast (~8:30–9:30 AM), Lunch (~12:30–2:30 PM), and Dinner (~7:30–9:30 PM) toggles slot authentic local eateries en-route into the daily schedule.
10. **Adaptive Planner Workspace (`src/components/ui.tsx`, `src/components/plan.tsx`)**:
   - Day planner modal must support toggling between a compact side drawer and a maximized 2-column cockpit (Interactive Route Map + stats on left, scrollable itinerary timeline on right).


