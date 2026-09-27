# Roam — UI/UX Product Interface & Design Specification (PID.md)

> **Design Philosophy**: Minimalist, authentic, warm terracotta claymorphic aesthetics with fluid micro-interactions, editorial typography, zero clutter, and mobile-first responsiveness.

---

## 1. Visual Identity & Design System

### 1.1 Signature Color Palette

| Token Name | Hex Code | Purpose & Usage |
| :--- | :--- | :--- |
| **Primary Terracotta** | `#D96B43` / `#FF7A45` | Main brand color, active toggles, primary CTA buttons, logo accent. |
| **Amber Gold** | `#F59E0B` / `#D9A441` | Star ratings, highlight tags, golden-hour badges. |
| **Sage Green** | `#7A9A7B` / `#10B981` | Nature badges, verified source indicators, online pulse signals. |
| **Neon Cyan** | `#06B6D4` / `#22D3EE` | AI avatar visor eyes, voice audio active state, interactive water/market tags. |
| **Warm Canvas (Light)** | `#FAF8F5` | Background canvas delivering an organic, non-sterile paper warmth. |
| **Obsidian Slate (Dark)** | `#0D1117` / `#161B22` | Deep contrast dark mode with muted borders (`border-border/40`). |

---

### 1.2 Elevation, Depth & Claymorphism

- **Clay Raised (`.clay-raised`)**: Soft multi-layered inner and drop shadows giving a tactile 3D physical feel without heavy skeuomorphism.
- **Glassmorphic Blur (`backdrop-blur-md` / `backdrop-blur-xl`)**: Frosted glass sticky bars with 90% opacity background allowing scenic content to bleed through softly.
- **Micro-Spring Transitions (`SPRING`)**: Friction `26`, tension `190` providing organic, bouncy UI feedback on clicks, tabs, and modal triggers.

---

## 2. Key UI Component Blueprints

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  [Compass] Roam     [City Pill ▾]        Home  Explore  Gems  Escapes  About     │
│                                           [3D Bot]  [Trip Plan (3)]  [🌙] [≡]    │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ✨ The vacation you deserve is closer than you think                           │
│   Life is short and the world is Wide. ~~~~                                      │
│                                               ┌──────────────────────────────┐   │
│   Explore Pune with verified local community  │ [★ 4.9] Primary Scenic Photo │   │
│   signals and fatigue-paced daily routes.     │                              │   │
│                                               │ ┌──────────────────────────┐ │   │
│   ┌────────────────────────────────────────┐  │ │ Secondary Heritage Photo │ │   │
│   │ Location ▾ │ Duration ▾ │ Pacing ▾ │ 🔍│  │ │ [🌿 500+ Spots]          │ │   │
│   └────────────────────────────────────────┘  └─┴──────────────────────────┴─┘   │
│                                                                                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│  🔍 Search spots, food, lore...  [Pune ▾] [✨ Sort ▾] [Compass Local] [Grid|Map] │
│  [🍽️ Food] [🏰 Heritage] [🌿 Nature] [💎 Hidden Gems] [🧗 Treks] [🌙 Nightlife]    │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  [ PLACE CARDS GRID (1 col mobile → 2 col tablet → 4 col desktop) ]             │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────┐ │
│  │ Photo + Badges   │ │ Photo + Badges   │ │ Photo + Badges   │ │ Photo + Badges│ │
│  │ Name & Category  │ │ Name & Category  │ │ Name & Category  │ │ Name & Cat   │ │
│  │ Open Status • ₹  │ │ Open Status • ₹  │ │ Open Status • ₹  │ │ Open Status  │ │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────┘ │
│                                                                                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│  💎 CURATED LOCAL TREASURES (Full-bleed sliding carousel with community quotes)  │
├──────────────────────────────────────────────────────────────────────────────────┤
│  📜 TRAVEL LORE & PHILOSOPHY (6s Quote Carousel + 5s Sliding Landmark Photo)     │
├──────────────────────────────────────────────────────────────────────────────────┤
│  🧭 CURATED ESCAPES & TRIP BUILDER (6 mood cards + 1..4 day custom route pill)   │
├──────────────────────────────────────────────────────────────────────────────────┤
│  🌟 4-METRIC TRUST STORY COUNTER (100% Zero Bias • Verified Feeds • Pacing)      │
├──────────────────────────────────────────────────────────────────────────────────┤
│  🏛️ FOOTER & ETHICAL MANIFESTO                                                   │
│                                                         [📻 Floating Radio ♫]    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. UI Element Specs & Responsive Layouts

