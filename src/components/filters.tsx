"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Compass,
  Crosshair,
  Hammer,
  Landmark,
  Locate,
  MoonStar,
  Mountain,
  Search,
  Sparkles,
  Store,
  Trees,
  UtensilsCrossed,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CATEGORIES, type Category, type Filters } from "@/lib/types";
import { translate, type DictKey } from "@/lib/i18n";
import { useRoam } from "@/lib/store";
import { CATEGORY_LABEL as CATALOG_LABEL } from "@/lib/catalog";
import { Button, Chip, Modal, Slider, Switch, cn } from "./ui";

export const CATEGORY_LABEL = CATALOG_LABEL;

const CATEGORY_ICONS: Record<Category, React.ReactNode> = {
  food: <UtensilsCrossed size={14} />,
  culture: <Landmark size={14} />,
  nature: <Trees size={14} />,
  market: <Store size={14} />,
  nightlife: <MoonStar size={14} />,
  adventure: <Mountain size={14} />,
  workshop: <Hammer size={14} />,
  hidden_gem: <Sparkles size={14} />,
};

export function FilterBar({
  city,
  cityLabel,
  filters,
  onFilters,
  onOpenCity,
}: {
  city: string;
  cityLabel: string;
  filters: Filters;
  onFilters: (f: Filters) => void;
  onOpenCity: () => void;
}) {
  const lang = useRoam((s) => s.lang);
  const t = (k: DictKey) => translate(lang, k);
  const searchRef = useRef<HTMLInputElement>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = (patch: Partial<Filters>): Filters => ({ ...filters, ...patch });
  const localLens = set({ localLens: !filters.localLens });

  return (
    <div className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md no-print">
      <div className="mx-auto max-w-6xl px-3 sm:px-6 py-2.5 sm:py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <div className="clay-raised-sm relative flex h-10 w-full sm:w-auto min-w-0 sm:min-w-52 flex-1 items-center sm:max-w-sm">
            <Search size={15} className="ml-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={filters.q}
              onChange={(e) => onFilters(set({ q: e.target.value }))}
              placeholder={`${t("filters.search")}  ( / )`}
              aria-label={t("filters.search")}
              className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
            />
            {filters.q && (
              <button onClick={() => onFilters(set({ q: "" }))} className="mr-2 text-xs text-muted-foreground hover:text-foreground" aria-label="Clear search">
                ✕
              </button>
            )}
          </div>

          <Button variant="default" onClick={onOpenCity} aria-label={`${t("filters.city")}: ${cityLabel}`} className="max-w-56">
            <MapPinIcon />
            <span className="truncate">{cityLabel.split(",")[0]}</span>
          </Button>

          <select
            value={filters.sort}
            onChange={(e) => onFilters(set({ sort: e.target.value as Filters["sort"] }))}
            aria-label={t("filters.sort")}
            className="clay-raised-sm h-10 px-3 text-sm outline-none cursor-pointer"
          >
            <option value="smart">✨ Smart</option>
            <option value="popularity">🔥 Most loved</option>
            <option value="distance">📍 Nearest</option>
            <option value="price_asc">₹ Cheapest</option>
            <option value="price_desc">₹₹ Priciest</option>
            <option value="duration">⏱ Quickest</option>
            <option value="sentiment">💬 Best sentiment</option>
          </select>

          <Chip active={filters.localLens} onClick={() => onFilters(localLens)} title="Only places the community actually talks about">
            <Compass size={14} /> {t("filters.localLens")}
          </Chip>

          <Chip active={showAll} onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
            All filters {showAll ? "▲" : "▼"}
          </Chip>

          <Button variant="ghost" size="sm" onClick={() => onFilters({ ...DEFAULT_FILTERS })} aria-label={t("filters.reset")}>
            {t("filters.reset")}
          </Button>
        </div>

        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto hide-scrollbar scroll-fade pb-0.5" role="group" aria-label={t("filters.categories")}>
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              active={filters.categories.includes(c)}
              onClick={() =>
                onFilters(
                  set({
                    categories: filters.categories.includes(c)
                      ? filters.categories.filter((x) => x !== c)
                      : [...filters.categories, c],
                  }),
                )
              }
            >
              {CATEGORY_ICONS[c]}
              {CATEGORY_LABEL[c].split(" ")[0]}
            </Chip>
          ))}
        </div>

        <AnimatePresence>
          {showAll && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="clay-raised-sm p-3 sm:p-4 grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                <Slider
                  label={t("filters.budget")}
                  min={0}
                  max={2500}
                  step={50}
                  value={filters.budget ?? 0}
                  onChange={(v) => onFilters(set({ budget: v === 0 ? null : v }))}
                  format={(v) => (v === 0 ? "any" : `₹${v}`)}
                />
                <label className="flex flex-col gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                  Duration
                  <select
                    value={filters.duration}
                    onChange={(e) => onFilters(set({ duration: e.target.value as Filters["duration"] }))}
                    className="clay-raised-sm h-9 px-2 text-sm normal-case font-normal outline-none cursor-pointer"
                  >
                    <option value="any">Any length</option>
                    <option value="short">Under 1 hour</option>
                    <option value="half">1–3 hours</option>
                    <option value="long">3+ hours</option>
                  </select>
                </label>
                <div className="flex flex-col gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                  Time of day
                  <div className="flex flex-wrap gap-1.5 normal-case">
                    {(["any", "morning", "afternoon", "evening", "night"] as const).map((tod) => (
                      <Chip
                        key={tod}
                        active={filters.timeOfDay === tod}
                        className="h-8 text-xs"
                        onClick={() => onFilters(set({ timeOfDay: tod }))}
                      >
                        {tod === "any" ? "Any" : tod}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 text-sm normal-case">
                  {(
                    [
                      ["hasPhoto", "📷 Has real photo"],
                      ["priceConfirmed", "🏷️ Price confirmed"],
                      ["openNow", t("filters.openNow")],
                      ["hiddenGem", t("filters.hiddenGem")],
                      ["savedOnly", t("filters.savedOnly")],
                      ["crowdWarning", "⚠️ Crowd warnings"],
                      ["hideBooking", "Hide ticketed places"],
                      ["wheelchair", "♿ Wheelchair friendly"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-foreground/90">{label}</span>
                      <Switch checked={!!filters[key]} onChange={(v) => onFilters(set({ [key]: v }))} label={label} />
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function MapPinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export const DEFAULT_FILTERS: Filters = {
  q: "",
  categories: [],
  budget: null,
  duration: "any",
  timeOfDay: "any",
  openNow: false,
  hiddenGem: false,
  crowdWarning: false,
  savedOnly: false,
  hideBooking: false,
  wheelchair: false,
  sort: "smart",
  localLens: false,
  hasPhoto: false,
  priceConfirmed: false,
};

// ─── City dialog: autocomplete + popular chips + auto-locate ────────────────
interface Suggestion {
  label: string;
  city: string;
  lat: number;
  lon: number;
}

export function CityDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (city: string, label: string, lat?: number, lon?: number) => void;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const lang = useRoam((s) => s.lang);
  const t = (k: DictKey) => translate(lang, k);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 350);
    return () => clearTimeout(id);
  }, [q]);

  const suggestions = useQuery<Suggestion[]>({
    queryKey: ["city-suggest", debounced],
    queryFn: async () => {
      const res = await fetch(`/api/city-suggest?q=${encodeURIComponent(debounced)}`);
      const j = (await res.json()) as { suggestions?: Suggestion[] };
      return j.suggestions ?? [];
    },
    enabled: open && debounced.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
  });

  const autolocate = useQuery<{ city?: string; label?: string; lat?: number; lon?: number }>({
    queryKey: ["autolocate"],
    queryFn: async () => {
      const res = await fetch("/api/autolocate");
      return (await res.json()) as { city?: string; label?: string; lat?: number; lon?: number };
    },
    enabled: false,
    staleTime: Infinity,
  });

  return (
    <Modal open={open} onClose={onClose} labelledBy="city-dialog-title">
      <div className="p-5">
        <h2 id="city-dialog-title" className="text-lg font-bold">
          {t("filters.city")}
        </h2>
        <div className="clay-raised-sm mt-3 flex items-center gap-2 px-3.5 h-11">
          <Search size={15} className="text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a city — Kalyan, Pune, Varanasi…"
            className="h-full w-full bg-transparent text-sm outline-none"
            aria-label="City search"
          />
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              autolocate.refetch().then((r) => {
                const d = r.data;
                if (d?.city) onSelect(d.city, d.label ?? d.city, d.lat, d.lon);
              });
            }}
          >
            <Locate size={14} /> Detect my city (IP)
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (!("geolocation" in navigator)) return;
              navigator.geolocation.getCurrentPosition(
                (pos) => onSelect(`${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`, "My location", pos.coords.latitude, pos.coords.longitude),
                () => {
                  /* permission denied — text search still works */
                },
                { timeout: 8000 },
              );
            }}
          >
            <Crosshair size={14} /> Use GPS
          </Button>
        </div>

        {suggestions.isFetching && <p className="mt-3 text-xs text-muted-foreground">Searching…</p>}
        <ul className="mt-2 max-h-44 overflow-auto thin-scroll space-y-1" role="listbox">
          {(suggestions.data ?? []).map((s) => (
            <li key={`${s.label}-${s.lat}`}>
              <button
                onClick={() => onSelect(s.city, s.label, s.lat, s.lon)}
                className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-surface transition-colors"
              >
                <span className="font-medium">{s.city}</span>
                <span className="text-muted-foreground"> — {s.label.split(",").slice(1).join(",").trim() || s.label}</span>
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Popular</p>
        <div className="flex flex-wrap gap-1.5">
          {["Mumbai", "Pune", "Kalyan", "Thane", "Jaipur", "Varanasi", "Kochi", "Udaipur"].map((c) => (
            <Chip key={c} onClick={() => onSelect(c, `${c}, India`)}>
              {c}
            </Chip>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function categoryIcon(c: Category): React.ReactNode {
  return <span className={cn("inline-flex")}>{CATEGORY_ICONS[c]}</span>;
}
