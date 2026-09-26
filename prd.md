# Product Requirements Document (PRD)
# Roam v2: Autonomous Agentic Travel Planner & Voice Copilot

**Document Version:** 3.0  
**Status:** Implemented & Verified in Production  
**Scope:** Complete System Specification — Core Data Pipeline, Route Optimization Engine, Deterministic Mutation Layer, Voice Architecture ("Hey Vibe" / "Hey Roamy"), UI/UX Cockpit, and API Endpoints  
**Target Environment:** 100% Free & Open-Source Stack, Serverless Edge-Compatible, Next.js 16 (App Router + Turbopack)

---

## 1. Executive Summary & Vision

**Roam v2** is a hyper-local, autonomous AI travel planner and conversational voice assistant engineered specifically for Indian destinations, culture, transit, and pacing. 

Traditional travel planners rely on expensive closed APIs (Google Maps Platform, OpenAI Realtime, paid weather feeds), impose rigid multi-step form questionnaires, produce hallucinated routes that ignore Indian traffic conditions, and lack contextual voice interaction.

Roam replaces this model with a **100% free, keyless, open-source stack**:
1. **Intelligent Route Optimization:** Generates realistic 1- to 7-day itineraries powered by 2-Opt Traveling Salesperson Problem (TSP) heuristics, regional meal anchoring, biological fatigue buffering for treks, and honest pricing signals.
2. **Conversational Voice Assistant ("Hey Vibe" / "Hey Roamy"):** A hands-free voice loop featuring continuous wake-word spotting, dual smart stop detection (in-browser VAD + verbal trigger), sub-second Groq Whisper STT with Indian entity prompting, agentic tool-calling NLU with active itinerary context injection, and natural Microsoft Edge Neural TTS in Indian English, Hindi, and Marathi.
3. **Deterministic Mutation Engine:** Allows travelers to reorder, move, or swap stops across days via natural voice commands without hallucinating new trips or corrupting scheduled timings.
4. **Interactive Planner Cockpit:** An adaptive interface offering a side drawer and a maximized two-column command center with interactive MapLibre GL routing, live weather radars, and print/export readiness.

---

## 2. Core User Personas & Use Cases

| Persona | Motivation | Primary Workflow |
|---|---|---|
| **Hands-Free Commuter / Traveler** | Walking, driving, or holding bags; needs zero-touch control. | Speaks *"Hey Vibe, plan a 2-day heritage trip in Pune with lunch on FC road"* $\rightarrow$ Voice assistant creates the route, opens the cockpit, and reads aloud the itinerary. |
| **Active Itinerary Modifier** | Adjusting an existing trip on the go. | Inspects schedule $\rightarrow$ Says *"Move Vaishali to Day 2"* or *"Swap Day 1 breakfast with Day 2"* $\rightarrow$ Engine moves the stop to the morning slot and reslots all subsequent legs. |
| **Spontaneous Explorer** | Looking for nearby, crowd-safe, or weather-adapted discoveries. | Says *"I'm running 45 minutes late"* or *"It's raining"* $\rightarrow$ Circumstance adapter trims non-meal stops or swaps outdoor forts for sheltered museums. |
| **Budget & Cultural Traveler** | Seeking verified expenses without synthetic ticket price traps. | Reviews honest pricing signals (*"Free entry"*, *"Varies on site"* for temples/parks) and per-person estimates. |

---

## 3. Complete Architecture & Tech Stack