### 3.1 Navbar (`src/components/navbar.tsx`)
- **Brand Mark**: Clean unboxed `Roam` title paired with continuous spinning amber compass (`animate-[spin_16s_linear_infinite]`).
- **Interactive 3D Mascot**: Borderless, unboxed animated character (`AiAvatar`) with gentle floating physics (`y: [0, -3.5, 0]`) and hover scaling (`scale: 1.1`).
- **Responsive Heights**: `h-16` on mobile devices, `h-20` on desktop with sticky glassmorphic blur (`backdrop-blur-md`).

### 3.2 Hero Capsule Search (`src/components/hero.tsx`)
- **Layout**: 3-segment unified capsule containing Location Selector, Duration Dropdown (`1..7 Days`), and Pacing Mode (`Relaxed`, `Balanced`, `Active`, `Budget`, `Comfort`).
- **Visual Staggering**: Dynamic 2-card photography overlap with verified rating pill (`4.9 / 5.0`) and community counter (`500+ Spots`).

### 3.3 Discovery & Live Filter Bar (`src/components/filters.tsx`)
- **Instant Search**: Glassmorphic input field with keyboard shortcut (`/`) autofocus.
- **View Switcher**: Quick-toggle pill for `Grid`, `Map`, and `Pulse` analytics.
- **Category Chips**: Horizontally swipable chip tray with visual icons and active terracotta states.

### 3.4 Live Experience Card (`src/components/cards.tsx`)
- **Image Aspect**: `h-44 sm:h-40` with 16:9 proportion, guaranteed authentic scenic photography.
- **Metadata Layer**: Real-time opening hour status dot (green pinging for Open Now), community quote sparkline, and honest price tags (`Varies on site` / `Free entry`).

---

## 4. Local Explorer Radio Component (Complete Code)

Below is the complete, standalone code for the **Local Explorer Radio Player** (`src/components/radio-player.tsx`). It features keyless audio streams, automatic Radio Browser API fallback, interactive station selection, animated 4-bar equalizer, and smooth mute/play controls.

