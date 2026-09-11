"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Heart, Navigation, Scale } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { openNowFromHours } from "@/lib/pipeline";
import type { Experience, Filters } from "@/lib/types";
import { haversineKm } from "@/lib/net";
import { translate, type DictKey } from "@/lib/i18n";
import { useRoam } from "@/lib/store";
import { CATEGORY_LABEL, CATEGORY_EMOJI } from "@/lib/catalog";
import { HeatStrip, Sparkline, cn, SPRING } from "./ui";

export { CATEGORY_EMOJI };

// ─── Pure filter/sort (reused by compare + pulse click-through) ──────────────
export function applyFilters(
  places: Experience[],
  f: Filters,
  saved: string[],
  userLoc?: { lat: number; lon: number } | null,
): Experience[] {
  const q = f.q.trim().toLowerCase();
  let out = places.filter((p) => {
    if (q && !`${p.name} ${p.description ?? ""} ${p.tags.join(" ")} ${p.address}`.toLowerCase().includes(q)) return false;
    if (f.categories.length && !f.categories.includes(p.category)) return false;
    if (f.budget !== null && (p.pricePerPerson ?? 0) > f.budget) return false;
    if (f.duration === "short" && p.durationMinutes >= 60) return false;
    if (f.duration === "half" && (p.durationMinutes < 60 || p.durationMinutes > 180)) return false;
    if (f.duration === "long" && p.durationMinutes < 180) return false;
    if (f.timeOfDay !== "any") {
      const bt = (p.bestTime ?? "").toLowerCase();
      if (!bt.includes(f.timeOfDay === "night" ? "night" : f.timeOfDay)) return false;
    }
    if (f.hiddenGem && !p.community.hiddenGem) return false;
    if (f.savedOnly && !saved.includes(p.id)) return false;
    if (f.hideBooking && p.bookingRequired) return false;
    if (f.wheelchair && p.wheelchairAccessible !== true) return false;
    if (f.hasPhoto && !p.imageUrl) return false;
    if (f.priceConfirmed && (!p.priceHint || p.priceHint.confidence < 0.6)) return false;
    if (f.localLens && p.community.mentions === 0) return false;
    if (f.localLens && !p.sources.some((s) => s.source !== "OpenStreetMap" && s.source !== "Photon (OSM index)" && s.source !== "GeoNames")) return false;
    return true;
  });
  if (f.crowdWarning) {
    const warned = out.filter((p) => p.community.crowdWarning);
    out = warned.length ? warned : out;
  }
  const withOpen = out.map((p) => ({ p, open: openNowFromHours(p.openingHoursRaw) }));
  if (f.openNow) out = withOpen.filter((x) => x.open !== false).map((x) => x.p);
  const dist = (p: Experience): number =>
    userLoc && p.lat !== undefined && p.lon !== undefined
      ? haversineKm(userLoc.lat, userLoc.lon, p.lat, p.lon)
      : p.distanceKm ?? 999;
  const sorters: Record<Filters["sort"], (a: Experience, b: Experience) => number> = {
    smart: (a, b) => b.popularityScore * 0.6 + b.community.mentions * 0.01 - (a.popularityScore * 0.6 + a.community.mentions * 0.01),
    popularity: (a, b) => b.popularityScore - a.popularityScore || b.community.mentions - a.community.mentions,
    distance: (a, b) => dist(a) - dist(b),
    price_asc: (a, b) => (a.priceHint?.min ?? a.pricePerPerson ?? 9999) - (b.priceHint?.min ?? b.pricePerPerson ?? 9999),
    price_desc: (a, b) => (b.priceHint?.max ?? b.pricePerPerson ?? 0) - (a.priceHint?.max ?? a.pricePerPerson ?? 0),
    duration: (a, b) => a.durationMinutes - b.durationMinutes,
    sentiment: (a, b) => b.community.sentiment - a.community.sentiment || b.community.mentions - a.community.mentions,
  };
  return [...out].sort(sorters[f.sort]);
}

// ─── Live open dot — recompute every minute ─────────────────────────────────
export function useOpenNow(exp: Experience): { open: boolean | null; label: string } {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
  const open = useMemo(() => openNowFromHours(exp.openingHoursRaw), [exp.openingHoursRaw, tick]);
  return {
    open,
    label: open === null ? "hoursUnknown" : open ? "open" : "closed",
  };
}

function OpenDot({ exp }: { exp: Experience }) {
  const { open, label } = useOpenNow(exp);
  const lang = useRoam((s) => s.lang);
  const t = translate.bind(null, lang);
  const color = open === null ? "bg-muted-foreground/50" : open ? "bg-emerald-500" : "bg-red-400";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title={t(`card.${label}` as DictKey)}>
      <span className={cn("relative flex h-2 w-2")}>
        {open === true && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
      </span>
      {t(`card.${label}` as DictKey)}
    </span>
  );
}

function quoteSparkline(exp: Experience): number[] {
  const pts = exp.community.quotes.map((q) =>
    /\b(good|great|best|amazing|love|delicious|beautiful|worth)\b/i.test(q.text)
      ? 0.8
      : /\b(bad|worst|avoid|overrated|dirty|crowded|expensive)\b/i.test(q.text)
        ? -0.6
        : 0.1,
  );
  return pts.length >= 2 ? pts : [];
}

