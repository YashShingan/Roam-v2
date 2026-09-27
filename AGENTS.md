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
7. **Honest Pricing Signals Over Fabricated Category Fallbacks (`src/lib/price-engine.ts`, `src/components/cards.tsx`)**:
   - Never fabricate synthetic category price brackets (e.g. `₹20–₹50 pp`) when places lack verified price hints.
   - Places of worship (temples, mosques, churches), parks, and spots without verified tickets must display **`Varies on site`** (or `Free entry` when explicitly free or crawled as 0).
   - Only places with verified crawled quotes, ticket prices, or menu ranges should display specific price numbers or be tallied into the trip budget total.
8. **Emotion-Aware Trek & Fatigue Pacing (`src/lib/planner.ts`, `src/components/plan.tsx`)**:
   - Strenuous treks/climbs (`durationMinutes >= 180` or matching `/trek|hike|climb|fort|summit|ghat|waterfall|peak/i`) must inject an automatic 45-minute biological recovery & chai buffer.
   - When heavy afternoon stops remain after a climb, the engine must offer a 1-click action to move remaining stops to Day 2 to preserve human stamina.
9. **End-to-End Meal Anchor Pipeline & Multi-Day Slotting (`src/lib/planner.ts`, `src/app/page.tsx`, `src/app/api/trip/plan/route.ts`)**:
   - Meal anchor options (`includeBreakfast`, `includeLunch`, `includeDinner`) must be forwarded from the client request through the API Zod validation schema to `buildTripPlan`.
   - In multi-day trips, meal anchors must be distributed to each active day (breakfast ~8:30–9:30 AM, lunch ~12:30–2:00 PM, dinner ~7:30–9:00 PM) rather than clustered by angle into a single day, ensuring sights are not scheduled during lunch.
10. **Adaptive Planner Workspace (`src/components/ui.tsx`, `src/components/plan.tsx`)**:
   - Day planner modal must support toggling between a compact side drawer and a maximized 2-column cockpit (Interactive Route Map + stats on left, scrollable itinerary timeline on right).
11. **Voice Assistant & Speech Recognition Architecture Guardrails (`src/components/voice.tsx`, `src/app/api/assistant/route.ts`)**:
   - Never undertake intrusive architectural rewrites on working media hardware loops (`webkitSpeechRecognition`, `MediaRecorder`, Web Audio VAD). Chromium mic locking, lifecycle pauses, and tab permissions are sensitive to abstraction churn.
   - Keep conversational NLU prompts natural and multi-turn capable; do not constrain incoming conversational queries into rigid zero-shot schemas that fail server-side validation.
12. **Itinerary Start Times, Anchor Coordinates & Per-Day Stop Limits (`src/lib/planner.ts`, `src/app/api/assistant/route.ts`)**:
   - Start anchors without pre-resolved coordinates (e.g. from LLM tool calling or voice landmark mentions) must never inject Null Island `(0,0)`. They must be resolved against city places or safely fall back to the city center coordinates.
   - Initial route leg travel times are capped so scheduled stop slots always start strictly within morning waking hours (`08:30–09:30 AM`), never wrapping into night hours.
   - Generated itineraries must never assign more than 7 stops per day (including meal anchors) unless explicitly hand-picked by the user.
13. **Wake Word Re-arming Lifecycle & Itinerary Context Injection (`src/components/voice.tsx`, `src/app/api/assistant/route.ts`)**:
   - Hands-free wake word spotters must automatically re-arm whenever an interaction turn concludes (in `audio.onended`, browser speech `u.onend`, or turn timeout). Never leave the wake recognition instance stopped after playback.
   - All assistant NLU queries must include the active `currentItinerary` summary so relative semantic references ("the breakfast place in day 2", "move it back to day 1") can be resolved against real place names and categories.
   - Stop moves and swaps without an explicit time-of-day parameter must preserve the stop's category-appropriate slot (e.g. breakfast/morning places stay in morning slots, lunch in afternoon) rather than appending to the end of the day.