```tsx
"use client";

import { motion } from "framer-motion";
import { Radio, Volume2, VolumeX, Play, Pause, Music, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "./ui";

export interface RadioStation {
  id: string;
  name: string;
  genre: string;
  streamUrl: string;
  bitrate?: number;
}

// Curated 100% free, reliable Indian radio streams (keyless / open-access)
const CURATED_STATIONS: RadioStation[] = [
  {
    id: "mirchi-top",
    name: "Bollywood Hits & Pop",
    genre: "Bollywood / Hindi",
    streamUrl: "https://stream.zeno.fm/f3wvbbqmdg8uv",
  },
  {
    id: "retro-classics",
    name: "Vividh Retro Classics",
    genre: "Golden Era / 70s-90s",
    streamUrl: "https://stream.zeno.fm/0r0xa792kwzuv",
  },
  {
    id: "indie-chai",
    name: "Chai & Acoustic Indie",
    genre: "Chill / Indie / Folk",
    streamUrl: "https://stream.zeno.fm/78wqv9u9r7zuv",
  },
  {
    id: "classical-ragas",
    name: "Sitar & Classical Ragas",
    genre: "Indian Classical",
    streamUrl: "https://stream.zeno.fm/5wqvv9u9r7zuv",
  },
  {
    id: "punjabi-beats",
    name: "Punjabi & Folk Beats",
    genre: "Bhangra / Folk",
    streamUrl: "https://stream.zeno.fm/yr68c792kwzuv",
  },
];

export function RadioPlayer({
  cityName,
  className,
}: {
  cityName?: string;
  className?: string;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [selectedStation, setSelectedStation] = useState<RadioStation>(CURATED_STATIONS[0]);
  const [stations, setStations] = useState<RadioStation[]>(CURATED_STATIONS);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch live stations from open Radio Browser API with graceful fallback
  useEffect(() => {
    let cancelled = false;
    async function fetchOpenRadio() {
      try {
        const res = await fetch(
          "https://de1.api.radio-browser.info/json/stations/bycountry/India?limit=15&order=votes&reverse=true",
          { headers: { "User-Agent": "RoamTravelApp/1.0" } }
        );
        if (res.ok) {
          const data = (await res.json()) as Array<{
            stationuuid: string;
            name: string;
            tags: string;
            url_resolved: string;
            bitrate: number;
          }>;
          if (!cancelled && Array.isArray(data) && data.length > 0) {
            const parsed: RadioStation[] = data
              .filter((s) => s.url_resolved && s.name)
              .slice(0, 10)
              .map((s) => ({
                id: s.stationuuid,
                name: s.name.length > 24 ? `${s.name.slice(0, 23)}…` : s.name,
                genre: s.tags?.split(",")[0]?.trim() || "Local Radio",
                streamUrl: s.url_resolved,
                bitrate: s.bitrate,
              }));
            if (parsed.length > 0) {
              setStations([...parsed, ...CURATED_STATIONS]);
            }
          }
        }
      } catch {
        // Keep curated fallback stations on network error
      }
    }
    void fetchOpenRadio();
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      setIsLoading(true);
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          setIsLoading(false);
        })
        .catch(() => {
          setIsPlaying(false);
          setIsLoading(false);
        });
    }
  };

  const handleStationChange = (stationId: string) => {
    const target = stations.find((s) => s.id === stationId);
    if (!target) return;
    setSelectedStation(target);
    setIsLoading(true);
    if (audioRef.current) {
      audioRef.current.src = target.streamUrl;
      if (isPlaying) {
        audioRef.current
          .play()
          .then(() => setIsLoading(false))
          .catch(() => {
            setIsPlaying(false);
            setIsLoading(false);
          });
      } else {
        setIsLoading(false);
      }
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  return (
    <div
      className={cn(
        "clay-raised-sm flex items-center gap-2 sm:gap-2.5 px-3 py-1.5 rounded-full border border-border/40 transition-all",
        isPlaying && "ring-2 ring-primary/30 shadow-md",
        className
      )}
      role="region"
      aria-label="Local Explorer Radio"
    >
      <audio
        ref={audioRef}
        src={selectedStation.streamUrl}
        preload="none"
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => {
          setIsLoading(false);
          setIsPlaying(true);
        }}
        onError={() => {
          setIsLoading(false);
          setIsPlaying(false);
        }}
      />

      {/* Play/Pause Button */}
      <button
        onClick={togglePlay}
        disabled={isLoading}
        aria-label={isPlaying ? "Pause radio" : "Play explorer radio"}
        title={isPlaying ? "Pause radio" : `Tune in to ${selectedStation.name}`}
        className={cn(
          "flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full transition-all active:scale-95 shrink-0 cursor-pointer",
          isPlaying
            ? "clay-primary text-white shadow"
            : "bg-surface hover:bg-card text-foreground hover:text-primary"
        )}
      >
        {isLoading ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : isPlaying ? (
          <Pause size={13} className="fill-current" />
        ) : (
          <Play size={13} className="fill-current ml-0.5" />
        )}
      </button>

      {/* Station Name & Genre Dropdown */}
      <div className="flex items-center gap-1.5 min-w-0">
        <Radio size={14} className={cn("shrink-0", isPlaying ? "text-primary animate-pulse" : "text-muted-foreground")} />
        <select
          value={selectedStation.id}
          onChange={(e) => handleStationChange(e.target.value)}
          aria-label="Select radio station"
          className="bg-transparent text-xs font-bold text-foreground outline-none cursor-pointer max-w-[110px] sm:max-w-[160px] truncate"
        >
          {stations.map((s) => (
            <option key={s.id} value={s.id} className="bg-card text-foreground">
              {s.name} ({s.genre})
            </option>
          ))}
        </select>
      </div>

      {/* Animated Equalizer Wave Bars */}
      {isPlaying && (
        <div className="hidden sm:flex items-end gap-[2px] h-3.5 px-1 shrink-0" aria-hidden>
          <span className="w-1 bg-primary rounded-full animate-[bounce_0.8s_ease-in-out_infinite]" style={{ height: "100%" }} />
          <span className="w-1 bg-primary rounded-full animate-[bounce_1.1s_ease-in-out_infinite_0.2s]" style={{ height: "65%" }} />
          <span className="w-1 bg-primary rounded-full animate-[bounce_0.7s_ease-in-out_infinite_0.4s]" style={{ height: "85%" }} />
          <span className="w-1 bg-primary rounded-full animate-[bounce_0.9s_ease-in-out_infinite_0.1s]" style={{ height: "50%" }} />
        </div>
      )}

      {/* Mute Toggle */}
      {isPlaying && (
        <button
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute radio" : "Mute radio"}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
        >
          {isMuted ? <VolumeX size={13} className="text-red-400" /> : <Volume2 size={13} />}
        </button>
      )}
    </div>
  );
}
```