function crowdBars(exp: Experience): number {
  const crowd = exp.community.quotes.filter((q) => /crowded|queue|rush|packed|busy/i.test(q.text)).length;
  return Math.min(crowd, 3);
}

export function PlaceCard({
  exp,
  index,
  onOpen,
  distanceKm,
}: {
  exp: Experience;
  index: number;
  onOpen: (exp: Experience) => void;
  distanceKm?: number;
}) {
  const saved = useRoam((s) => s.saved.includes(exp.id));
  const toggleSaved = useRoam((s) => s.toggleSaved);
  const inCompare = useRoam((s) => s.compare.includes(exp.id));
  const toggleCompare = useRoam((s) => s.toggleCompare);
  const lang = useRoam((s) => s.lang);
  const t = (k: DictKey) => translate(lang, k);
  const spark = quoteSparkline(exp);
  const crowd = crowdBars(exp);

  return (
    <motion.article
      layout
      layoutId={`place-${exp.id}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ ...SPRING, delay: Math.min(index * 0.06, 0.5) }}
      whileHover={window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? undefined : { rotate: 0.4, y: -2 }}
      className="clay-raised clay-lift group relative flex cursor-pointer flex-col overflow-hidden"
      onClick={() => onOpen(exp)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(exp);
      }}
      aria-label={`${exp.name} — ${CATEGORY_LABEL[exp.category]}`}
    >
      {/* hero image or clay placeholder */}
      <div className="relative h-40 sm:h-36 w-full overflow-hidden bg-surface">
        {exp.imageUrl ? (
          <Image
            src={exp.imageUrl}
            alt={exp.name}
            fill
            sizes="(max-width: 768px) 100vw, 320px"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-5xl opacity-60 transition-transform duration-500 group-hover:scale-110">
            {CATEGORY_EMOJI[exp.category]}
          </div>
        )}
        <div className="absolute left-2.5 top-2.5 flex flex-wrap gap-1.5 max-w-[85%]">
          {exp.community.mentions >= 150 && <Badge tone="hot">🔥 {exp.community.mentions}+</Badge>}
          {exp.community.mentions > 0 && exp.community.mentions < 20 && <Badge tone="fresh">✨ fresh</Badge>}
          {exp.community.hiddenGem && <Badge tone="gem">🌿 hidden gem</Badge>}
          {exp.community.crowdWarning && <Badge tone="warn">⚠️ crowded</Badge>}
          {exp.bookingRequired && <Badge tone="book">🎟 book ahead</Badge>}
        </div>
        <div className="absolute right-2 top-2 flex gap-1.5">
          <motion.button
            whileTap={{ scale: 0.8 }}
            onClick={(e) => {
              e.stopPropagation();
              toggleSaved(exp.id);
            }}
            aria-label={saved ? t("card.saved") : t("card.save")}
            className={cn(
              "clay-raised-sm flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded-full",
              saved && "clay-pressed text-primary",
            )}
          >
            <motion.span key={String(saved)} initial={{ scale: saved ? 0.4 : 1 }} animate={{ scale: 1 }} transition={SPRING}>
              <Heart size={15} className={saved ? "fill-primary text-primary" : ""} />
            </motion.span>
          </motion.button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleCompare(exp.id);
            }}
            aria-label={`${t("card.compare")} ${exp.name}`}
            className={cn(
              "clay-raised-sm flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded-full",
              inCompare && "clay-pressed text-accent",
            )}
          >
            <Scale size={14} className={inCompare ? "text-accent" : ""} />
          </button>
          <a
            href={exp.gmapsDirectionsUrl ?? (exp.lat !== undefined && exp.lon !== undefined ? `https://www.google.com/maps/dir/?api=1&destination=${exp.lat},${exp.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(exp.name + ' ' + (exp.address || ''))}`)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Directions to ${exp.name}`}
            title="Directions on Google Maps"
            className="clay-raised-sm flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded-full text-foreground/80 hover:text-primary transition-colors"
          >
            <Navigation size={13} />
          </a>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold leading-snug line-clamp-2">{exp.name}</h3>
          <span className="shrink-0 text-[11px] rounded-full bg-surface px-2 py-0.5 text-muted-foreground font-semibold uppercase tracking-wide">
            {CATEGORY_LABEL[exp.category].split(" ")[0]}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <OpenDot exp={exp} />
          {distanceKm !== undefined && <span>· 📍 {distanceKm.toFixed(1)} km</span>}
          {exp.community.quotes.length > 0 && spark.length >= 2 && (
            <span className="ml-auto flex items-center gap-1" title="Community sentiment">
              <Sparkline points={spark} />
            </span>
          )}
        </div>

        {/* crowd 3-bar */}
        {crowd > 0 && (
          <div className="flex items-center gap-1.5" title="Crowd signal from community quotes">
            {[1, 2, 3].map((i) => (
              <div key={i} className={cn("h-1.5 w-5 rounded-full", i <= crowd ? "bg-gold" : "bg-surface")} />
            ))}
            <span className="text-[10px] text-muted-foreground">crowd signal</span>
          </div>
        )}

        <p className="text-[12px] text-muted-foreground line-clamp-2">{exp.popularity}</p>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1 border-t border-border/40">
          <PriceChip exp={exp} />
          <a
            href={exp.gmapsDirectionsUrl ?? (exp.lat !== undefined && exp.lon !== undefined ? `https://www.google.com/maps/dir/?api=1&destination=${exp.lat},${exp.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(exp.name + ' ' + (exp.address || ''))}`)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-primary hover:underline shrink-0"
            title="Directions on Google Maps"
          >
            <Navigation size={11} />
            <span>Directions</span>
          </a>
        </div>
      </div>
    </motion.article>
  );
}

export function PriceChip({ exp }: { exp: Experience }) {
  const hint = exp.priceHint;
  if (!hint && (exp.pricePerPerson === undefined || exp.pricePerPerson === null)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium" title="No reliable price signal found yet">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/35 shrink-0" />
        <span className="truncate">Varies — no reliable signal</span>
      </span>
    );
  }

  const fmt = (v: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(v / 10) * 10);

  let label = "";
  if (hint) {
    if (hint.min === 0 && hint.max === 0) {
      label = "Free entry";
    } else if (hint.min === hint.max) {
      label = `${fmt(hint.min)} · ${hint.mode}`;
    } else {
      label = `${fmt(hint.min)}–${fmt(hint.max).replace("₹", "")} · ${hint.mode}`;
    }
    if (hint.samples && hint.samples.length > 0) {
      label += ` · ${hint.samples.length} mention${hint.samples.length > 1 ? "s" : ""}`;
    }
  } else if (exp.pricePerPerson === 0) {
    label = "Free entry";
  } else {
    label = `${fmt(exp.pricePerPerson ?? 0)} · est.`;
  }

  const conf = hint?.confidence ?? (exp.priceIsEstimate ? 0.4 : 0.8);
  const dotColor = conf >= 0.7 ? "bg-emerald-500" : conf >= 0.3 ? "bg-amber-500" : "bg-muted-foreground/40";

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/90 max-w-[190px] sm:max-w-[210px] truncate"
      title={hint?.samples?.[0]?.raw_snippet ?? label}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dotColor)} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "hot" | "fresh" | "gem" | "warn" | "book" | "web" }) {
  const tones = {
    hot: "bg-primary/15 text-primary",
    fresh: "bg-accent/15 text-accent",
    gem: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    warn: "bg-gold/20 text-gold",
    book: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    web: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  } as const;
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur-sm", tones[tone])}>{children}</span>;
}

