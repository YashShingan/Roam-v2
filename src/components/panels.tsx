"use client";

import { useQuery } from "@tanstack/react-query";
import { motion, useScroll, useSpring } from "framer-motion";
import { Activity, Keyboard, WifiOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { HealthEntry } from "@/lib/rawhit";
import type { Experience } from "@/lib/types";
import { useRoam } from "@/lib/store";
import { toast } from "sonner";
import { liveMode, pollJob, probeBackend, startLiveScrape } from "@/lib/live-backend";
import { Button, Modal, cn } from "./ui";

// ─── Scroll progress bar ─────────────────────────────────────────────────────
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 26 });
  return <motion.div style={{ scaleX }} className="scroll-progress fixed inset-x-0 top-0 z-[60] h-1 origin-left no-print" aria-hidden />;
}

// ─── Offline banner + reconnect refetch ─────────────────────────────────────
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const on = (): void => setOffline(false);
    const off = (): void => setOffline(true);
    setOffline(!navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (!offline) return null;
  return (
    <motion.div
      initial={{ y: -40 }}
      animate={{ y: 0 }}
      className="fixed inset-x-0 top-4 z-[70] mx-auto flex w-max items-center gap-2 rounded-full bg-gold/90 px-4 py-2 text-[13px] font-bold text-black shadow-lg no-print"
      role="status"
    >
      <WifiOff size={14} /> You're offline — showing cached places. Reconnecting…
    </motion.div>
  );
}

// ─── Admin health drawer (H) ────────────────────────────────────────────────
export function HealthDrawer({
  open,
  onClose,
  city,
  onScraped,
}: {
  open: boolean;
  onClose: () => void;
  city?: string;
  onScraped?: () => void;
}) {
  const health = useQuery<{ collectors: HealthEntry[] }>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health/sources");
      if (!res.ok) throw new Error("health unavailable");
      return (await res.json()) as { collectors: HealthEntry[] };
    },
    enabled: open,
    refetchInterval: open ? 15000 : false,
  });
  const collectors = health.data?.collectors ?? [];
  return (
    <Modal open={open} onClose={onClose} labelledBy="health-title" wide>
      <div className="thin-scroll max-h-[92dvh] overflow-y-auto p-5">
        <h2 id="health-title" className="flex items-center gap-2 text-lg font-bold">
          <Activity size={18} className="text-accent" /> Source health
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Live status of the 13 keyless collectors. A red row means that API is down — Roam keeps working with the rest.
        </p>
        <div className="mt-4 space-y-2">
          {health.isLoading && <p className="text-sm text-muted-foreground">Reading gauges…</p>}
          {!health.isLoading && collectors.length === 0 && (
            <p className="text-sm text-muted-foreground">No run yet — search a city first to wake the collectors.</p>
          )}
          {collectors.map((h) => (
            <div key={h.name} className="clay-raised-sm flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3 px-3.5 sm:px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", h.ok ? "bg-emerald-500" : "bg-red-400")} />
                <span className="font-semibold truncate">{h.name}</span>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-muted-foreground pl-5 sm:pl-0">
                <span>{h.count} hits</span>
                <span>· {h.latencyMs} ms</span>
                {h.error && <span className="truncate text-red-400 max-w-[120px] sm:max-w-none" title={h.error}>{h.error}</span>}
                <span className="ml-auto sm:ml-0 text-[11px]">{new Date(h.checkedAt).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
        <Button className="mt-4" onClick={() => health.refetch()}>Re-check now</Button>
        {liveMode && city && <LiveScrapePanel city={city} onScraped={onScraped} />}
      </div>
    </Modal>
  );
}

// ─── Live scrape panel (Render backend — only when NEXT_PUBLIC_API_URL set) ──
function LiveScrapePanel({ city, onScraped }: { city: string; onScraped?: () => void }) {
  const [probe, setProbe] = useState<{ ok: boolean; dataMode?: string } | null>(null);
  const [running, setRunning] = useState<string | null>(null); // job id
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void probeBackend().then((p) => alive && setProbe({ ok: p.ok, dataMode: p.dataMode }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      void pollJob(running)
        .then((j) => {
          if (j.status === "running") return;
          clearInterval(t);
          setRunning(null);
          if (j.status === "done") {
            toast.success(`Live scrape done — ${j.result?.stored ?? "?"} places stored on the backend`);
            setNote(`Last run: ${j.result?.collected ?? "?"} collected · ${j.result?.stored ?? "?"} stored`);
            onScraped?.();
          } else {
            toast.error(`Live scrape failed: ${j.error ?? "unknown error"}`);
          }
        })
        .catch(() => toast.error("Lost contact with the live backend — check its dashboard."));
    }, 5000);
    return () => clearInterval(t);
  }, [running, onScraped]);

  const run = async (): Promise<void> => {
    try {
      setNote("Backend is scraping — this can take a couple of minutes.");
      const j = await startLiveScrape(city);
      setRunning(j.job_id);
    } catch (e) {
      setNote(null);
      toast.error(e instanceof Error ? e.message : "Could not start the live scrape");
    }
  };

  return (
    <div className="clay-raised-sm mt-4 p-4">
      <p className="flex items-center gap-2 text-sm font-bold">
        <span className={cn("h-2.5 w-2.5 rounded-full", probe ? (probe.ok ? "bg-emerald-500" : "bg-red-400") : "bg-amber-400 animate-pulse")} />
        Live backend {probe?.dataMode ? `· ${probe.dataMode} DB` : ""}
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {probe === null
          ? "Waking up the local data engine…"
          : probe.ok
            ? `Trigger a deeper on-demand scrape of ${city} on the always-on backend. Results land in the shared cloud DB.`
            : "Backend unreachable (it may be cold-starting) — the app keeps working on cached data."}
      </p>
      <Button
        variant="primary"
        className="mt-3"
        disabled={!!running || (probe !== null && !probe.ok)}
        onClick={() => void run()}
      >
        {running ? "Scraping live…" : "Run live scrape"}
      </Button>
      {note && <p className="mt-2 text-[12px] text-muted-foreground">{note}</p>}
    </div>
  );
}

