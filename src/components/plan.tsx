"use client";

import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Car,
  CheckCircle2,
  Circle,
  Clock,
  Compass,
  Download,
  ExternalLink,
  Footprints,
  ListChecks,
  LocateFixed,
  Lock,
  LockOpen,
  Map as MapIcon,
  MapPin,
  Navigation,
  Printer,
  QrCode,
  Share2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CATEGORIES,
  type Category,
  type Experience,
  type ItineraryStop,
  type StartAnchor,
  type TimeMode,
  type TransportMode,
  type TravelerPersona,
  type TripPlan,
  type Vibe,
} from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/catalog";
import { translate, type DictKey } from "@/lib/i18n";
import { useRoam } from "@/lib/store";
import { download, icsForPlan, planToText } from "@/lib/exports";
import { buildMultiStopGmapsUrl, recomputePlanMetrics } from "@/lib/planner";
import {
  adaptPlanForWeather,
  trimPlanForLateRunning,
  suggestAlternativesForStop,
} from "@/lib/circumstance-adapter";
import { Button, Modal, Slider, cn, SPRING } from "./ui";
import { CATEGORY_EMOJI } from "./cards";

const EmbeddedRouteMap = dynamic(() => import("./map").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="skeleton-shimmer h-56 w-full rounded-2xl" />,
});

export const VIBES: { id: string; label: string }[] = [
  { id: "all", label: "✨ All-Round" },
  { id: "chill", label: "🌿 Chill" },
  { id: "packed", label: "⚡ Packed" },
  { id: "foodie", label: "🍲 Foodie" },
  { id: "heritage", label: "🏛️ Heritage" },
];

