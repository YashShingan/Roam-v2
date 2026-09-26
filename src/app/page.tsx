"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, CalendarDays, Grid3X3, Map as MapIcon, Mic, Moon, Sun, Waves } from "lucide-react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState , useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Action, Category, Experience, Filters, TripPlan } from "@/lib/types";
import { useRoam } from "@/lib/store";
import { CardSkeletons, PlaceGrid, applyFilters } from "@/components/cards";
import { CityDialog, DEFAULT_FILTERS, FilterBar } from "@/components/filters";
import { Hero } from "@/components/hero";
import { DetailDialog } from "@/components/detail";
import { PulseView } from "@/components/pulse";
import { PlanSheet, type ReplanOptions } from "@/components/plan";
import { CompareSheet, CompareTray } from "@/components/compare";
import { VoicePanel } from "@/components/voice";
import { ProviderModal } from "@/components/provider-modal";
import { recomputePlanMetrics } from "@/lib/planner";
import { deriveStopPriceInfo } from "@/lib/price-engine";
import { adaptPlanForWeather, trimPlanForLateRunning } from "@/lib/circumstance-adapter";
import {
  Attribution,
  HealthDrawer,
  KeyboardHelp,
  OfflineBanner,
  RecentStrip,
  ScrollProgress,
  useKeyboardShortcuts,
} from "@/components/panels";
import { Button, ErrorBoundary, cn, SPRING } from "@/components/ui";

const MapView = dynamic(() => import("@/components/map").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="skeleton-shimmer h-[72vh] w-full rounded-[22px]" />,
});

interface PlacesResponse {
  city: string;
  cityLabel: string;
  lat: number;
  lon: number;
  radiusKm: number;
  places: Experience[];
  degraded: boolean;
  pending: boolean;
  collecting?: {
    status: string;
    startedAt: number;
    sourcesDone: number;
    sourcesTotal: number;
    places: number;
    error?: string;
  };
  error?: string;
}

type View = "grid" | "map" | "pulse";