14. **Digital Twin Shadow Copy & Simulation Isolation (`src/lib/digital-twin.ts`, `src/lib/twin-store.ts`)**:
   - Digital Twin what-if simulations must operate strictly on deep-cloned shadow copies (`SimulatedTripPlan`) managed in an isolated Zustand slice (`twinStore`). Never mutate the live `useRoam.getState().plan` during simulation runs.
   - User scenario changes remain purely predictive until the traveler explicitly clicks "Accept Simulation".
   - When applying simulation results, always dispatch standard deterministic mutation actions (`move_stop`, `swap_stops`, `adapt_weather`) rather than blindly overwriting the active plan, ensuring meal anchors and safety invariants remain intact.
   - Nugen Domain-Aligned AI tiers must provide a transparent fallback to the existing LLM waterfall when an external NUGEN_API_KEY or endpoint is unconfigured, guaranteeing the application never breaks.
15. **Ambient Wake-Word Spotting, Duplex Voice Barge-In & Phonetic Robustness (`src/components/voice.tsx`, `src/lib/voice-utils.ts`)**:
   - **Full-Duplex Barge-In Interruption**: The ambient wake spotter must remain active during Edge Neural TTS and browser `speechSynthesis` playback. If a wake word is detected while speech is active (`isSpeakingRef.current === true`), immediately terminate speech playback (`speechSynthesis.cancel()`, `audio.pause()`), play the wake chime, and seamlessly transition into active listening or execute the one-shot trailing command.
   - **Self-Trigger Protection**: Never include bare, common vocabulary words (e.g., bare `vibe` without a greeting prefix) in `WAKE_WORDS_REGEX`, as the assistant may utter them in normal itinerary explanations. Unique names like `roamy`, `roomie`, and `roami` may stand alone.
   - **Expanded Indian English Phonetics for "Roamy"**: In Chromium/Edge speech engines, "Hey Roamy" is often phonetically transcribed as `hero me`, `hear me`, `hey romy`, `hey roami`, `hey roomie`, `hey romey`, `hey roam`, or `hey rome`. All phonetic variants must be recognized symmetrically with "Hey Vibe".
   - **One-Shot Utterance Preservation**: When matching a wake word in an ambient transcript, always inspect the trailing text. If a command was spoken in the same breath (e.g. *"Hey Vibe, plan a 2-day trip to Pune"*), cleanly extract the prompt and submit it directly to the planner without requiring the user to repeat themselves. Only drop into recording mode if the user said *only* the wake word.
   - **Stable Recognition Lifecycle**: Web Speech API instances must not be re-created on React state updates. Use stable `useRef` bridges for all action runners and stores to prevent re-render teardown cascades and Chromium `InvalidStateError` deadlocks.
   - **Resilient Error Backoff**: Never immediately retry failed recognition sessions on `"network"` or `"aborted"` errors in a tight loop. Enforce exponential backoff (1.5s–3s) to prevent Chromium speech server rate-limiting.
16. **Generative 3D Asset Orientation & Ambient Companion Viewport Calibration (`src/components/mascot.tsx`)**:
   - **Forward Vector Calibration**: When loading generative GLB models (Tripo, Meshy, Rodin), the model's forward vector often defaults to $\pm X$ instead of $+Z$. Distinguish between the rear helmet dome (smooth shell, earcups visible on flanks) and the front visor face. If a rotation produces the rear dome, apply a $180^\circ$ ($\pi$ radians) inversion: flipping from $-\pi/2$ to $+\pi/2$ or vice versa brings the front visor and face directly to $+Z$ (facing the camera and user).
   - **Compact Viewport Sizing for Floating Companions**: Ambient floating companions should maintain a compact canvas footprint ($\le 115\times 100\text{px}$) with normalized model scale $\approx 1.25–1.35 / \max(\text{dim})$. Accompanying speech bubbles must be capped at $\le 175\text{px}$ width with tight padding (`p-2`), ensuring they provide contextual assistance without occluding itinerary cards or map interactions.