export const TIME_BADGES: Record<string, { label: string; icon: string; bg: string }> = {
  morning: { label: "Morning", icon: "🌅", bg: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  lunch: { label: "Lunch", icon: "🍛", bg: "bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  afternoon: { label: "Afternoon", icon: "🏛️", bg: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  sunset: { label: "Golden Hour", icon: "🌇", bg: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  dinner: { label: "Dinner", icon: "🍽️", bg: "bg-red-500/10 text-red-700 dark:text-red-300" },
  evening: { label: "Evening", icon: "🛍️", bg: "bg-purple-500/10 text-purple-700 dark:text-purple-300" },
};

export interface ReplanOptions {
  days: number;
  hoursPerDay: number;
  interests?: Category[];
  strictCategories?: boolean;
  selectedPlaceIds?: string[];
  lockedPlaceIds?: string[];
  excludedPlaceIds?: string[];
  transportMode?: TransportMode;
  timeMode?: TimeMode;
  startAnchor?: StartAnchor;
  vibe?: Vibe;
  includeBreakfast?: boolean;
  includeLunch?: boolean;
  includeDinner?: boolean;
  persona?: TravelerPersona;
  groupSize?: number;
  accessibleOnly?: boolean;
}

export function PlanSheet({
  open,
  onClose,
  onReplan,
  onOpenPlace,
  onViewOnMap,
  places = [],
  activeCategories = [],
  cityCenter,
  currentCity,
  currentCityLabel,
}: {
  open: boolean;
  onClose: () => void;
  onReplan: (req: ReplanOptions) => void;
  onOpenPlace: (exp: Experience) => void;
  onViewOnMap?: () => void;
  places?: Experience[];
  activeCategories?: Category[];
  cityCenter?: { lat: number; lon: number };
  currentCity?: string;
  currentCityLabel?: string;
}) {
  const plan = useRoam((s) => s.plan);
  const patchPlan = useRoam((s) => s.patchPlan);
  const savedIds = useRoam((s) => s.saved);
  const lang = useRoam((s) => s.lang);
  const t = (k: DictKey) => translate(lang, k);

  const [dayIdx, setDayIdx] = useState(0);
  const [hours, setHours] = useState(plan ? Math.max(2, Math.min(15, Math.round(plan.days[0]?.totalHours ?? 8))) : 8);
  const [days, setDays] = useState(plan?.days.length ?? 1);
  const [selectedVibe, setSelectedVibe] = useState<string>("all");
  const [transportMode, setTransportMode] = useState<TransportMode>(plan?.transportMode ?? "walk");
  const [timeMode, setTimeMode] = useState<TimeMode>(plan?.timeMode ?? "recommended");
  const [selectedCats, setSelectedCats] = useState<Category[]>(
    plan?.selectedCategories?.length ? plan.selectedCategories : activeCategories,
  );
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<string[]>([]);
  const [hasCustomPlaceSelection, setHasCustomPlaceSelection] = useState(false);
  const [showPlaceSelector, setShowPlaceSelector] = useState(false);
  const [showRouteMap, setShowRouteMap] = useState(true);
  const [anchorType, setAnchorType] = useState<"city" | "gps" | "place">(plan?.startAnchor?.type ?? "city");
  const [anchorPlaceId, setAnchorPlaceId] = useState<string>(plan?.startAnchor?.placeId ?? "");
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [editingStopIdx, setEditingStopIdx] = useState<number | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<string, 1 | -1 | 0>>({});
  const [isMaximized, setIsMaximized] = useState(false);
  const [includeBreakfast, setIncludeBreakfast] = useState(plan?.includeBreakfast ?? false);
  const [includeLunch, setIncludeLunch] = useState(plan?.includeLunch ?? true);
  const [includeDinner, setIncludeDinner] = useState(plan?.includeDinner ?? false);
  const [persona, setPersona] = useState<TravelerPersona>(plan?.persona ?? "solo");
  const [accessibleOnly, setAccessibleOnly] = useState<boolean>(plan?.accessibleOnly ?? false);
  const [adaptingWeather, setAdaptingWeather] = useState(false);
  const [trimmingLate, setTrimmingLate] = useState(false);
  const [selectedAltStop, setSelectedAltStop] = useState<ItineraryStop | null>(null);
  const [altCandidates, setAltCandidates] = useState<Experience[]>([]);
  const speakingRef = useRef(false);

  const handleWeatherAdapt = (condition: "rain" | "heat") => {
    if (!plan) return;
    setAdaptingWeather(true);
    try {
      const res = adaptPlanForWeather(plan, places, condition);
      patchPlan(res.plan);
      toast.success(res.message);
    } catch {
      toast.error("Failed to adapt plan for weather");
    } finally {
      setAdaptingWeather(false);
    }
  };

  const handleRunningLate = (delayMin = 60) => {
    if (!plan) return;
    setTrimmingLate(true);
    try {
      const res = trimPlanForLateRunning(plan, dayIdx, delayMin);
      patchPlan(res.plan);
      toast.success(
        res.trimmedStopName
          ? `Recovered ${delayMin}m delay by trimming ${res.trimmedStopName}`
          : `Schedule adjusted for ${delayMin}m delay`,
      );
    } catch {
      toast.error("Failed to adjust schedule");
    } finally {
      setTrimmingLate(false);
    }
  };

  const handleOpenAlternatives = (stop: ItineraryStop) => {
    setSelectedAltStop(stop);
    const alts = suggestAlternativesForStop(stop, places, 4);
    setAltCandidates(alts);
  };

  const handleSwapWithAlternative = (alt: Experience) => {
    if (!plan || !selectedAltStop) return;
    const next: TripPlan = structuredClone(plan);
    const day = next.days[dayIdx];
    const sIdx = day.stops.findIndex((s) => s.experienceId === selectedAltStop.experienceId);
    if (sIdx >= 0) {
      const old = day.stops[sIdx];
      day.stops[sIdx] = {
        experienceId: alt.id,
        name: alt.name,
        category: alt.category,
        slotStart: old.slotStart,
        slotEnd: old.slotEnd,
        travelMinFromPrev: old.travelMinFromPrev,
        durationMinutes: alt.durationMinutes || 60,
        pricePerPerson: alt.pricePerPerson,
        priceBasis: alt.priceHint ? "verified_quote" : "Varies on site",
        priceMin: alt.priceHint?.min,
        priceMax: alt.priceHint?.max,
        lat: alt.lat,
        lon: alt.lon,
        imageUrl: alt.imageUrl,
        note: `Smart substitute for ${old.name}`,
      };
      const updated = recomputePlanMetrics(next, { reslot: true });
      patchPlan(updated);
      toast.success(`Swapped ${old.name} with ${alt.name}`);
      setSelectedAltStop(null);
    }
  };

  // Sync local categories when main grid filter changes and no custom categories set yet
  useEffect(() => {
    if (activeCategories.length > 0 && selectedCats.length === 0) {
      setSelectedCats(activeCategories);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategories]);

  const isPlanSameCity =
    !plan || !currentCity || plan.city.toLowerCase() === currentCity.toLowerCase();

  // Sync selectedPlaceIds with current plan's stops when plan loads for the active city
  useEffect(() => {
    if (plan && isPlanSameCity) {
      const stopIds = plan.days.flatMap((d) => d.stops.map((s) => s.experienceId));
      setSelectedPlaceIds(stopIds);
      setHasCustomPlaceSelection(false);
      // Seed reactions from locked stops while clearing stale dislikes from swapped stops
      const nextReactions: Record<string, 1 | -1 | 0> = {};
      for (const d of plan.days) {
        for (const s of d.stops) {
          if (s.locked) nextReactions[s.experienceId] = 1;
        }
      }
      setReactions(nextReactions);
      if (plan.transportMode) setTransportMode(plan.transportMode);
      if (plan.timeMode) setTimeMode(plan.timeMode);
      if (plan.includeBreakfast !== undefined) setIncludeBreakfast(plan.includeBreakfast);
      if (plan.includeLunch !== undefined) setIncludeLunch(plan.includeLunch);
      if (plan.includeDinner !== undefined) setIncludeDinner(plan.includeDinner);
      if (plan.persona) setPersona(plan.persona);
      if (plan.accessibleOnly !== undefined) setAccessibleOnly(plan.accessibleOnly);
      if (plan.startAnchor) {
        setAnchorType(plan.startAnchor.type);
        if (plan.startAnchor.placeId) setAnchorPlaceId(plan.startAnchor.placeId);
      }
    } else if (!isPlanSameCity) {
      setSelectedPlaceIds([]);
      setAnchorType("city");
      setReactions({});
    } else if (savedIds.length > 0 && selectedPlaceIds.length === 0) {
      setSelectedPlaceIds(savedIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id, currentCity, isPlanSameCity]);

  // Candidate places filtered strictly by selectedCats
  const candidatePlaces = useMemo(() => {
    if (selectedCats.length === 0) return places;
    return places.filter((p) => selectedCats.includes(p.category));
  }, [places, selectedCats]);

  const resolveStartAnchor = (): StartAnchor => {
    const activeCityLabel =
      (isPlanSameCity ? plan?.cityLabel : undefined) ?? currentCityLabel ?? currentCity ?? "City";
    const fallbackLat =
      cityCenter?.lat ?? (isPlanSameCity ? plan?.lat : undefined) ?? 19.2437;
    const fallbackLon =
      cityCenter?.lon ?? (isPlanSameCity ? plan?.lon : undefined) ?? 73.1355;
    if (anchorType === "gps" && gpsCoords) {
      return {
        type: "gps",
        label: "My GPS Location",
        lat: gpsCoords.lat,
        lon: gpsCoords.lon,
      };
    }
    if (anchorType === "place" && anchorPlaceId) {
      const found = places.find((p) => p.id === anchorPlaceId);
      if (found && found.lat !== undefined && found.lon !== undefined) {
        return {
          type: "place",
          label: found.name,
          lat: found.lat,
          lon: found.lon,
          placeId: found.id,
        };
      }
    }
    return {
      type: "city",
      label: `${activeCityLabel.split(",")[0]} Center`,
      lat: fallbackLat,
      lon: fallbackLon,
    };
  };

  const handleUseGps = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation is not supported by this browser");
      return;
    }
    toast.message("Acquiring your GPS coordinates…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setGpsCoords(coords);
        setAnchorType("gps");
        toast.success("Start anchor set to your GPS location");
      },
      () => {
        toast.error("Could not read GPS location — check browser permissions");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const toggleCategory = (cat: Category) => {
    setSelectedCats((prev) => {
      const next = prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat];
      // Clear selectedPlaceIds that don't belong to the newly restricted categories
      if (next.length > 0) {
        setSelectedPlaceIds((ids) =>
          ids.filter((id) => {
            const p = places.find((x) => x.id === id);
            return p ? next.includes(p.category) : false;
          }),
        );
      }
      return next;
    });
  };

  const toggleCandidatePlace = (id: string) => {
    setHasCustomPlaceSelection(true);
    setSelectedPlaceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const triggerRouteCalculation = (overrides?: Partial<ReplanOptions> & { forceUseSelectedIds?: boolean }) => {
    const cats = overrides?.interests ?? (selectedCats.length > 0 ? selectedCats : undefined);
    const currentStops = plan?.days.flatMap((d) => d.stops) ?? [];
    const excludedIds =
      overrides?.excludedPlaceIds ??
      Object.entries(reactions)
        .filter(([, val]) => val === -1)
        .map(([id]) => id);

    // Locked stops: ONLY stops explicitly liked (👍 reactions === 1) or locked with padlock (s.locked === true)
    const lockedIds =
      overrides?.lockedPlaceIds ??
      currentStops
        .filter((s) => !excludedIds.includes(s.experienceId) && (s.locked || reactions[s.experienceId] === 1))
        .map((s) => s.experienceId);

    const validIds = selectedPlaceIds.filter((id) => {
      if (excludedIds.includes(id)) return false;
      const p = places.find((x) => x.id === id);
      if (!p) return false;
      return !cats || cats.length === 0 || cats.includes(p.category);
    });

    const useExplicitSelectedIds =
      overrides?.selectedPlaceIds !== undefined
        ? overrides.selectedPlaceIds
        : (overrides?.forceUseSelectedIds || hasCustomPlaceSelection || !plan) && validIds.length > 0
          ? validIds
          : undefined;

    onReplan({
      days,
      hoursPerDay: hours,
      interests: cats,
      strictCategories: true,
      selectedPlaceIds: useExplicitSelectedIds,
      lockedPlaceIds: lockedIds.length > 0 ? lockedIds : undefined,
      excludedPlaceIds: excludedIds.length > 0 ? excludedIds : undefined,
      transportMode: overrides?.transportMode ?? transportMode,
      timeMode: overrides?.timeMode ?? timeMode,
      startAnchor: overrides?.startAnchor ?? resolveStartAnchor(),
      vibe: overrides?.vibe ?? (selectedVibe === "all" ? undefined : (selectedVibe as Vibe)),
      includeBreakfast: overrides?.includeBreakfast ?? includeBreakfast,
      includeLunch: overrides?.includeLunch ?? includeLunch,
      includeDinner: overrides?.includeDinner ?? includeDinner,
      persona: overrides?.persona ?? persona,
      accessibleOnly: overrides?.accessibleOnly ?? accessibleOnly,
    });
  };

  /**
   * Re-fetches OSRM leg geometry & travel durations from /api/route for Day dIdx
   * and runs recomputePlanMetrics so any stop mutation (move, delete, mode switch)
   * updates the route polyline, travel times, slots, and price bands immediately.
   */
  const refreshDayRouteAndMetrics = async (
    draftPlan: TripPlan,
    dIdx: number,
    preserveCustomTravelMin = false,
  ): Promise<void> => {
    // Immediately recompute and patch so mode switches (Walk <-> Drive) update leg minutes & totalHours in <1ms
    const immediate = recomputePlanMetrics(draftPlan, {
      reslot: true,
      hoursPerDayCap: hours,
      recalcTravelFromMode: !preserveCustomTravelMin,
    });
    patchPlan(immediate);

    const mode = immediate.transportMode ?? transportMode;
    const day = immediate.days[dIdx];
    if (day && day.stops.length > 0 && !preserveCustomTravelMin) {
      const anchor = immediate.startAnchor;
      const stopPts = day.stops
        .filter((s) => s.lat !== undefined && s.lon !== undefined)
        .map((s) => [s.lat as number, s.lon as number]);

      const includeAnchor =
        anchor &&
        stopPts.length > 0 &&
        (Math.abs(anchor.lat - stopPts[0][0]) > 0.0005 ||
          Math.abs(anchor.lon - stopPts[0][1]) > 0.0005);

      const allPts = includeAnchor && anchor ? [[anchor.lat, anchor.lon], ...stopPts] : stopPts;

      if (allPts.length >= 2) {
        try {
          const wp = allPts.map(([la, lo]) => `${la},${lo}`).join(";");
          const res = await fetch(`/api/route?waypoints=${encodeURIComponent(wp)}&mode=${mode}`);
          if (res.ok) {
            const data = (await res.json()) as {
              legs?: { minutes: number; km: number; geometry: [number, number][] }[];
            };
            if (data.legs) {
              for (let i = 0; i < day.stops.length; i++) {
                const legIdx = includeAnchor ? i : i - 1;
                if (legIdx >= 0 && data.legs[legIdx]) {
                  day.stops[i].travelMinFromPrev = data.legs[legIdx].minutes;
                  day.stops[i].legKmFromPrev = data.legs[legIdx].km;
                  day.stops[i].legGeometry = data.legs[legIdx].geometry;
                } else if (i === 0 && !includeAnchor) {
                  day.stops[i].travelMinFromPrev = 0;
                  day.stops[i].legKmFromPrev = 0;
                  day.stops[i].legGeometry = undefined;
                }
              }
            }
          }
        } catch {
          /* fallback to estimateLeg inside recomputePlanMetrics */
        }
      }
    }

    const recomputed = recomputePlanMetrics(immediate, {
      reslot: true,
      hoursPerDayCap: hours,
      recalcTravelFromMode: !preserveCustomTravelMin,
    });
    patchPlan(recomputed);
    void fetch(`/api/trip/${recomputed.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recomputed),
    }).catch(() => undefined);
  };

  const allStops = useMemo(() => plan?.days.flatMap((d) => d.stops) ?? [], [plan]);
  const visitedCount = allStops.filter((s) => s.visited).length;
  const progress = allStops.length ? Math.round((visitedCount / allStops.length) * 100) : 0;

  // ── Empty state: Interactive Route Builder ("Select Places → Form Route") ──
  if (!plan) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        labelledBy="plan-title"
        side
        maximized={isMaximized}
        onToggleMaximize={() => setIsMaximized((v) => !v)}
      >
        <div className="thin-scroll flex h-full flex-col overflow-y-auto p-4 sm:p-5 space-y-4">
          <div>
            <h2 id="plan-title" className="text-xl font-bold flex items-center gap-2">
              🧭 Build Your Route
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Select categories or specific places, choose your starting point &amp; travel mode, and calculate an optimized route.
            </p>
          </div>

          {/* 1. Category Filter */}
          <div className="clay-raised-sm p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                1. Filter Categories (Strict)
              </span>
              {selectedCats.length > 0 && (
                <button
                  onClick={() => setSelectedCats([])}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  All categories
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => {
                const active = selectedCats.includes(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-bold transition-all",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-surface text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {CATEGORY_EMOJI[cat]} {CATEGORY_LABEL[cat].split(" ")[0]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Starting Point */}
          <div className="clay-raised-sm p-3.5 space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              2. Starting Anchor
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setAnchorType("city")}
                className={cn(
                  "flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold",
                  anchorType === "city" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground",
                )}
              >
                <MapPin size={12} /> City Center
              </button>
              <button
                onClick={handleUseGps}
                className={cn(
                  "flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold",
                  anchorType === "gps" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground",
                )}
              >
                <LocateFixed size={12} /> My GPS
              </button>
              <button
                onClick={() => setAnchorType("place")}
                className={cn(
                  "flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold",
                  anchorType === "place" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground",
                )}
              >
                <Compass size={12} /> Specific Place
              </button>
            </div>
            {anchorType === "place" && (
              <select
                value={anchorPlaceId}
                onChange={(e) => setAnchorPlaceId(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-semibold"
              >
                <option value="">Select starting landmark…</option>
                {candidatePlaces.slice(0, 50).map((p) => (
                  <option key={p.id} value={p.id}>
                    {CATEGORY_EMOJI[p.category]} {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 3. Candidate Places Checklist */}
          <div className="clay-raised-sm p-3.5 space-y-2 flex-1 min-h-[180px] flex flex-col">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                3. Select Places ({selectedPlaceIds.length || "Auto Top"} of {candidatePlaces.length})
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedPlaceIds(candidatePlaces.slice(0, 6).map((p) => p.id))}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  Pick top 6
                </button>
                {selectedPlaceIds.length > 0 && (
                  <button
                    onClick={() => setSelectedPlaceIds([])}
                    className="text-[11px] font-semibold text-muted-foreground hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="thin-scroll flex-1 overflow-y-auto max-h-56 space-y-1 pr-1">
              {candidatePlaces.slice(0, 40).map((p) => {
                const checked = selectedPlaceIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs cursor-pointer transition-colors",
                      checked ? "bg-primary/12 font-bold text-foreground" : "hover:bg-surface text-muted-foreground",
                    )}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCandidatePlace(p.id)}
                        className="accent-primary rounded"
                      />
                      <span className="truncate">
                        {CATEGORY_EMOJI[p.category]} {p.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {p.durationMinutes}m
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 4. Meal Anchors */}
          <div className="clay-raised-sm p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                🍽️ Meal Stops En Route
              </span>
              <span className="text-[10px] text-muted-foreground">Auto-slots authentic local food</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              <label
                className={cn(
                  "flex flex-col items-center justify-center p-2 rounded-xl text-center cursor-pointer border transition-colors",
                  includeBreakfast
                    ? "bg-amber-500/15 border-amber-500/40 text-foreground font-bold"
                    : "bg-surface border-transparent text-muted-foreground hover:bg-surface/80",
                )}
              >
                <input
                  type="checkbox"
                  checked={includeBreakfast}
                  onChange={(e) => setIncludeBreakfast(e.target.checked)}
                  className="sr-only"
                />
                <span className="text-sm">🌅</span>
                <span className="text-[11px] mt-0.5">Breakfast</span>
                <span className="text-[9px] text-muted-foreground">~8:30 AM</span>
              </label>
              <label
                className={cn(
                  "flex flex-col items-center justify-center p-2 rounded-xl text-center cursor-pointer border transition-colors",
                  includeLunch
                    ? "bg-orange-500/15 border-orange-500/40 text-foreground font-bold"
                    : "bg-surface border-transparent text-muted-foreground hover:bg-surface/80",
                )}
              >
                <input
                  type="checkbox"
                  checked={includeLunch}
                  onChange={(e) => setIncludeLunch(e.target.checked)}
                  className="sr-only"
                />
                <span className="text-sm">🍛</span>
                <span className="text-[11px] mt-0.5">Lunch</span>
                <span className="text-[9px] text-muted-foreground">~1:00 PM</span>
              </label>
              <label
                className={cn(
                  "flex flex-col items-center justify-center p-2 rounded-xl text-center cursor-pointer border transition-colors",
                  includeDinner
                    ? "bg-red-500/15 border-red-500/40 text-foreground font-bold"
                    : "bg-surface border-transparent text-muted-foreground hover:bg-surface/80",
                )}
              >
                <input
                  type="checkbox"
                  checked={includeDinner}
                  onChange={(e) => setIncludeDinner(e.target.checked)}
                  className="sr-only"
                />
                <span className="text-sm">🍽️</span>
                <span className="text-[11px] mt-0.5">Dinner</span>
                <span className="text-[9px] text-muted-foreground">~8:00 PM</span>
              </label>
            </div>
          </div>

          {/* 5. Transport & Time Mode */}
          <div className="clay-raised-sm p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-muted-foreground">Mode:</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setTransportMode("walk")}
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold",
                    transportMode === "walk" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground",
                  )}
                >
                  <Footprints size={12} /> Walk
                </button>
                <button
                  onClick={() => setTransportMode("drive")}
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold",
                    transportMode === "drive" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground",
                  )}
                >
                  <Car size={12} /> Drive / Auto
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-muted-foreground">Travel Time:</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setTimeMode("recommended")}
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold",
                    timeMode === "recommended" ? "bg-accent text-white" : "bg-surface text-muted-foreground",
                  )}
                >
                  <Sparkles size={12} /> Engine Recommended
                </button>
                <button
                  onClick={() => setTimeMode("capped")}
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold",
                    timeMode === "capped" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground",
                  )}
                >
                  <Clock size={12} /> Custom Hours
                </button>
              </div>
            </div>

            {timeMode === "capped" && (
              <Slider label="Hours / day cap" min={2} max={15} value={hours} onChange={setHours} format={(v) => `${v} h`} />
            )}
          </div>

          {/* 6. Traveler Persona & Accessibility */}
          <div className="clay-raised-sm p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground">
                6. Traveler Persona &amp; Group Pacing
              </span>
              <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer text-foreground">
                <input
                  type="checkbox"
                  checked={accessibleOnly}
                  onChange={(e) => setAccessibleOnly(e.target.checked)}
                  className="rounded border-border text-primary accent-primary"
                />
                <span>♿ Wheelchair Accessible</span>
              </label>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
              {(
                [
                  { id: "solo", label: "🎒 Solo", desc: "Hidden gems & culture" },
                  { id: "couple", label: "👫 Couple", desc: "Golden hour & cafes" },
                  { id: "family", label: "👨‍👩‍👧 Family", desc: "Kid safe & relaxed" },
                  { id: "group", label: "👥 Group", desc: "Food & energy" },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPersona(p.id)}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-xl text-center transition-all border",
                    persona === p.id
                      ? "bg-primary/15 border-primary/40 font-bold text-foreground shadow-sm"
                      : "bg-surface border-transparent text-muted-foreground hover:bg-surface/80",
                  )}
                >
                  <span className="text-xs">{p.label}</span>
                  <span className="text-[9px] text-muted-foreground">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <Button variant="primary" className="w-full justify-center py-3 font-bold" onClick={() => triggerRouteCalculation()}>
            🗺️ Calculate Optimal Route
          </Button>
        </div>
      </Modal>
    );
  }

  const day = plan.days[Math.min(dayIdx, plan.days.length - 1)];
  const fullDayGmapsUrl = buildMultiStopGmapsUrl(day.stops, plan.startAnchor, transportMode);

  const mutateStop = (
    dIdx: number,
    sIdx: number,
    patch: Partial<(typeof day.stops)[number]>,
    dir?: -1 | 1,
  ): void => {
    const next: TripPlan = structuredClone(plan);
    const stops = next.days[dIdx].stops;
    let reordered = false;
    if (dir && dir === -1 && sIdx > 0) {
      [stops[sIdx - 1], stops[sIdx]] = [stops[sIdx], stops[sIdx - 1]];
      reordered = true;
    } else if (dir && dir === 1 && sIdx < stops.length - 1) {
      [stops[sIdx + 1], stops[sIdx]] = [stops[sIdx], stops[sIdx + 1]];
      reordered = true;
    } else if (!dir) {
      stops[sIdx] = { ...stops[sIdx], ...patch };
    }
    const editedCustomTime =
      !reordered && (patch.travelMinFromPrev !== undefined || patch.durationMinutes !== undefined);
    void refreshDayRouteAndMetrics(next, dIdx, editedCustomTime || !reordered);
  };

  const removeStop = (dIdx: number, sIdx: number): void => {
    const next: TripPlan = structuredClone(plan);
    const removed = next.days[dIdx].stops.splice(sIdx, 1)[0];
    if (removed) {
      setSelectedPlaceIds((ids) => ids.filter((id) => id !== removed.experienceId));
    }
    void refreshDayRouteAndMetrics(next, dIdx, false);
  };

  const moveStopToDay = (fromDayIdx: number, toDayIdx: number, sIdx: number): void => {
    if (fromDayIdx === toDayIdx || !plan || !plan.days[fromDayIdx] || !plan.days[toDayIdx]) return;
    const next: TripPlan = structuredClone(plan);
    const [moved] = next.days[fromDayIdx].stops.splice(sIdx, 1);
    if (!moved) return;
    next.days[toDayIdx].stops.push(moved);
    toast.success(`Moved "${moved.name}" to Day ${toDayIdx + 1}`);

    const immediate = recomputePlanMetrics(next, { reslot: true, hoursPerDayCap: hours });
    patchPlan(immediate);

    void (async () => {
      await refreshDayRouteAndMetrics(immediate, fromDayIdx, false);
      const afterFirst = useRoam.getState().plan;
      if (afterFirst) {
        await refreshDayRouteAndMetrics(afterFirst, toDayIdx, false);
      }
    })();
  };

  const shiftTrekRemainingToDay2 = (fromDayIdx: number, splitStopIdx: number): void => {
    if (!plan || !plan.days[fromDayIdx]) return;
    const next: TripPlan = structuredClone(plan);
    const fromDay = next.days[fromDayIdx];
    const movingStops = fromDay.stops.splice(splitStopIdx);
    if (movingStops.length === 0) return;

    const targetDayIdx = fromDayIdx + 1;
    if (!next.days[targetDayIdx]) {
      next.days.push({
        stops: [],
        totalHours: 0,
        walkKm: 0,
      });
    }
    next.days[targetDayIdx].stops.push(...movingStops);
    setDays(next.days.length);

    toast.success(`Moved ${movingStops.length} stops to Day ${targetDayIdx + 1} for post-trek rest!`);

    const immediate = recomputePlanMetrics(next, { reslot: true, hoursPerDayCap: hours });
    patchPlan(immediate);
    setDayIdx(targetDayIdx);

    void (async () => {
      await refreshDayRouteAndMetrics(immediate, fromDayIdx, false);
      const afterFirst = useRoam.getState().plan;
      if (afterFirst) {
        await refreshDayRouteAndMetrics(afterFirst, targetDayIdx, false);
      }
    })();
  };

  const handleTransportSwitch = (nextMode: TransportMode): void => {
    setTransportMode(nextMode);
    const next: TripPlan = structuredClone(plan);
    next.transportMode = nextMode;
    void refreshDayRouteAndMetrics(next, dayIdx, false);
  };

  const handleTimeModeSwitch = (nextTimeMode: TimeMode): void => {
    setTimeMode(nextTimeMode);
    const next: TripPlan = structuredClone(plan);
    next.timeMode = nextTimeMode;
    const recomputed = recomputePlanMetrics(next, { reslot: true, hoursPerDayCap: hours });
    patchPlan(recomputed);
  };

  const readAloud = (): void => {
    if (!("speechSynthesis" in window)) {
      toast.error("Speech synthesis isn't available in this browser — the text plan is right here.");
      return;
    }
    if (speakingRef.current) {
      speechSynthesis.cancel();
      speakingRef.current = false;
      return;
    }
    const u = new SpeechSynthesisUtterance(plan.voiceSummary);
    u.lang = lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-IN";
    u.onend = () => (speakingRef.current = false);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    speakingRef.current = true;
  };

  const share = async (): Promise<void> => {
    const url = `${window.location.origin}/?trip=${plan.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied");
    } catch {
      toast.message(url);
    }
    try {
      const QR = (await import("qrcode")).default;
      setQr(await QR.toDataURL(url, { width: 220, margin: 1 }));
    } catch {
      /* QR optional */
    }
  };

  const reactStop = (dIdx: number, sIdx: number, stopId: string, stopName: string, target: 1 | -1): void => {
    const current = reactions[stopId] ?? 0;
    const nextVal: 1 | -1 | 0 = current === target ? 0 : target;
    setReactions((r) => ({ ...r, [stopId]: nextVal }));

    // Update stop locked state in place without triggering OSRM / layout recalculation
    const next: TripPlan = structuredClone(plan);
    const stop = next.days[dIdx]?.stops[sIdx];
    if (stop) {
      stop.locked = nextVal === 1;
      patchPlan(next);
    }

    if (nextVal === 1) {
      toast.success(`👍 Kept "${stopName}" — locked for Re-plan`);
    } else if (nextVal === -1) {
      toast.message(`👎 Marked "${stopName}" to swap — click Re-plan below to replace`);
    }

    if (nextVal !== 0) {
      void fetch(`/api/trip/${plan.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopName, delta: nextVal }),
      }).catch(() => undefined);
    }
  };

  const replanControlsJSX = (
    <div className="clay-raised space-y-3 sm:space-y-4 p-3 sm:p-4 no-print">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-muted-foreground">Travel Time Schedule:</span>
        <div className="flex gap-1.5">
          <button
            onClick={() => handleTimeModeSwitch("recommended")}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all",
              timeMode === "recommended"
                ? "bg-accent text-white shadow-sm"
                : "bg-surface text-muted-foreground hover:text-foreground",
            )}
          >
            <Sparkles size={12} /> Engine Recommended ({day.totalHours} h)
          </button>
          <button
            onClick={() => handleTimeModeSwitch("capped")}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all",
              timeMode === "capped"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-surface text-muted-foreground hover:text-foreground",
            )}
          >
            <Clock size={12} /> Cap Hours / Day
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        {timeMode === "capped" && (
          <Slider
            label="Hours / day"
            min={2}
            max={15}
            value={hours}
            onChange={setHours}
            format={(v) => `${v} h`}
          />
        )}
        <Slider label="Days" min={1} max={7} value={days} onChange={setDays} />
        <Button variant="primary" onClick={() => triggerRouteCalculation()}>
          🔄 {t("plan.replan")}
        </Button>
      </div>

      {/* Traveler Persona & Accessibility */}
      <div className="space-y-2 pt-2 border-t border-border/40">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-muted-foreground">Traveler Persona:</span>
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer text-foreground">
            <input
              type="checkbox"
              checked={accessibleOnly}
              onChange={(e) => {
                setAccessibleOnly(e.target.checked);
                triggerRouteCalculation({ accessibleOnly: e.target.checked });
              }}
              className="rounded border-border text-primary accent-primary"
            />
            <span>♿ Wheelchair Accessible</span>
          </label>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {(
            [
              { id: "solo", label: "🎒 Solo", desc: "Hidden gems & culture" },
              { id: "couple", label: "👫 Couple", desc: "Golden hour & cafes" },
              { id: "family", label: "👨‍👩‍👧 Family", desc: "Kid safe & relaxed" },
              { id: "group", label: "👥 Group", desc: "Food & energy" },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPersona(p.id);
                triggerRouteCalculation({ persona: p.id });
              }}
              className={cn(
                "flex flex-col items-center justify-center p-2 rounded-xl text-center transition-all border",
                persona === p.id
                  ? "bg-primary/15 border-primary/40 font-bold text-foreground shadow-sm"
                  : "bg-surface border-transparent text-muted-foreground hover:bg-surface/80",
              )}
            >
              <span className="text-xs">{p.label}</span>
              <span className="text-[9px] text-muted-foreground">{p.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1 border-t border-border/40">
        <Button onClick={readAloud}>
          <Volume2 size={15} /> {t("plan.readAloud")}
        </Button>
        <Button onClick={() => download(`${plan.city}-roam-plan.ics`, icsForPlan(plan), "text/calendar")}>
          <Download size={15} /> .ics
        </Button>
        <Button onClick={() => download(`${plan.city}-roam-plan.txt`, planToText(plan), "text/plain")}>
          <Download size={15} /> .txt
        </Button>
        <Button onClick={() => window.print()}>
          <Printer size={15} /> Print / PDF
        </Button>
        <Button onClick={share}>
          <Share2 size={15} /> {t("plan.share")}
        </Button>
        {qr && (
          <span className="clay-raised-sm inline-flex items-center gap-2 p-2">
            <QrCode size={14} className="text-primary" />
            <img src={qr} alt="Trip QR code" width={72} height={72} className="rounded-lg" />
          </span>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MapPin size={11} /> Legs use OSRM {transportMode === "drive" ? "driving" : "walking"} routes (2-opt shortest path).{" "}
        {plan.budgetBand && plan.budgetBand.pricedCount > 0
          ? `Estimated spend ₹${Intl.NumberFormat("en-IN").format(plan.budgetBand.min)}–₹${Intl.NumberFormat("en-IN").format(plan.budgetBand.max)} per person (${plan.budgetBand.pricedCount}/${plan.budgetBand.totalStops} priced).`
          : "Stop prices vary — no fabricated estimates."}
      </p>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="plan-title"
      side
      maximized={isMaximized}
      onToggleMaximize={() => setIsMaximized((v) => !v)}
    >
      <div className="thin-scroll flex h-full flex-col overflow-y-auto print-plan">
        <div className="sticky top-0 z-10 bg-card/95 px-4 sm:px-5 pb-3 pt-4 sm:pt-5 backdrop-blur border-b border-border/40">
          <div className="flex items-center justify-between gap-2">
            <h2 id="plan-title" className="text-xl font-bold truncate">
              🗓️ {t("plan.title")} — {plan.cityLabel.split(",")[0]}
            </h2>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => handleTransportSwitch("walk")}
                className={cn(
                  "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold transition-all",
                  transportMode === "walk" ? "bg-primary text-primary-foreground shadow-sm" : "bg-surface text-muted-foreground",
                )}
                title="Walking OSRM route"
              >
                <Footprints size={12} /> Walk
              </button>
              <button
                onClick={() => handleTransportSwitch("drive")}
                className={cn(
                  "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold transition-all",
                  transportMode === "drive" ? "bg-primary text-primary-foreground shadow-sm" : "bg-surface text-muted-foreground",
                )}
                title="Driving / Auto OSRM route"
              >
                <Car size={12} /> Drive
              </button>
            </div>
          </div>

          <div
            className={cn(
              "mt-2 rounded-xl px-3.5 py-2 text-[12px] font-medium",
              plan.feasibility.ok ? "bg-accent/12 text-accent" : "bg-gold/15 text-gold",
            )}
            role="status"
          >
            {plan.feasibility.ok ? "✓ " : "⚠️ "}
            {plan.feasibility.message}
          </div>

          {plan.budgetBand && (
            <div className="mt-2 rounded-xl bg-surface/80 p-2.5 text-[12px] text-muted-foreground border border-border/50 flex flex-wrap items-center justify-between gap-1">
              <span>
                <span className="font-bold text-foreground">
                  💰{" "}
                  {plan.budgetBand.pricedCount > 0
                    ? plan.budgetBand.min === plan.budgetBand.max
                      ? `₹${Intl.NumberFormat("en-IN").format(plan.budgetBand.min)}`
                      : `₹${Intl.NumberFormat("en-IN").format(plan.budgetBand.min)}–₹${Intl.NumberFormat("en-IN").format(plan.budgetBand.max)}`
                    : "Varies"}
                </span>{" "}
                band · {plan.budgetBand.pricedCount} of {plan.budgetBand.totalStops} stops priced ({plan.budgetBand.note})
              </span>
            </div>
          )}

          {/* Dynamic Weather Circumstance Alert Banner & Late Running Adjuster */}
          {plan.weatherAlert ? (
            <div className="mt-2.5 rounded-xl bg-sky-500/15 border border-sky-500/40 p-2.5 text-xs text-sky-900 dark:text-sky-200 flex items-center justify-between gap-2">
              <span className="font-medium">{plan.weatherAlert}</span>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider bg-sky-500/20 px-2 py-0.5 rounded-full">
                Adapted
              </span>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleWeatherAdapt("rain")}
                disabled={adaptingWeather}
                className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1"
                title="Automatically swap outdoor trails for covered venues if rain occurs"
              >
                <span>🌧️ {adaptingWeather ? "Adapting..." : "Adapt for Rain (Swap to Indoor)"}</span>
              </button>
              <button
                type="button"
                onClick={() => handleRunningLate(60)}
                disabled={trimmingLate}
                className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
                title="Running 1 hour behind schedule? Auto-trim non-meal stop to catch up"
              >
                <span>⏰ {trimmingLate ? "Trimming..." : "Running 1h Late"}</span>
              </button>
            </div>
          )}

          {/* Emotion-aware Trek Fatigue Alert Banner */}
          {day.highExertionTrekDetected && (day.remainingStopsAfterTrekCount ?? 0) > 0 && (
            <div className="mt-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-2">
              <div className="flex items-start gap-2.5">
                <span className="text-lg leading-none">⚡</span>
                <div className="flex-1">
                  <p className="font-bold text-amber-900 dark:text-amber-200">
                    Strenuous trek detected: {day.exertionStopName}
                  </p>
                  <p className="mt-0.5 text-muted-foreground text-[11px] leading-relaxed">
                    Fort climbs and rugged trails take immense stamina. We added a 45-min recovery &amp; chai buffer.
                    Feeling tired after the ascent?
                  </p>
                </div>
              </div>
              <button
                onClick={() => shiftTrekRemainingToDay2(dayIdx, (day.exertionStopIndex ?? 0) + 1)}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 text-xs shadow-sm transition-colors active:scale-95"
              >
                <span>🌙 Shift remaining {day.remainingStopsAfterTrekCount} stops to Day {dayIdx + 2}</span>
              </button>
            </div>
          )}

          {/* Multi-stop Route Action Bar */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {fullDayGmapsUrl && (
              <a
                href={fullDayGmapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground shadow-sm hover:opacity-95"
                title="Open full multi-stop day route in Google Maps"
              >
                <Navigation size={12} />
                <span>Open Full Route in Google Maps</span>
                <ExternalLink size={10} />
              </a>
            )}
            <button
              onClick={() => setShowRouteMap((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-bold",
                showRouteMap ? "clay-pressed text-primary" : "clay-raised-sm text-muted-foreground",
              )}
            >
              <MapIcon size={12} /> {showRouteMap ? "Hide Route Map" : "Show Route Map"}
            </button>
            {onViewOnMap && (
              <button
                onClick={() => {
                  onClose();
                  onViewOnMap();
                }}
                className="clay-raised-sm inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-bold text-foreground hover:text-primary"
              >
                <Compass size={12} /> Full Map
              </button>
            )}
            <button
              onClick={() => setShowPlaceSelector((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-bold",
                showPlaceSelector ? "bg-accent text-white" : "clay-raised-sm text-muted-foreground hover:text-foreground",
              )}
            >
              <ListChecks size={12} /> Select Places &amp; Anchor
            </button>
          </div>

          {/* Meal Anchors Selector */}
          <div className="mt-2 rounded-xl border border-border/50 bg-surface/70 p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                🍽️ Meal Stops En Route
              </span>
              <span className="text-[10px] text-muted-foreground">Auto-slots authentic local food</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const nextVal = !includeBreakfast;
                  setIncludeBreakfast(nextVal);
                  triggerRouteCalculation({ includeBreakfast: nextVal });
                }}
                className={cn(
                  "flex flex-col items-center justify-center p-1.5 rounded-xl text-center border transition-all text-xs",
                  includeBreakfast
                    ? "bg-amber-500/15 border-amber-500/40 text-foreground font-bold shadow-sm"
                    : "bg-surface border-transparent text-muted-foreground hover:bg-surface/80",
                )}
              >
                <span className="text-sm">🌅</span>
                <span className="text-[11px] mt-0.5">Breakfast</span>
                <span className="text-[9px] text-muted-foreground">~8:30 AM</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextVal = !includeLunch;
                  setIncludeLunch(nextVal);
                  triggerRouteCalculation({ includeLunch: nextVal });
                }}
                className={cn(
                  "flex flex-col items-center justify-center p-1.5 rounded-xl text-center border transition-all text-xs",
                  includeLunch
                    ? "bg-orange-500/15 border-orange-500/40 text-foreground font-bold shadow-sm"
                    : "bg-surface border-transparent text-muted-foreground hover:bg-surface/80",
                )}
              >
                <span className="text-sm">🍛</span>
                <span className="text-[11px] mt-0.5">Lunch</span>
                <span className="text-[9px] text-muted-foreground">~1:00 PM</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextVal = !includeDinner;
                  setIncludeDinner(nextVal);
                  triggerRouteCalculation({ includeDinner: nextVal });
                }}
                className={cn(
                  "flex flex-col items-center justify-center p-1.5 rounded-xl text-center border transition-all text-xs",
                  includeDinner
                    ? "bg-red-500/15 border-red-500/40 text-foreground font-bold shadow-sm"
                    : "bg-surface border-transparent text-muted-foreground hover:bg-surface/80",
                )}
              >
                <span className="text-sm">🍽️</span>
                <span className="text-[11px] mt-0.5">Dinner</span>
                <span className="text-[9px] text-muted-foreground">~8:00 PM</span>
              </button>
            </div>
          </div>

          {/* visited progress */}
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={SPRING}
              />
            </div>
            <span className="text-[11px] font-bold text-muted-foreground">
              {visitedCount}/{allStops.length} visited
            </span>
          </div>
        </div>

        <div
          className={cn(
            "px-4 sm:px-5 pb-6 pt-3 space-y-3",
            isMaximized && "lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start lg:space-y-0",
          )}
        >
          {/* Left Column in maximized mode */}
          <div className={cn(isMaximized ? "lg:col-span-5 space-y-3.5 lg:sticky lg:top-2" : "space-y-3")}>
            {/* Embedded Interactive Route Map Preview with Numbered Stop Pins */}
            {showRouteMap && day.stops.length > 0 && (
              <div className="space-y-1.5">
                <EmbeddedRouteMap
                  places={[]}
                  center={{
                    lat: day.stops[0]?.lat ?? plan.lat ?? 19.2437,
                    lon: day.stops[0]?.lon ?? plan.lon ?? 73.1355,
                  }}
                  onSelect={onOpenPlace}
                  planStops={day.stops}
                  startAnchor={plan.startAnchor ?? null}
                  fitRouteBounds
                  compact
                  savedIds={savedIds}
                  height={isMaximized ? "320px" : "230px"}
                />
                {plan.startAnchor && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <MapPin size={11} className="text-emerald-600 shrink-0" />
                    <span>
                      Route starts from <b>{plan.startAnchor.label}</b> → {day.stops.length} ordered stops (2-opt shortest path)
                    </span>
                  </p>
                )}
              </div>
            )}

          {/* Collapsible Place Selector & Category Filter & Start Anchor Builder */}
          {showPlaceSelector && (
            <div className="clay-raised p-3.5 space-y-3 border border-primary/25">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  Customize Places, Category &amp; Start Location
                </h3>
                <button
                  onClick={() => setShowPlaceSelector(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>

              {/* Strict Category Filter Pills */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-muted-foreground">
                    Categories (strict filter — only selected types will be routed):
                  </span>
                  {selectedCats.length > 0 && (
                    <button
                      onClick={() => setSelectedCats([])}
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      Reset to all
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((cat) => {
                    const active = selectedCats.includes(cat);
                    return (
                      <button
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[11px] font-bold transition-all",
                          active
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-surface text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {CATEGORY_EMOJI[cat]} {CATEGORY_LABEL[cat].split(" ")[0]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Start Anchor */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-muted-foreground">Start Route From:</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setAnchorType("city")}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-[11px] font-bold",
                      anchorType === "city" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground",
                    )}
                  >
                    📍 City Center
                  </button>
                  <button
                    onClick={handleUseGps}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-[11px] font-bold",
                      anchorType === "gps" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground",
                    )}
                  >
                    🛰️ My GPS Location
                  </button>
                  <button
                    onClick={() => setAnchorType("place")}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-[11px] font-bold",
                      anchorType === "place" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground",
                    )}
                  >
                    🏛️ Specific Landmark
                  </button>
                </div>
                {anchorType === "place" && (
                  <select
                    value={anchorPlaceId}
                    onChange={(e) => setAnchorPlaceId(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold"
                  >
                    <option value="">Choose Stop #1 landmark…</option>
                    {candidatePlaces.slice(0, 60).map((p) => (
                      <option key={p.id} value={p.id}>
                        {CATEGORY_EMOJI[p.category]} {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Candidate Places Checklist */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-muted-foreground">
                    Check Places to Include ({selectedPlaceIds.length} selected of {candidatePlaces.length}):
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setHasCustomPlaceSelection(true);
                        setSelectedPlaceIds(candidatePlaces.slice(0, 6).map((p) => p.id));
                      }}
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      Top 6
                    </button>
                    <button
                      onClick={() => {
                        setHasCustomPlaceSelection(false);
                        setSelectedPlaceIds([]);
                      }}
                      className="text-[11px] font-semibold text-muted-foreground hover:underline"
                    >
                      Auto-pick best
                    </button>
                  </div>
                </div>
                <div className="thin-scroll max-h-44 overflow-y-auto space-y-1 rounded-xl bg-surface/60 p-2">
                  {candidatePlaces.slice(0, 45).map((p) => {
                    const checked = selectedPlaceIds.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs cursor-pointer",
                          checked ? "bg-primary/15 font-bold text-foreground" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCandidatePlace(p.id)}
                            className="accent-primary"
                          />
                          <span className="truncate">
                            {CATEGORY_EMOJI[p.category]} {p.name}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px]">
                          {p.priceHint
                            ? p.priceHint.min === 0 && p.priceHint.max === 0
                              ? "Free"
                              : `₹${p.priceHint.min}`
                            : p.category === "nature"
                              ? "Free"
                              : p.category === "food"
                                ? "₹150–350"
                                : p.category === "culture"
                                  ? "₹20–50"
                                  : "Varies"}{" "}
                          · {p.durationMinutes}m
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <Button
                variant="primary"
                className="w-full justify-center font-bold"
                onClick={() => {
                  setShowPlaceSelector(false);
                  triggerRouteCalculation({ forceUseSelectedIds: true });
                }}
              >
                🔄 Calculate Route for Selected Places
              </Button>
            </div>
          )}

          {isMaximized && replanControlsJSX}
        </div>

        {/* Right Column in maximized mode, or main flow */}
        <div className={cn(isMaximized ? "lg:col-span-7 space-y-3.5" : "space-y-3")}>
          {/* Day tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {plan.days.map((_, i) => (
              <button
                key={i}
                onClick={() => setDayIdx(i)}
                className={cn(
                  "rounded-full px-4 h-9 text-[13px] font-bold transition-all",
                  i === dayIdx ? "clay-primary clay-primary-pressed" : "clay-raised-sm",
                )}
              >
                Day {i + 1}
              </button>
            ))}
          </div>

          {/* Active Category Filter Quick Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <span className="text-[11px] font-bold text-muted-foreground shrink-0">Category Route:</span>
            <button
              onClick={() => {
                setSelectedCats([]);
                triggerRouteCalculation({ interests: undefined, selectedPlaceIds: undefined });
              }}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-bold shrink-0",
                selectedCats.length === 0
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "clay-raised-sm text-muted-foreground hover:text-foreground",
              )}
            >
              All
            </button>
            {CATEGORIES.map((cat) => {
              const isOnly = selectedCats.length === 1 && selectedCats[0] === cat;
              return (
                <button
                  key={cat}
                  onClick={() => {
                    const nextCats: Category[] = isOnly ? [] : [cat];
                    setSelectedCats(nextCats);
                    setSelectedPlaceIds([]);
                    triggerRouteCalculation({
                      interests: nextCats.length ? nextCats : undefined,
                      selectedPlaceIds: [],
                    });
                  }}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-bold transition-all shrink-0",
                    selectedCats.includes(cat)
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "clay-raised-sm text-muted-foreground hover:text-foreground",
                  )}
                >
                  {CATEGORY_EMOJI[cat]} {CATEGORY_LABEL[cat].split(" ")[0]}
                </button>
              );
            })}
          </div>

          {/* Day Summary Line */}
          <p className="text-[12px] text-muted-foreground flex flex-wrap items-center gap-1.5">
            <span>
              <b>Day {dayIdx + 1}:</b> {day.totalHours} h total · ~{day.walkKm ?? 0} km{" "}
              {transportMode === "drive" ? "driving" : "walking"} · {day.stops.length} stops
            </span>
            <span className="text-[11px] text-primary/80">
              (Tip: click any travel time or duration badge below to customize minutes)
            </span>
          </p>

          {/* Stops Timeline */}
          <ol className="space-y-2.5">
            {day.stops.map((s, sIdx) => (
              <motion.li
                key={`${s.experienceId}-${sIdx}`}
                layout
                transition={SPRING}
                className={cn("clay-raised-sm p-3.5", s.visited && "opacity-70")}
              >
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center gap-1.5 mt-0.5 shrink-0">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-extrabold text-primary-foreground shadow-sm">
                      {sIdx + 1}
                    </span>
                    <button
                      onClick={() => mutateStop(dayIdx, sIdx, { visited: !s.visited })}
                      aria-label={s.visited ? "Mark unvisited" : "Mark visited"}
                      className="text-accent"
                    >
                      {s.visited ? <CheckCircle2 size={18} className="fill-accent/20" /> : <Circle size={18} />}
                    </button>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[11px] font-bold text-primary">
                        {s.slotStart}–{s.slotEnd}
                      </p>
                      {s.timeOfDay && TIME_BADGES[s.timeOfDay] && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                            TIME_BADGES[s.timeOfDay].bg,
                          )}
                        >
                          <span>{TIME_BADGES[s.timeOfDay].icon}</span>
                          <span>{TIME_BADGES[s.timeOfDay].label}</span>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingStopIdx(editingStopIdx === sIdx ? null : sIdx)}
                        className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-primary"
                        title="Click to adjust travel time or visit duration"
                      >
                        {transportMode === "drive" ? "🚗" : "🚶"} {s.travelMinFromPrev}m leg
                        {s.legKmFromPrev ? ` (${s.legKmFromPrev} km)` : ""} · ⏱️ {s.durationMinutes}m stay ✎
                      </button>
                    </div>

                    {/* Inline Travel Time & Visit Duration Editor */}
                    {editingStopIdx === sIdx && (
                      <div className="mt-2 rounded-xl bg-surface/90 p-2.5 border border-border/60 flex flex-wrap items-center gap-3 text-xs">
                        <label className="flex items-center gap-1.5 font-semibold">
                          <span>{transportMode === "drive" ? "🚗 Leg travel (min):" : "🚶 Leg walk (min):"}</span>
                          <input
                            type="number"
                            min={0}
                            max={240}
                            value={s.travelMinFromPrev}
                            onChange={(e) =>
                              mutateStop(dayIdx, sIdx, {
                                travelMinFromPrev: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="w-16 rounded-lg border border-border bg-card px-2 py-0.5 text-center font-bold"
                          />
                        </label>
                        <label className="flex items-center gap-1.5 font-semibold">
                          <span>⏱️ Stay duration (min):</span>
                          <input
                            type="number"
                            min={10}
                            max={480}
                            step={5}
                            value={s.durationMinutes}
                            onChange={(e) =>
                              mutateStop(dayIdx, sIdx, {
                                durationMinutes: Math.max(10, Number(e.target.value) || 30),
                              })
                            }
                            className="w-16 rounded-lg border border-border bg-card px-2 py-0.5 text-center font-bold"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setEditingStopIdx(null)}
                          className="ml-auto text-[11px] font-bold text-primary hover:underline"
                        >
                          Done
                        </button>
                      </div>
                    )}

                    <div className="mt-1.5 flex items-start gap-2.5">
                      {s.imageUrl && (
                        <img
                          src={s.imageUrl}
                          alt={s.name}
                          className="h-11 w-11 rounded-lg object-cover shrink-0 border border-border/40"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <button
                          onClick={() => {
                            const existing = places.find((p) => p.id === s.experienceId);
                            if (existing) {
                              onOpenPlace(existing);
                              return;
                            }
                            const exp: Experience = {
                              id: s.experienceId,
                              name: s.name.replace(/ \(lunch anchor\)$/, ""),
                              category: s.category,
                              source: "plan",
                              sources: [],
                              address: "Not listed",
                              popularity: "",
                              popularityScore: 0,
                              community: { mentions: 0, upvotes: 0, sentiment: 0, quotes: [] },
                              durationMinutes: s.durationMinutes,
                              bookingRequired: false,
                              tags: [],
                              amenities: [],
                              lat: s.lat,
                              lon: s.lon,
                              imageUrl: s.imageUrl,
                              pricePerPerson: s.pricePerPerson,
                              gmapsDirectionsUrl: s.gmapsDirectionsUrl,
                            };
                            onOpenPlace(exp);
                          }}
                          className="block text-left font-bold leading-snug hover:text-primary"
                        >
                          {CATEGORY_EMOJI[s.category]} {s.name}
                        </button>
                        {s.note && <p className="mt-0.5 text-[12px] text-muted-foreground">{s.note}</p>}
                      </div>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold",
                          !s.priceBasis || s.priceBasis.includes("Varies")
                            ? "bg-surface text-muted-foreground"
                            : "bg-primary/10 text-primary",
                        )}
                        title={s.priceQuote ?? s.priceBasis}
                      >
                        🏷️ {s.priceBasis ?? (s.pricePerPerson !== undefined ? `~₹${s.pricePerPerson} pp` : "Varies on site")}
                      </span>
                      {s.isHighExertion && (
                        <span
                          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/25"
                          title="Strenuous trek/climb: 45-min recovery buffer added after this stop"
                        >
                          ⚡ Trek (+45m rest)
                        </span>
                      )}
                      {s.lat !== undefined && s.lon !== undefined && (
                        <a
                          href={
                            s.gmapsDirectionsUrl ??
                            `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-[11px] font-semibold text-primary hover:underline"
                          title="Open leg directions in Google Maps"
                        >
                          <Navigation size={10} />
                          <span>Leg Directions</span>
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <div className="flex gap-1">
                      <button
                        onClick={() => mutateStop(dayIdx, sIdx, {}, -1)}
                        disabled={sIdx === 0}
                        aria-label="Move up"
                        className="clay-raised-sm flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-40"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        onClick={() => mutateStop(dayIdx, sIdx, {}, 1)}
                        disabled={sIdx === day.stops.length - 1}
                        aria-label="Move down"
                        className="clay-raised-sm flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-40"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => reactStop(dayIdx, sIdx, s.experienceId, s.name, 1)}
                        aria-label={`Keep ${s.name}`}
                        title="Like & keep this stop when you Re-plan"
                        className={cn(
                          "flex h-7 items-center gap-0.5 rounded-lg px-1.5 text-[11px] font-bold transition-colors",
                          reactions[s.experienceId] === 1 || s.locked
                            ? "bg-accent text-white shadow-sm"
                            : "clay-raised-sm text-accent hover:bg-accent/10",
                        )}
                      >
                        <ThumbsUp size={12} />
                        {reactions[s.experienceId] === 1 ? "Keep" : ""}
                      </button>
                      <button
                        onClick={() => reactStop(dayIdx, sIdx, s.experienceId, s.name, -1)}
                        aria-label={`Swap ${s.name} on Re-plan`}
                        title="Dislike — mark to swap out when you click Re-plan"
                        className={cn(
                          "flex h-7 items-center gap-0.5 rounded-lg px-1.5 text-[11px] font-bold transition-colors",
                          reactions[s.experienceId] === -1
                            ? "bg-red-500 text-white shadow-sm"
                            : "clay-raised-sm text-muted-foreground hover:text-red-500",
                        )}
                      >
                        <ThumbsDown size={12} />
                        {reactions[s.experienceId] === -1 ? "Swap" : ""}
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => mutateStop(dayIdx, sIdx, { locked: !s.locked })}
                        aria-label={s.locked ? "Unlock stop" : "Lock stop on re-plan"}
                        className={cn(
                          "clay-raised-sm flex h-7 w-7 items-center justify-center rounded-lg",
                          s.locked && "clay-pressed text-primary",
                        )}
                      >
                        {s.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                      </button>
                      <button
                        onClick={() => removeStop(dayIdx, sIdx)}
                        aria-label={`Remove ${s.name}`}
                        className="clay-raised-sm flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-red-400"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenAlternatives(s)}
                      title="Activity closed or unavailable? Choose a smart substitute"
                      className="clay-raised-sm flex h-6 w-full items-center justify-center gap-1 rounded-md text-[10px] font-bold text-primary hover:bg-primary/10 transition-colors"
                    >
                      <span>🔄 Alt</span>
                    </button>
                    {plan.days.length > 1 && (
                      <div className="w-full">
                        <select
                          value={dayIdx}
                          onChange={(e) => moveStopToDay(dayIdx, Number(e.target.value), sIdx)}
                          aria-label={`Move ${s.name} to another day`}
                          title="Move to another day"
                          className="h-6 w-full rounded-md border border-border/60 bg-surface px-1 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:border-primary cursor-pointer text-center"
                        >
                          {plan.days.map((_, i) => (
                            <option key={i} value={i}>
                              {i === dayIdx ? `Day ${i + 1}` : `→ Day ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </motion.li>
            ))}
            {day.stops.length === 0 && (
              <li className="clay-raised-sm p-4 text-sm text-muted-foreground">
                No stops in this day — open &ldquo;Select Places &amp; Anchor&rdquo; or click Re-plan below.
              </li>
            )}
          </ol>

          {/* Replan & Export controls for compact side drawer mode */}
          {!isMaximized && replanControlsJSX}
        </div>
        </div>
      </div>

      {/* Instant Substitute Modal */}
      {selectedAltStop && (
        <Modal
          open={!!selectedAltStop}
          onClose={() => setSelectedAltStop(null)}
          labelledBy="alt-substitute-title"
        >
          <div className="flex flex-col gap-3 p-1 max-w-lg mx-auto text-xs">
            <h3 id="alt-substitute-title" className="font-bold text-base text-foreground">
              🔄 Find Substitute for {selectedAltStop.name}
            </h3>
            <p className="text-muted-foreground text-[11px]">
              If <strong>{selectedAltStop.name}</strong> is closed, crowded, or unavailable, choose a nearby substitute matching the same category &amp; vicinity:
            </p>
            <div className="flex flex-col gap-2 max-h-80 overflow-y-auto thin-scroll">
              {altCandidates.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center">No immediate alternatives found nearby.</p>
              ) : (
                altCandidates.map((alt) => (
                  <div
                    key={alt.id}
                    className="clay-raised-sm rounded-xl p-3 flex items-center justify-between gap-3 border border-border/50 hover:border-primary/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-foreground text-xs truncate">
                        {CATEGORY_EMOJI[alt.category]} {alt.name}
                      </h4>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                        {alt.description || alt.address}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                        <span>⏱️ {alt.durationMinutes}m</span>
                        <span>·</span>
                        <span>{alt.pricePerPerson !== undefined ? `~₹${alt.pricePerPerson} pp` : "Varies on site"}</span>
                        {alt.community.hiddenGem && <span className="text-emerald-600 font-semibold">🌿 gem</span>}
                      </div>
                    </div>
                    <Button size="sm" variant="primary" onClick={() => handleSwapWithAlternative(alt)}>
                      Swap In
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end pt-1">
              <Button variant="default" onClick={() => setSelectedAltStop(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