export default function Home() {
  const [city, setCity] = useState<string>("");
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS });
  const [view, setView] = useState<View>("grid");
  const [detail, setDetail] = useState<Experience | null>(null);
  const [cityOpen, setCityOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [confettiAt, setConfettiAt] = useState<{ x: number; y: number } | null>(null);
  const queryClient = useQueryClient();
  // SSR hydration guard (React-documented pattern; no setState-in-effect)

  const saved = useRoam((s) => s.saved);
  const plan = useRoam((s) => s.plan);
  const setPlan = useRoam((s) => s.setPlan);
  const setLastCity = useRoam((s) => s.setLastCity);
  const compare = useRoam((s) => s.compare);
  const { theme, setTheme } = useTheme();

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // ── boot: URL → lastCity → default ────────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const urlCity = sp.get("city");
    const last = useRoam.getState().lastCity;
    setCity(urlCity || last || "Pune");
    const urlView = sp.get("view");
    if (urlView === "map" || urlView === "pulse") setView(urlView);
    const tripId = sp.get("trip");
    if (tripId) {
      fetch(`/api/trip/${tripId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { plan?: TripPlan } | null) => {
          if (j?.plan) {
            setPlan(j.plan);
            setPlanOpen(true);
            toast.success("Shared trip loaded");
          }
        })
        .catch(() => toast.error("Couldn't load the shared trip"));
    }
    // hydrate filters from URL
    const cats = sp.get("cats");
    setFilters((f) => ({
      ...f,
      q: sp.get("q") ?? "",
      categories: cats ? (cats.split(",") as Category[]) : [],
      budget: sp.get("budget") ? Number(sp.get("budget")) : null,
      sort: (sp.get("sort") as Filters["sort"]) ?? "smart",
      openNow: sp.get("open") === "1",
      hiddenGem: sp.get("gem") === "1",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── URL sync ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!city || !mounted) return;
    const sp = new URLSearchParams();
    sp.set("city", city);
    if (view !== "grid") sp.set("view", view);
    if (filters.q) sp.set("q", filters.q);
    if (filters.categories.length) sp.set("cats", filters.categories.join(","));
    if (filters.budget) sp.set("budget", String(filters.budget));
    if (filters.sort !== "smart") sp.set("sort", filters.sort);
    if (filters.openNow) sp.set("open", "1");
    if (filters.hiddenGem) sp.set("gem", "1");
    window.history.replaceState(null, "", `?${sp.toString()}`);
  }, [city, view, filters, mounted]);

  // ── data queries ──────────────────────────────────────────────────────────
  // Render-first: the API returns stored places instantly and keeps scraping
  // in the background — poll every 4 s while `pending` so new places appear live.
  const placesQuery = useQuery<PlacesResponse>({
    queryKey: ["places", city],
    queryFn: async () => {
      const res = await fetch(`/api/places?city=${encodeURIComponent(city)}&radius=15`);
      const j = (await res.json()) as PlacesResponse;
      if (!res.ok) throw new Error(j.error ?? "places failed");
      return j;
    },
    enabled: !!city,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => (query.state.data?.pending ? 4000 : false),
    refetchIntervalInBackground: true,
    retry: 1,
  });

  const statsQuery = useQuery({
    queryKey: ["stats", city],
    queryFn: async () => {
      const res = await fetch(`/api/stats?city=${encodeURIComponent(city)}`);
      if (!res.ok) throw new Error("stats failed");
      return (await res.json()) as import("@/lib/types").CityStats;
    },
    enabled: !!city && !!placesQuery.data,
  });

  const weatherQuery = useQuery({
    queryKey: ["weather", city, placesQuery.data?.lat],
    queryFn: async () => {
      const res = await fetch(`/api/weather?lat=${placesQuery.data?.lat}&lon=${placesQuery.data?.lon}`);
      if (!res.ok) throw new Error("weather unavailable");
      return (await res.json()) as { tempC: number; label: string; emoji: string; sunset: string; sunrise: string; goldenHour: boolean };
    },
    enabled: !!placesQuery.data?.lat,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health/sources");
      if (!res.ok) throw new Error("health unavailable");
      return (await res.json()) as { collectors: { ok: boolean }[] };
    },
    enabled: !!placesQuery.data,
    retry: 0,
  });

  const places = placesQuery.data?.places ?? [];
  const filtered = useMemo(() => applyFilters(places, filters, saved, null), [places, filters, saved]);

  // toast once when the background discovery finishes
  const wasPending = useRef(false);
  useEffect(() => {
    const pending = !!placesQuery.data?.pending;
    if (wasPending.current && !pending && placesQuery.data) {
      toast.success(`Discovery complete — ${placesQuery.data.places.length} places for ${city}`);
    }
    wasPending.current = pending;
  }, [placesQuery.data, city]);

  // ── handlers ──────────────────────────────────────────────────────────────
  const selectCity = useCallback(
    (c: string, label: string, lat?: number, lon?: number) => {
      setCity(c);
      setCityOpen(false);
      setLastCity(c);
      setFocusedIdx(0);
      const current = useRoam.getState().plan;
      if (current && current.city.toLowerCase() !== c.toLowerCase()) {
        setPlan(null);
      }
      void lat;
      void lon;
    },
    [setLastCity, setPlan],
  );

  // If active city does not match the persisted plan, clear stale plan so routes don't cross cities
  useEffect(() => {
    if (city && plan && plan.city.toLowerCase() !== city.toLowerCase()) {
      setPlan(null);
    }
  }, [city, plan, setPlan]);

  const replan = useCallback(
    async (
      req: ReplanOptions & { budget?: number },
    ) => {
      const effectiveInterests =
        req.interests !== undefined
          ? req.interests
          : filters.categories.length > 0
            ? filters.categories
            : undefined;
      const effectiveBudget = req.budget !== undefined ? req.budget : (filters.budget ?? undefined);
      toast.message(
        `Planning ${req.days} day${req.days > 1 ? "s" : ""} route in ${city}${
          effectiveInterests?.length ? ` (${effectiveInterests.join(", ")})` : ""
        }…`,
      );
      try {
        const res = await fetch("/api/trip/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            city,
            days: req.days,
            hoursPerDay: req.hoursPerDay,
            interests: effectiveInterests,
            strictCategories: req.strictCategories ?? true,
            selectedPlaceIds: req.selectedPlaceIds,
            lockedPlaceIds: req.lockedPlaceIds,
            excludedPlaceIds: req.excludedPlaceIds,
            budget: effectiveBudget,
            vibe: req.vibe,
            transportMode: req.transportMode,
            timeMode: req.timeMode,
            startAnchor: req.startAnchor,
            includeBreakfast: req.includeBreakfast,
            includeLunch: req.includeLunch,
            includeDinner: req.includeDinner,
            persona: req.persona,
            groupSize: req.groupSize,
            accessibleOnly: req.accessibleOnly,
          }),
        });
        const j = (await res.json()) as { plan?: TripPlan; error?: string };
        if (!res.ok || !j.plan) throw new Error(j.error ?? "planning failed");
        setPlan(j.plan);
        setPlanOpen(true);
        toast.success(`Route ready — ${j.plan.days.reduce((a, d) => a + d.stops.length, 0)} stops`);
        if ("speechSynthesis" in window && j.plan.voiceSummary) {
          const u = new SpeechSynthesisUtterance(j.plan.voiceSummary.slice(0, 320));
          u.lang = "en-IN";
          speechSynthesis.cancel();
          speechSynthesis.speak(u);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Planning failed");
      }
    },
    [city, setPlan, filters.categories, filters.budget],
  );

  const applyStopMutation = (a: Action): void => {
    const current = useRoam.getState().plan;
    if (a.type === "add_stop") {
      const target = places.find((p) => p.name.toLowerCase().includes(a.name.toLowerCase()));
      if (!target) {
        toast.message(`No place called “${a.name}” in the current results.`);
        return;
      }
      if (!current) {
        void replan({
          days: 1,
          hoursPerDay: 8,
          selectedPlaceIds: [target.id],
          timeMode: "recommended",
        });
        return;
      }
      const next: TripPlan = structuredClone(current);
      const priceInfo = deriveStopPriceInfo(target);
      next.days[0].stops.push({
        experienceId: target.id,
        name: target.name,
        category: target.category,
        slotStart: "09:00",
        slotEnd: "10:00",
        travelMinFromPrev: 10,
        lat: target.lat,
        lon: target.lon,
        durationMinutes: target.durationMinutes,
        pricePerPerson: priceInfo.pricePerPerson,
        priceBasis: priceInfo.priceBasis,
        priceMin: priceInfo.priceMin,
        priceMax: priceInfo.priceMax,
        priceQuote: priceInfo.priceQuote,
        imageUrl: target.imageUrl,
        note: "Added to route",
      });
      setPlan(recomputePlanMetrics(next, { reslot: true }));
      setPlanOpen(true);
      toast.success(`${target.name} added to Day 1 route`);
    }
    if (a.type === "remove_stop" && current) {
      const next: TripPlan = structuredClone(current);
      let removed = false;
      for (const d of next.days) {
        const idx = d.stops.findIndex((s) => s.name.toLowerCase().includes(a.name.toLowerCase()));
        if (idx >= 0) {
          d.stops.splice(idx, 1);
          removed = true;
          break;
        }
      }
      if (removed) {
        setPlan(recomputePlanMetrics(next, { reslot: true }));
        toast.success(`Removed ${a.name}`);
      } else toast.message(`“${a.name}” isn't in the plan.`);
    }
    if (a.type === "reorder" && current) {
      const next: TripPlan = structuredClone(current);
      const stops = next.days[0].stops;
      const [moved] = stops.splice(Math.min(a.from, stops.length - 1), 1);
      if (moved) {
        stops.splice(Math.min(a.to, stops.length), 0, moved);
        setPlan(recomputePlanMetrics(next, { reslot: true }));
        toast.success("Route reordered");
      }
    }
  };

  const runActions = useCallback(
    (actions: Action[], _reply: string, _nlu: string): void => {
      for (const a of actions) {
        switch (a.type) {
          case "set_city":
            selectCity(a.city, a.city);
            break;
          case "apply_filters":
            setFilters((f) => ({
              ...f,
              categories: a.categories?.length ? a.categories : f.categories,
              budget: a.budget ?? f.budget,
              timeOfDay: (a.timeOfDay as Filters["timeOfDay"]) ?? f.timeOfDay,
              openNow: a.openNow ?? f.openNow,
              hiddenGem: a.hiddenGem ?? f.hiddenGem,
            }));
            break;
          case "plan_trip": {
            if (a.city && a.city.toLowerCase() !== (city || "").toLowerCase()) {
              selectCity(a.city, a.city);
            }
            void replan({
              days: a.days,
              hoursPerDay: a.hoursPerDay,
              interests: a.interests,
              budget: a.budget,
              vibe: a.vibe,
              includeBreakfast: a.includeBreakfast,
              includeLunch: a.includeLunch,
              includeDinner: a.includeDinner,
              persona: a.persona,
              timeMode: a.timeMode,
              startAnchor: a.startAnchor,
            });
            setPlanOpen(true);
            break;
          }
          case "surprise_me": {
            const pool = places.filter((p) => p.community.hiddenGem).concat(places);
            const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 20))];
            if (pick) {
              setDetail(pick);
              setConfettiAt({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
              setTimeout(() => setConfettiAt(null), 1600);
            }
            break;
          }
          case "compare": {
            const ids = a.names
              .map((n) => places.find((p) => p.name.toLowerCase().includes(n.toLowerCase()))?.id)
              .filter((x): x is string => !!x);
            if (ids.length >= 2) {
              useRoam.setState({ compare: ids.slice(0, 3) });
              setCompareOpen(true);
            } else toast.message("Couldn't find both of those to compare — check the names.");
            break;
          }
          case "read_day_plan": {
            setPlanOpen(true);
            if (plan?.voiceSummary && "speechSynthesis" in window) {
              const u = new SpeechSynthesisUtterance(plan.voiceSummary);
              u.lang = "en-IN";
              speechSynthesis.cancel();
              speechSynthesis.speak(u);
            }
            break;
          }
          case "navigate_to": {
            const target = places.find((p) => p.name.toLowerCase().includes(a.name.toLowerCase()));
            if (target?.gmapsUrl) {
              window.open(target.gmapsUrl, "_blank");
              toast.message(`Directions to ${target.name}`);
            } else toast.message(`No map fix for “${a.name}” yet.`);
            break;
          }
          case "answer": {
            const p = placesQuery.data;
            if (a.topic === "weather" && p) {
              void weatherQuery.refetch().then(() => {
                const w = weatherQuery.data;
                toast.message(w ? `${w.emoji} ${w.tempC}°C — ${w.label}. Sunset at ${w.sunset}.` : "Weather source is down right now.");
              });
            } else if (a.topic === "price") {
              const avg = places.filter((x) => x.pricePerPerson).reduce((s, x) => s + (x.pricePerPerson ?? 0), 0) / Math.max(places.length, 1);
              toast.message(`Typical spend lands around ₹${Math.round(avg)} per person (category estimates).`);
            } else if (a.topic === "crowd") {
              const crowded = places.filter((x) => x.community.crowdWarning);
              toast.message(crowded.length ? `⚠️ Community flags: ${crowded.slice(0, 3).map((x) => x.name).join(", ")}` : "No strong crowd warnings in the current signal.");
            } else if (a.topic === "best_time") {
              const golden = places.filter((x) => x.goldenHour);
              toast.message(golden.length ? `Golden-hour picks: ${golden.slice(0, 3).map((x) => x.name).join(", ")} — aim for ${weatherQuery.data?.sunset ?? "sunset"}.` : "Early morning and golden hour are the safe bets.");
            }
            break;
          }
          case "adapt_weather": {
            if (!plan) {
              toast.message("No active plan to adapt. Generate a plan first!");
              break;
            }
            const pool = placesQuery.data?.places ?? places;
            const res = adaptPlanForWeather(plan, pool, a.condition ?? "rain");
            setPlan(res.plan);
            setPlanOpen(true);
            toast.success(res.message);
            break;
          }
          case "running_late": {
            if (!plan) {
              toast.message("No active plan to adjust.");
              break;
            }
            const res = trimPlanForLateRunning(plan, 0, a.delayMinutes ?? 60);
            setPlan(res.plan);
            setPlanOpen(true);
            if (res.trimmedStopName) {
              toast.success(`Recovered time by trimming “${res.trimmedStopName}”. Route reslotted!`);
            } else {
              toast.message("Schedule reslotted for delay.");
            }
            break;
          }
          case "add_stop":
          case "remove_stop":
          case "reorder":
            applyStopMutation(a);
            break;
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [places, plan, weatherQuery, placesQuery.data, replan, selectCity, setPlan],
  );

  // ── keyboard shortcuts ────────────────────────────────────────────────────
  useKeyboardShortcuts(
    useMemo(
      () => ({
        onGrid: () => setView("grid"),
        onMap: () => setView("map"),
        onPulse: () => setView("pulse"),
        onPlan: () => setPlanOpen(true),
        onVoice: () => setVoiceOpen((v) => !v),
        onCompare: () => setCompareOpen(true),
        onTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
        onReset: () => {
          setFilters({ ...DEFAULT_FILTERS });
          toast.message("Filters reset");
        },
        onHealth: () => setHealthOpen((v) => !v),
        onHelp: () => setHelpOpen(true),
        onCycle: (dir) => setFocusedIdx((i) => Math.min(Math.max(i + dir, 0), Math.max(filtered.length - 1, 0))),
        onOpenSelected: () => {
          const p = filtered[focusedIdx];
          if (p) setDetail(p);
        },
      }),
      [theme, setTheme, filtered, focusedIdx],
    ),
  );

  const stopsCount = plan?.days.reduce((a, d) => a + d.stops.length, 0) ?? 0;

  return (
    <main className="pb-28 sm:pb-24">
      <ScrollProgress />
      <OfflineBanner />
      {confettiAt && <ConfettiBurst x={confettiAt.x} y={confettiAt.y} />}

      <ErrorBoundary label="Hero">
        <Hero
          cityLabel={placesQuery.data?.cityLabel ?? city}
          stats={statsQuery.data}
          weather={weatherQuery.data}
          sourcesOk={healthQuery.data?.collectors.filter((c) => c.ok).length ?? 0}
          sourcesTotal={healthQuery.data?.collectors.length ?? 0}
          onOpenCity={() => setCityOpen(true)}
        />
      </ErrorBoundary>

      <FilterBar
        city={city}
        cityLabel={placesQuery.data?.cityLabel ?? city}
        filters={filters}
        onFilters={setFilters}
        onOpenCity={() => setCityOpen(true)}
      />

      <div className="mx-auto max-w-6xl px-3 sm:px-6 pt-4 sm:pt-5">
        {/* view switch & quick actions */}
        <div className="mb-4 sm:mb-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex w-max gap-1 sm:gap-1.5 rounded-full clay-dock p-1 sm:p-1.5 mx-auto sm:mx-0" role="tablist" aria-label="Views">
            {(
              [
                ["grid", <Grid3X3 key="g" size={15} />, "Discover"],
                ["map", <MapIcon key="m" size={15} />, "Map"],
                ["pulse", <Waves key="p" size={15} />, "Pulse"],
              ] as const
            ).map(([v, icon, label]) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "flex items-center gap-1 sm:gap-1.5 rounded-full px-3 sm:px-4 h-8 sm:h-9 text-[12px] sm:text-[13px] font-bold transition-all",
                  view === v ? "clay-primary clay-primary-pressed" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 mx-auto sm:mx-0">
            <button
              onClick={() =>
                replan({
                  days: 1,
                  hoursPerDay: 2,
                  strictCategories: false,
                  timeMode: "capped",
                  persona: "solo",
                })
              }
              className="clay-raised-sm flex items-center gap-1.5 rounded-full px-3.5 h-8 sm:h-9 text-xs font-bold text-foreground hover:text-primary transition-all"
              title="Quick zero-stress micro itinerary for a short 2-hour window near you"
            >
              <span>⚡ 2h Micro-Trip</span>
            </button>
            <button
              onClick={() => setProviderOpen(true)}
              className="clay-raised-sm flex items-center gap-1.5 rounded-full px-3.5 h-8 sm:h-9 text-xs font-bold text-primary hover:bg-primary/10 transition-all border border-primary/25"
              title="List your local tours, workshops, food experiences, or view traveler demand radar"
            >
              <span>🌟 Host / List Experience</span>
            </button>
          </div>
        </div>

        {placesQuery.data?.pending && (
          <div
            className="mb-4 sm:mb-5 flex items-center gap-3 clay-raised-sm px-3 sm:px-4 py-2.5 sm:py-3 text-[13px] sm:text-sm text-muted-foreground"
            role="status"
          >
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            {places.length > 0 ? (
              <span>
                🔍 Live discovery for {city} —{" "}
                <b>
                  {placesQuery.data.collecting?.sourcesDone ?? 0}/{placesQuery.data.collecting?.sourcesTotal ?? 13}
                </b>{" "}
                sources scanned, <b>{places.length}</b> places found so far. New places appear here automatically.
              </span>
            ) : (
              <span>
                First sweep for {city} running — Overpass, Wikipedia, Wikivoyage, Reddit &amp; 9 more open sources.
                First places land in ~15 s, the full uncapped sweep takes a few minutes.
              </span>
            )}
          </div>
        )}

        <ErrorBoundary label="Place grid">
          {view === "grid" && (
            <>
              {placesQuery.isLoading ? (
                <CardSkeletons />
              ) : placesQuery.isError ? (
                <div className="clay-raised mx-auto max-w-md p-8 text-center" role="alert">
                  <div className="text-4xl">📡</div>
                  <p className="mt-3 font-bold">{(placesQuery.error as Error).message}</p>
                  <p className="mt-1 text-sm text-muted-foreground">The open APIs degraded. Retry — Roam degrades gracefully, never white-screens.</p>
                  <Button variant="primary" className="mt-4" onClick={() => void placesQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <p className="mb-3 text-[13px] text-muted-foreground" aria-live="polite">
                    {filtered.length} of {places.length} places · sorted by {filters.sort === "smart" ? "community signal" : filters.sort.replaceAll("_", " ")}
                    {placesQuery.data?.degraded && " · ⚠️ some sources are down, results may be thinner"}
                  </p>
                  <PlaceGrid
                    places={filtered}
                    onOpen={(e) => setDetail(e)}
                    emptyMessage={
                      placesQuery.data?.pending
                        ? `Scanning live sources for ${city} — first places land here in seconds.`
                        : undefined
                    }
                  />
                  <div className="mt-6">
                    <RecentStrip places={places} onOpen={(e) => setDetail(e)} />
                  </div>
                </>
              )}
            </>
          )}

          {view === "map" && (
            <MapView
              places={filtered}
              center={{ lat: placesQuery.data?.lat ?? 19, lon: placesQuery.data?.lon ?? 72.8 }}
              selectedId={detail?.id ?? null}
              onSelect={(e) => setDetail(e)}
              planStops={plan?.days.flatMap((d) => d.stops) ?? []}
              startAnchor={plan?.startAnchor ?? null}
              fitRouteBounds={!!plan}
              savedIds={saved}
            />
          )}

          {view === "pulse" && (
            <PulseView
              stats={statsQuery.data}
              places={places}
              onBarClick={(name) => setFilters((f) => ({ ...f, q: name, localLens: true }))}
              onPieClick={(source) => toast.message(`Filtering by ${source} isn't lossy — search instead: try its places on the grid.`)}
            />
          )}
        </ErrorBoundary>
      </div>

      <Attribution />

      {/* floating dock */}
      <div className="clay-dock fixed bottom-3 sm:bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1 sm:py-1.5 no-print safe-bottom">
        <Button
          variant="primary"
          onClick={() =>
            plan
              ? setPlanOpen(true)
              : void replan({
                  days: 1,
                  hoursPerDay: 8,
                  interests: filters.categories.length > 0 ? filters.categories : undefined,
                  strictCategories: true,
                  selectedPlaceIds: saved.length > 0 ? saved : undefined,
                  timeMode: "recommended",
                })
          }
          aria-label="Day plan"
        >
          <CalendarDays size={15} />
          {plan ? "My plan" : "Plan my day"}
          {stopsCount > 0 && <span className="rounded-full bg-black/20 px-1.5 text-[11px] font-bold">{stopsCount}</span>}
        </Button>
        <Button variant="primary" onClick={() => setVoiceOpen(!voiceOpen)} aria-label="Voice assistant (v)" className="animate-orb">
          <Mic size={16} />
        </Button>
        <Button onClick={() => setHealthOpen(true)} aria-label="Source health (H)">
          <Activity size={15} />
        </Button>
        <Button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme (t)">
          {mounted && theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </Button>
        <Button onClick={() => setHelpOpen(true)} aria-label="Keyboard help (?)" className="font-bold">
          ?
        </Button>
      </div>

      {/* overlays */}
      <CityDialog open={cityOpen} onClose={() => setCityOpen(false)} onSelect={selectCity} />
      <DetailDialog
        exp={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        onAddToTrip={(e) => {
          applyStopMutation({ type: "add_stop", name: e.name });
          setDetail(null);
        }}
      />
      <PlanSheet
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        onReplan={(req) => void replan(req)}
        onOpenPlace={(e) => setDetail(e)}
        onViewOnMap={() => setView("map")}
        places={places}
        activeCategories={filters.categories}
        currentCity={city}
        currentCityLabel={placesQuery.data?.cityLabel ?? city}
        cityCenter={
          placesQuery.data ? { lat: placesQuery.data.lat, lon: placesQuery.data.lon } : undefined
        }
      />
      <CompareSheet open={compareOpen} onClose={() => setCompareOpen(false)} places={places} onOpenPlace={(e) => setDetail(e)} />
      <CompareTray places={places} onOpen={() => setCompareOpen(true)} />
      <VoicePanel
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        runActions={runActions}
        onReadPlan={() => {
          setVoiceOpen(false);
          setPlanOpen(true);
          if (plan?.voiceSummary && "speechSynthesis" in window) {
            const u = new SpeechSynthesisUtterance(plan.voiceSummary);
            u.lang = "en-IN";
            speechSynthesis.cancel();
            speechSynthesis.speak(u);
          }
        }}
      />
      <HealthDrawer
        open={healthOpen}
        onClose={() => setHealthOpen(false)}
        city={city}
        onScraped={() => void placesQuery.refetch()}
      />
      <ProviderModal
        open={providerOpen}
        onClose={() => setProviderOpen(false)}
        city={city}
        onListingCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["places", city] });
          void placesQuery.refetch();
        }}
      />
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      {compare.length >= 2 && view !== "grid" && <span className="sr-only">{compare.length} places queued for comparison</span>}
    </main>
  );
}

function ConfettiBurst({ x, y }: { x: number; y: number }) {
  // random offsets are drawn once per burst and frozen — never during render
  const [pieces] = useState(() =>
    Array.from({ length: 26 }, (_, i) => ({
      angle: (i / 26) * Math.PI * 2,
      dist: 90 + Math.random() * 130,
      spin: 260 + Math.random() * 200,
      color: ["#D96B43", "#7A9A7B", "#D9A441", "#8C5BA8"][i % 4],
    })),
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-[80]" aria-hidden>
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute h-2.5 w-2.5 rounded-[3px]"
          style={{ left: x, top: y, background: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
          animate={{
            x: Math.cos(p.angle) * p.dist,
            y: Math.sin(p.angle) * p.dist + 60,
            opacity: 0,
            rotate: p.spin,
            scale: 0.5,
          }}
          transition={{ duration: 1.3, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}
