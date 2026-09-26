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