```
                                  USER INTERFACE LAYER
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  • Next.js 16.3.4 (App Router, Turbopack, React 19)                                  │
│  • Tailwind CSS + Claymorphism / Neumorphic Tactile Tokens                           │
│  • Framer Motion (Spring Physics, Draggable Cockpit, Dock Left/Right Toggle)         │
│  • MapLibre GL (OpenStreetMap Standard + Esri World Imagery, Zero Watermarks)       │
│  • @dnd-kit (Accessible Drag-and-Drop Itinerary Stop Reordering)                     │
└──────────────────────────────────────────┬───────────────────────────────────────────┘
                                           │
                                 STATE & STORAGE LAYER
┌──────────────────────────────────────────┴───────────────────────────────────────────┐
│  • Zustand Client Store (`useRoam`) with LocalStorage Persistence                    │
│  • Local SQLite Embedded Database (`src/lib/db.ts`) for Crawl & Trip Caching         │
│  • Web App Manifest (`manifest.webmanifest`) for PWA Offline Readiness               │
└──────────────────────────────────────────┬───────────────────────────────────────────┘
                                           │
                         VOICE & AGENTIC INTERACTION LAYER
┌──────────────────────────────────────────┴───────────────────────────────────────────┐
│  1. Continuous Wake Spotter: Web Speech API ("Hey Vibe" / "Hey Roamy") with Re-arm   │
│  2. Dual Smart Stop VAD: Web Audio FFT Energy Analyser (3.2s) + Verbal Stop Phrase    │
│  3. Speech-to-Text: Groq Whisper Large v3 (/api/voice/transcribe) + Browser STT      │
│  4. NLU Reasoning: Groq Llama 3.3 70B Versatile (/api/assistant) + OpenRouter +      │
│     WebLLM (Qwen2.5 WebGPU) + Local Ollama + Deterministic Regex Ladder              │
│  5. Text-to-Speech: Microsoft Edge Neural TTS (/api/voice/tts) + Browser Synth       │
└──────────────────────────────────────────┬───────────────────────────────────────────┘
                                           │
                     PLANNING, ROUTING & DATA ENGINE LAYER
┌──────────────────────────────────────────┴───────────────────────────────────────────┐
│  • Places Crawler: Overpass API / OpenStreetMap + Wikipedia API Content              │
│  • Routing & Transit: OSRM Foot & Car Engines with Realistic Urban Transit Speeds    │
│  • Route Optimization: 2-Opt TSP Solver with Meal Anchoring & Biological Buffers     │
│  • Weather & Sun: Open-Meteo API (Temperature, Rain, Golden Hour Sunset Radar)      │
│  • Honest Pricing: Pattern-based extraction with verified quotes & zero fake tiers   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Detailed Subsystem Specifications

### 4.1 Voice Assistant Engine ("Hey Vibe" / "Hey Roamy")

#### A. Continuous Wake Word Spotting & Lifecycle Re-arming
* **Wake Words Supported:** `Hey Vibe`, `Hey Roamy`, `Hey Roam`, `OK Vibe`, `OK Roamy`, `Vibe`, `Roamy`.
* **Regex Engine (`src/lib/voice-utils.ts`):**
  ```regex
  \b(hey\s*vibe|hey\s*roamy|hey\s*roam|ok\s*vibe|ok\s*roamy|vibe|roamy)\b
  ```
* **Auto-Start & Persistence:** Starts automatically on page mount when `handsFreeOn` is enabled (default: `true`, persisted in `localStorage["roam_hands_free"]`).
* **Continuous Re-arming Loop:** To prevent single-turn death in Chromium/Edge:
  * Whenever an interaction turn finishes (`audio.onended` from Edge TTS, browser speech `u.onend` / `u.onerror`, or silence VAD timeout), the wake spotter cleanly restarts.
  * Speech recognition instances are freshly recreated on each cycle to bypass internal WebKit state locks.
* **Instant Barge-In Mute:** The millisecond a wake word or mic tap is detected, active audio playback and browser synthesis are halted immediately (`stopSpeaking()`).
* **Audio Cues (`src/lib/audio-cue.ts`):**
  * **Wake Chime:** Web Audio sine wave transition from 523.25 Hz (C5) to 783.99 Hz (G5).
  * **Done Chime:** Web Audio sine wave transition from 659.25 Hz (E5) to 440 Hz (A4).

#### B. Dual Smart Stop (End-of-Utterance Detection)
1. **Silence VAD (Voice Activity Detection):**
   * Uses Web Audio `AnalyserNode` (`fftSize = 256`, 128 frequency bins).
   * Monitored every 150 ms; average frequency energy `> 12` marks active speech.
   * After the user speaks, **3.2 seconds** of pause triggers an automatic stop chime and recorder flush.
2. **Verbal Stop Phrase Detector:**
   * Concurrent speech recognizer monitors interim transcripts for closing phrases:
     ```regex
     \b(that'?s\s*it|that\s*is\s*all|done|plan\s*it|go\s*ahead|that'?s\s*all|wrap\s*it\s*up)\b[.!?,]?\s*$
     ```
   * Strips the trailing verbal trigger cleanly using `cleanVoiceTranscript()` so the LLM receives only the clean prompt.

#### C. Speech-to-Text (STT) Layer
* **Primary: Groq Whisper Large v3 (`/api/voice/transcribe`):**
  * Transcribes recorded audio blobs (`audio/webm;codecs=opus`, `audio/webm`, or `audio/mp4`).
  * Injected with Indian destination vocabulary prompt to guarantee regional spelling accuracy:
    > *"Travel in India. Indian cities, heritage monuments, forts, temples, food. E.g. Shaniwar Wada, Aga Khan Palace, Sinhagad Fort, Pataleshwar, Kalyan, Titwala, Badlapur, FC Road, Irani Chai, Misal Pav, Vada Pav."*
* **Fallback:** Browser native `SpeechRecognition` configured with language locale (`en-IN`, `hi-IN`, `mr-IN`).

#### D. Agentic Reasoning & Active Itinerary Context Injection (`/api/assistant`)
* **Waterfall:**
  1. Groq Llama 3.3 70B Versatile (Tool Calling Agent)
  2. OpenRouter Llama 3.3 70B (Free Tier Fallback)
  3. WebLLM Qwen2.5 0.5B (On-Device WebGPU)
  4. Ollama Local Server
  5. Deterministic Regex Ladder (`src/lib/nlu.ts`)
* **Active Itinerary State Injection:**
  * Client sends `currentItinerary` containing all active days, stop names, categories, scheduled slot times, and `timeOfDay` tags.
  * Formatted directly into the LLM system prompt:
    ```
    CURRENT ACTIVE ITINERARY IN ROAM:
    Day 1:
      - "Vaishali" (Role/Category: breakfast, Scheduled: 08:30-09:30)
      - "Shaniwar Wada" (Role/Category: culture, Scheduled: 10:00-11:30)
    Day 2:
      - "Cafe Goodluck" (Role/Category: breakfast, Scheduled: 08:30-09:30)
    ```
  * Enables zero-ambiguity resolution of relative references (e.g. *"move the breakfast place which I moved to Day 2 back to Day 1"* $\rightarrow$ resolves to `"Cafe Goodluck"`).

#### E. Speech Synthesis (TTS) Layer
* **Primary: Microsoft Edge Neural TTS (`/api/voice/tts`):**
  * Streaming 24kHz 48kbps MP3 generated via server-side edge engine.
  * Authentic Indian voices:
    * English: `en-IN-NeerjaNeural`
    * Hindi: `hi-IN-SwaraNeural`
    * Marathi: `mr-IN-AarohiNeural`
* **Fallback:** Browser `window.speechSynthesis` (`rate = 1.02`).

---

### 4.2 Itinerary Planning & Route Optimization Engine (`src/lib/planner.ts`)

#### A. Multi-Day Scheduling & 2-Opt TSP Route Optimization
* **Duration:** 1 to 7 days, configurable 2 to 15 hours per day.
* **Algorithm:**
  1. Filters city catalog places by selected categories, budget constraints, and persona.
  2. Clusters stops geographically across days to minimize inter-city transit.
  3. Executes a **2-Opt Traveling Salesperson Problem (TSP)** heuristic to eliminate route self-intersections and backtracking.
  4. Calculates physical travel durations using mode-specific speeds (walking: 4.8 km/h, driving: 24 km/h, transit: realistic Indian urban bus/auto/metro heuristics).

#### B. Pacing Vibes & Personas
* **Vibes:**
  * `chill`: Generous 90–120 min dwell times, low stop density.
  * `packed`: Efficient 45–60 min visits, maximized sights.
  * `foodie`: Prioritizes legendary eateries, tea stalls, and culinary institutions.
  * `heritage`: Prioritizes monuments, forts, museums, and architectural landmarks.
* **Personas:** `solo`, `couple`, `family`, `group`.

#### C. Regional Meal Anchoring Pipeline
* Meal options (`includeBreakfast`, `includeLunch`, `includeDinner`) are passed from UI or voice commands through Zod schemas to `buildTripPlan()`.
* **Slots:**
  * Breakfast: `08:30–09:30 AM`
  * Lunch: `12:30–02:00 PM`
  * Dinner: `07:30–09:00 PM`
* Meal stops are distributed evenly to every day of a multi-day trip rather than clustered by angle into Day 1. Sights are never scheduled during lunch hours.

#### D. Biological Fatigue & Trek Pacing
* Strenuous climbs or treks (`durationMinutes >= 180` or matching `/trek|hike|climb|fort|summit|ghat|waterfall|peak/i`) automatically trigger a **45-minute recovery & chai buffer**.
* When heavy afternoon stops remain after a trek, the planner flags stamina fatigue and provides a 1-click action to move remaining stops to Day 2.

#### E. Strict Invariants
1. **Waking Hours Invariant:** Schedules always start between `08:30 AM` (with breakfast) and `09:00 AM` (standard), never at night.
2. **Anchor Coordinate Guard:** Start anchors (GPS, city center, or named landmark) never inject `(0,0)` Null Island coordinates. Named landmarks are resolved against catalog places or city center.
3. **Daily Stop Limit:** Generated daily plans never assign more than **7 stops per day** (including meals) unless manually added by the traveler.
4. **Zero Repetition:** Sights are never duplicated across different days of the same itinerary.

---

### 4.3 Deterministic Itinerary Mutation Engine

Instead of re-running full trip generation when a user modifies their schedule, Roam uses deterministic mutation actions that preserve user edits:

| Action | Parameters | Behavior |
|---|---|---|
| `move_stop` | `name`, `toDay`, `fromDay?`, `slot?` | Moves a stop across days. If `slot` is omitted, uses **Category-Aware Smart Slotting**: breakfast places automatically insert into the morning slot (index 0 / 08:30 AM) rather than falling to the end of the day; lunch inserts into afternoon; dinner into evening. |
| `swap_stops` | `stopA`, `dayA?`, `stopB`, `dayB?` | Two-way exchange between two stops (intra-day or cross-day). Swaps array indices and runs `recomputePlanMetrics(next, { reslot: true })` to dynamically recalculate travel legs and schedule times. |
| `add_stop` | `name`, `day?`, `slot?` | Adds a verified place from the catalog to the specified day and time slot. |
| `remove_stop` | `name`, `day?` | Drops a stop from the schedule and pulls subsequent stops forward. |
| `reorder` | `from`, `to` | Changes visit sequence within a single day. |
| `adapt_weather` | `condition` (`rain`, `heat`) | Replaces outdoor spots with sheltered indoor venues while keeping meal anchors intact. |
| `running_late` | `delayMinutes` | Compresses the schedule by trimming the least critical non-meal stop and reslotting remaining times. |

---

### 4.4 Data Acquisition & Places Catalog Engine

#### A. Overpass API & OpenStreetMap Crawling (`src/lib/collectors-core.ts`)
* Keyless data acquisition targeting Indian municipal bounding boxes.
* Tags queried: `tourism`, `historic`, `amenity=restaurant|cafe`, `leisure=park|nature_reserve`.
* Entity normalization pipeline (`src/lib/pipeline.ts`) converts OSM nodes and ways into strongly typed `Experience` objects with verified coordinates, categories, and tags.

#### B. Wikipedia & Wikimedia Integration (`/api/places/[id]/wiki`)
* Fetches rich Wikipedia encyclopedic summaries, historical context, and Wikimedia Commons high-resolution photography.
* Cached in local SQLite (`src/lib/db.ts`) with stale-while-revalidate headers.

#### C. Operating Hours & Real-Time Open Status (`src/lib/live-backend.ts`)
* `getPlaceOpenStatus()` evaluates raw OSM `opening_hours` against current Indian Standard Time (IST).
* Generates clear visual badges: `Open Now`, `Closed`, or `Hours Varies`.

#### D. Honest Pricing Engine (`src/lib/price-engine.ts`)
* Rejects synthetic category brackets (e.g. fabricating ₹20–₹50 for temples).
* Places of worship, public gardens, and open viewpoints display **`Free entry`** or **`Varies on site`**.
* Only places with verified crawled ticket quotes or menu ranges display numeric prices.
* Generates accurate per-person trip budget breakdowns (`pricedCount`, `unpricedCount`, `min`, `max`).

---

### 4.5 User Interface & Adaptive Cockpit

#### A. Responsive Day Planner Cockpit (`src/components/plan.tsx`)
* **Dual Workspace Modes:**
  * **Compact Drawer:** Floats over the city grid for quick timeline reference.
  * **Maximized 2-Column Cockpit:** 
    * Left Column: Interactive MapLibre route map, elevation profile, and transit stats.
    * Right Column: Scrollable timeline with drag-and-drop stop reordering (`@dnd-kit`), meal tags, fatigue warning banners, and 1-click mutation triggers.
* **Stop Reactions:**
  * Thumbs Up: Locks stop (`locked: true`) to preserve it across re-plans.
  * Thumbs Down: Excludes stop and triggers regeneration.
* **Export & Sharing:**
  * One-click Calendar (.ICS) export.
  * GPS Navigation (.GPX) track export.
  * Print-optimized layout (`no-print` headers, clean timeline rendering).
  * Unique shareable trip links (`/embed/[tripId]`, `/api/trip/[id]`) with community voting (`/api/trip/[id]/vote`).

#### B. Draggable & Non-Obstructing VoicePanel (`src/components/voice.tsx`)
* **Smart Auto-Docking:** When Day Planner opens, `VoicePanel` automatically relocates from bottom-right (`sm:right-4`) to bottom-left (`sm:left-6`), ensuring neither panel blocks the other.
* **Manual Dock Toggle:** Arrow button (`<ArrowLeftRight />`) toggles docking side on demand.
* **Header Grab Handle:** Uses Framer Motion `useDragControls` (`dragListener={false}`) on the header grab handle (`<GripHorizontal />`), allowing travelers to drag the voice panel anywhere on screen without interfering with text inputs or scrolling.
* **Controls:** Neural TTS toggle, Hands-Free toggle, STT Mode selector (Whisper vs. Browser), WebLLM toggle, and language switcher (`EN`, `HI`, `MR`).

#### C. City Pulse & Golden Hour Radar (`src/components/pulse.tsx`)
* Live weather dashboard via Open-Meteo API.
* Sunset and golden-hour photo countdown timer.
* Quick filters for places open right now and trending community hidden gems.

#### D. Place Comparison Tray & Sheet (`src/components/compare.tsx`)
* Side-by-side comparison of up to 3 selected places across distance, duration, crowd warnings, open hours, and budget.

---

## 5. API Endpoints Reference

| Method | Endpoint | Description | Key Request / Response Parameters |
|---|---|---|---|
| `POST` | `/api/assistant` | Multi-tier conversational agent with function calling. | **Body:** `{ transcript, sessionId, currentItinerary? }`<br>**Returns:** `{ actions: Action[], reply: string, nlu: string }` |
| `POST` | `/api/trip/plan` | 2-Opt TSP itinerary generator. | **Body:** `{ city, days, hoursPerDay, vibe, persona, includeBreakfast, includeLunch, includeDinner, startAnchor }`<br>**Returns:** `TripPlan` |
| `POST` | `/api/trip/adapt` | Adapts active trip for weather or delays. | **Body:** `{ plan, action: "weather" \| "delay", condition?, delayMinutes? }`<br>**Returns:** `TripPlan` |
| `POST` | `/api/voice/transcribe` | Groq Whisper Large v3 STT. | **Body:** `FormData (file: audio blob)`<br>**Returns:** `{ text: string }` |
| `POST` | `/api/voice/tts` | Microsoft Edge Neural TTS. | **Body:** `{ text: string, lang: "en" \| "hi" \| "mr" }`<br>**Returns:** MP3 audio binary stream |
| `GET` | `/api/places` | Catalog search and filter. | **Query:** `city`, `categories`, `budget`, `openNow`<br>**Returns:** `Experience[]` |
| `GET` | `/api/places/[id]/wiki` | Wikipedia content crawler. | **Query:** `name`<br>**Returns:** `{ extract, imageUrl, wikiUrl }` |
| `GET` | `/api/weather` | Open-Meteo weather & sunset. | **Query:** `lat`, `lon`<br>**Returns:** `{ tempC, label, emoji, sunset }` |
| `GET` | `/api/route` | OSRM routing geometry. | **Query:** `points`, `mode: "walk" \| "drive" \| "transit"`<br>**Returns:** `{ geometry, distanceKm, durationMin }` |
| `GET` | `/api/trip/[id]` | Fetches shared trip. | **Returns:** `TripPlan` |
| `POST` | `/api/trip/[id]/vote` | Submits upvote/downvote for a stop. | **Body:** `{ stopIndex, vote: 1 \| -1 }` |
| `GET` | `/api/health/sources` | Service uptime and health check. | **Returns:** Health status of OSM, Overpass, Wikipedia, OSRM, Groq |

---

## 6. Architectural Invariants & Project Rules (AGENTS.md)

1. **MapLibre Marker Positioning:** Never apply CSS `transform` or `transition: transform` to the root DOM element passed to `new maplibre.Marker({ element })`. Always wrap interactive buttons inside an untransformed `<div class="map-marker-root">`.
2. **OSRM Transit Speeds:** Public OSRM endpoints return car speeds on foot profiles. Durations must always be computed from distance using realistic mode speeds (`4.8 km/h` walk, `24 km/h` drive).
3. **Route Pin Isolation:** When a plan is active, route preview maps render only the start anchor and numbered itinerary stop markers (`1..N`).
4. **Keyless Map Invariant:** Never use tile endpoints requiring proprietary API keys or producing watermarks (e.g. CARTO). Default to OpenStreetMap Standard and Esri World Imagery.
5. **Selective Stop Locking:** Only stops explicitly liked (`reactions[id] === 1`) or locked (`s.locked === true`) remain fixed on re-plan.
6. **City Switching Invariant:** Changing cities invalidates previous itineraries and resets start anchors to the new city center.
7. **Honest Pricing Signals:** No synthetic price brackets for places of worship or public parks; display `Free entry` or `Varies on site`.
8. **Emotion-Aware Trek Buffering:** 3+ hour climbs inject an automatic 45-minute recovery buffer and prompt a 1-click move of afternoon stops to Day 2.
9. **Meal Anchor Distribution:** Breakfast, lunch, and dinner are slotted into every active day of multi-day itineraries, avoiding sight visits during lunch.
10. **Adaptive Workspace:** The Day Planner supports both a compact side drawer and a maximized 2-column cockpit.
11. **Speech Hardware Loop Stability:** Never undertake intrusive architectural rewrites on working media hardware loops (`SpeechRecognition`, `MediaRecorder`, Web Audio VAD).
12. **Start Times & Stop Caps:** Initial route leg travel is capped to guarantee waking hour starts (`08:30–09:30 AM`), and daily plans are capped at 7 stops.
13. **Wake Word Re-arming & Context Injection:**
    * Hands-free wake spotters automatically re-arm on all turn completion paths (`audio.onended`, `u.onend`, error fallbacks).
    * Assistant NLU requests include active `currentItinerary` summaries to resolve relative semantic references.
    * Stop moves without explicit slot parameters default to category-appropriate slots (breakfast $\rightarrow$ morning index 0).

---

## 7. Quality Assurance & Test Verification

### 7.1 Automated Vitest Test Suite (`npm test -- --run`)
* **Total Passing Tests:** 57 tests across 2 suites (`tests/agent.test.ts`, `tests/core.test.ts`).
* **Covered Behaviors:**
  * Wake word regex detection and verbal stop phrase extraction.
  * Start anchor coordinate sanitization preventing `(0,0)` Null Island leaks.
  * Strict category isolation (e.g. `interests=['culture']` never injects food stops).
  * Multi-day meal anchor distribution across all days.
  * Zero place repetition across days.
  * Circumstance adaptation for weather (swapping outdoor forts for indoor museums while keeping lunch).
  * Late-running compression trimming non-meal afternoon stops.
  * Two-way stop swapping (`swap_stops`) across days and intra-day.
  * Category-aware morning slot preservation for breakfast stops.
  * Rule-based NLU parsing for `move_stop` and `swap_stops`.

### 7.2 Production Turbopack Compilation (`npm run build`)
* Zero TypeScript compilation errors (`tsc --noEmit`).
* Next.js 16 App Router statically and dynamically pre-rendered with zero Turbopack warnings.
* Full PWA manifest generation.