// ─── Keyboard help (?) ──────────────────────────────────────────────────────
const SHORTCUTS: [string, string][] = [
  ["/", "Focus search"],
  ["g", "Grid (discover) view"],
  ["m", "Map view"],
  ["p", "Pulse view"],
  ["s", "Open day plan"],
  ["v", "Voice assistant"],
  ["c", "Compare sheet"],
  ["t", "Toggle dark mode"],
  ["r", "Reset filters"],
  ["H", "Source health drawer"],
  ["?", "This help"],
  ["↑↓", "Cycle places"],
  ["Enter", "Open selected place"],
  ["Esc", "Close dialogs"],
];

export function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="kbd-title">
      <div className="p-5">
        <h2 id="kbd-title" className="flex items-center gap-2 text-lg font-bold">
          <Keyboard size={18} /> Keyboard-first
        </h2>
        <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SHORTCUTS.map(([k, label]) => (
            <li key={k} className="flex items-center gap-2.5 text-sm">
              <kbd className="clay-raised-sm min-w-9 rounded-lg px-2 py-1 text-center font-mono text-[12px] font-bold">{k}</kbd>
              {label}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

// ─── Recently viewed strip ──────────────────────────────────────────────────
export function RecentStrip({ places, onOpen }: { places: Experience[]; onOpen: (e: Experience) => void }) {
  const recent = useRoam((s) => s.recent);
  const items = recent.map((id) => places.find((p) => p.id === id)).filter((p): p is Experience => !!p).slice(0, 8);
  if (items.length === 0) return null;
  return (
    <section className="no-print">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Recently viewed</h3>
      <div className="flex gap-2.5 overflow-x-auto thin-scroll pb-1">
        {items.map((e) => (
          <button key={e.id} onClick={() => onOpen(e)} className="clay-raised-sm flex shrink-0 items-center gap-2 px-3 py-2 text-[13px] font-semibold hover:clay-lift">
            {e.imageUrl ? (
              <Image src={e.imageUrl} alt="" width={28} height={28} className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <span>{e.name.slice(0, 1)}</span>
            )}
            {e.name.length > 22 ? `${e.name.slice(0, 21)}…` : e.name}
          </button>
        ))}
      </div>
    </section>
  );
}

// ─── Footer / attribution panel ─────────────────────────────────────────────
export function Attribution() {
  return (
    <footer className="mx-auto max-w-6xl px-4 pb-32 pt-10 sm:px-6 no-print">
      <div className="clay-raised-lg p-6">
        <h3 className="text-sm font-bold">About the data — no fabricated ratings, ever</h3>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          Every place on Roam is aggregated live from keyless open APIs: OpenStreetMap (ODbL) via Overpass · Wikidata (CC0) ·
          Wikipedia (CC BY-SA) · Wikivoyage (CC BY-SA) · Wikimedia Commons (free licenses) · Reddit & PullPush (community posts) ·
          Google News RSS · public-domain books (Gutenberg / Internet Archive / Wikisource) · GeoNames (CC BY 4.0) ·
          Photon & Nominatim geocoding · Open-Meteo (CC BY 4.0) · OSRM routing · Piped/Invidious video picks.
          When a source has no signal we show <span className="font-semibold text-foreground">“New — no community signal yet”</span> —
          we never invent ratings, reviews, or prices. Price figures marked <em>est.</em> are category heuristics, clearly labeled.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-[12px] font-semibold">
          <Link href="/about" className="text-primary hover:underline">About the data & privacy →</Link>
          <span className="text-muted-foreground">MIT licensed · zero API keys · zero accounts</span>
        </div>
      </div>
    </footer>
  );
}

// ─── Keyboard shortcuts controller ──────────────────────────────────────────
export function useKeyboardShortcuts(handlers: {
  onGrid: () => void;
  onMap: () => void;
  onPulse: () => void;
  onPlan: () => void;
  onVoice: () => void;
  onCompare: () => void;
  onTheme: () => void;
  onReset: () => void;
  onHealth: () => void;
  onHelp: () => void;
  onCycle: (dir: 1 | -1) => void;
  onOpenSelected: () => void;
}): void {
  useEffect(() => {
    const isTyping = (): boolean =>
      ["INPUT", "TEXTAREA", "SELECT"].includes((document.activeElement as HTMLElement)?.tagName ?? "");
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping()) return;
      switch (e.key) {
        case "g": handlers.onGrid(); break;
        case "m": handlers.onMap(); break;
        case "p": handlers.onPulse(); break;
        case "s": handlers.onPlan(); break;
        case "v": handlers.onVoice(); break;
        case "c": handlers.onCompare(); break;
        case "t": handlers.onTheme(); break;
        case "r": handlers.onReset(); break;
        case "H": handlers.onHealth(); break;
        case "?": handlers.onHelp(); break;
        case "ArrowDown": e.preventDefault(); handlers.onCycle(1); break;
        case "ArrowUp": e.preventDefault(); handlers.onCycle(-1); break;
        case "Enter": handlers.onOpenSelected(); break;
        default: return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