const GRID_PAGE = 48; // big cities return 900+ places — render progressively

export function PlaceGrid({
  places,
  userLoc,
  onOpen,
  emptyMessage,
}: {
  places: Experience[];
  userLoc?: { lat: number; lon: number } | null;
  onOpen: (exp: Experience) => void;
  emptyMessage?: string;
}) {
  const [visible, setVisible] = useState(GRID_PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [prevPlaces, setPrevPlaces] = useState(places);

  // new result set (city change, filters change) → back to the first page.
  // Render-time reset (React's documented pattern) — no effect, no flash.
  if (prevPlaces !== places) {
    setPrevPlaces(places);
    setVisible(GRID_PAGE);
  }

  useEffect(() => {
    if (visible >= places.length) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => Math.min(v + GRID_PAGE, places.length));
        }
      },
      { rootMargin: "800px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, places.length]);

  if (places.length === 0) {
    return (
      <div className="clay-raised mx-auto my-10 max-w-md p-8 text-center">
        <div className="text-4xl">🧭</div>
        <p className="mt-3 font-semibold">{emptyMessage ?? "No places match these filters"}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Widen the net — clear a filter, raise the budget, or switch neighborhoods.
        </p>
      </div>
    );
  }
  return (
    <motion.div layout className="grid grid-cols-1 gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-w-lg sm:max-w-none mx-auto sm:mx-0">
      <AnimatePresence mode="popLayout">
        {places.slice(0, visible).map((p, i) => (
          <PlaceCard
            key={p.id}
            exp={p}
            index={i}
            onOpen={onOpen}
            distanceKm={userLoc && p.lat !== undefined && p.lon !== undefined ? haversineKm(userLoc.lat, userLoc.lon, p.lat, p.lon) : undefined}
          />
        ))}
      </AnimatePresence>
      {visible < places.length && (
        <div
          ref={sentinelRef}
          className="col-span-full flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
          role="status"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading more places — {visible} of {places.length} shown
        </div>
      )}
    </motion.div>
  );
}

export function CardSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-w-lg sm:max-w-none mx-auto sm:mx-0" aria-busy="true" aria-live="polite">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="clay-raised overflow-hidden">
          <div className="skeleton-shimmer h-36 w-full" />
          <div className="space-y-2.5 p-4">
            <div className="skeleton-shimmer h-4 w-3/4" />
            <div className="skeleton-shimmer h-3 w-1/2" />
            <div className="skeleton-shimmer h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
