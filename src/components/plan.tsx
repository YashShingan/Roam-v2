"use client";

import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  Download,
  Lock,
  LockOpen,
  MapPin,
  Navigation,
  Printer,
  QrCode,
  Share2,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Experience, TripPlan, Vibe } from "@/lib/types";
import { translate, type DictKey } from "@/lib/i18n";
import { useRoam } from "@/lib/store";
import { download, icsForPlan, planToText } from "@/lib/exports";
import { Button, Modal, Slider, cn, SPRING } from "./ui";
import { CATEGORY_EMOJI } from "./cards";

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

export function PlanSheet({
  open,
  onClose,
  onReplan,
  onOpenPlace,
}: {
  open: boolean;
  onClose: () => void;
  onReplan: (req: { days: number; hoursPerDay: number; vibe?: Vibe }) => void;
  onOpenPlace: (exp: Experience) => void;
}) {
  const plan = useRoam((s) => s.plan);
  const patchPlan = useRoam((s) => s.patchPlan);
  const lang = useRoam((s) => s.lang);
  const t = (k: DictKey) => translate(lang, k);
  const [dayIdx, setDayIdx] = useState(0);
  const [hours, setHours] = useState(plan ? Math.max(2, Math.min(15, Math.round(plan.days[0]?.totalHours ?? 8))) : 8);
  const [days, setDays] = useState(plan?.days.length ?? 1);
  const [selectedVibe, setSelectedVibe] = useState<string>("all");
  const [qr, setQr] = useState<string | null>(null);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const speakingRef = useRef(false);

  const allStops = useMemo(() => plan?.days.flatMap((d) => d.stops) ?? [], [plan]);
  const visitedCount = allStops.filter((s) => s.visited).length;
  const progress = allStops.length ? Math.round((visitedCount / allStops.length) * 100) : 0;

  if (!plan) {
    return (
      <Modal open={open} onClose={onClose} labelledBy="plan-title" side>
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="text-4xl">🗓️</span>
          <h2 id="plan-title" className="text-lg font-bold">No plan yet</h2>
          <p className="max-w-xs text-sm text-muted-foreground">
            Ask the voice assistant: <em>“plan a one-day food trip in Kalyan under ₹500”</em> — or hit{" "}
            <span className="font-semibold">Plan my day</span> in the dock.
          </p>
        </div>
      </Modal>
    );
  }

  const day = plan.days[Math.min(dayIdx, plan.days.length - 1)];

  const mutateStop = (dIdx: number, sIdx: number, patch: Partial<(typeof day.stops)[number]>, dir?: -1 | 1): void => {
    const next: TripPlan = structuredClone(plan);
    const stops = next.days[dIdx].stops;
    if (dir && dir === -1 && sIdx > 0) {
      [stops[sIdx - 1], stops[sIdx]] = [stops[sIdx], stops[sIdx - 1]];
    } else if (dir && dir === 1 && sIdx < stops.length - 1) {
      [stops[sIdx + 1], stops[sIdx]] = [stops[sIdx], stops[sIdx + 1]];
    } else if (!dir) {
      stops[sIdx] = { ...stops[sIdx], ...patch };
    }
    patchPlan(next);
    void fetch(`/api/trip/${next.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: next.days }),
    }).catch(() => undefined);
  };

  const removeStop = (dIdx: number, sIdx: number): void => {
    const next: TripPlan = structuredClone(plan);
    next.days[dIdx].stops.splice(sIdx, 1);
    patchPlan(next);
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

  const vote = async (stopName: string, delta: 1 | -1): Promise<void> => {
    setVotes((v) => ({ ...v, [stopName]: (v[stopName] ?? 0) + delta }));
    try {
      await fetch(`/api/trip/${plan.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopName, delta }),
      });
    } catch {
      toast.error("Vote failed — group mode needs the server");
    }
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="plan-title" side>
      <div className="thin-scroll flex h-full flex-col overflow-y-auto print-plan">
        <div className="sticky top-0 z-10 bg-card/90 px-4 sm:px-5 pb-3 pt-4 sm:pt-5 backdrop-blur">
          <h2 id="plan-title" className="text-xl font-bold">🗓️ {t("plan.title")} — {plan.cityLabel.split(",")[0]}</h2>
          <div
            className={cn(
              "mt-2 rounded-xl px-3.5 py-2 text-[13px] font-medium",
              plan.feasibility.ok ? "bg-accent/12 text-accent" : "bg-gold/15 text-gold",
            )}
            role="status"
          >
            {plan.feasibility.ok ? "✓ " : "⚠️ "}
            {plan.feasibility.message}
          </div>
          {plan.budgetBand && (
            <div className="mt-2 rounded-xl bg-surface/80 p-2.5 text-[12px] text-muted-foreground border border-border/50">
              <span className="font-bold text-foreground">
                💰 ₹{Intl.NumberFormat("en-IN").format(plan.budgetBand.min)}–₹{Intl.NumberFormat("en-IN").format(plan.budgetBand.max)}
              </span>{" "}
              band · {plan.budgetBand.pricedCount} of {plan.budgetBand.totalStops} stops priced ({plan.budgetBand.note})
            </div>
          )}
          {/* visited progress */}
          <div className="mt-3 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
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

        <div className="px-4 sm:px-5 pb-6">
          {/* day tabs */}
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

          {/* Vibe selector */}
          <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1">
            <span className="text-[11px] font-bold text-muted-foreground shrink-0 mr-0.5">Pacing:</span>
            {VIBES.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setSelectedVibe(v.id);
                  onReplan({ days, hoursPerDay: hours, vibe: v.id === "all" ? undefined : (v.id as Vibe) });
                }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-bold transition-all shrink-0",
                  selectedVibe === v.id ? "bg-primary text-primary-foreground shadow-sm" : "clay-raised-sm text-muted-foreground hover:text-foreground"
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

          {day.walkKm !== undefined && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Day {dayIdx + 1}: {day.totalHours} h total · ~{day.walkKm} km walking · {day.stops.length} stops
            </p>
          )}

          {/* stops */}
          <ol className="mt-3 space-y-2.5">
            {day.stops.map((s, sIdx) => (
              <motion.li
                key={`${s.experienceId}-${sIdx}`}
                layout
                transition={SPRING}
                className={cn("clay-raised-sm p-3.5", s.visited && "opacity-70")}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => mutateStop(dayIdx, sIdx, { visited: !s.visited })}
                    aria-label={s.visited ? "Mark unvisited" : "Mark visited"}
                    className="mt-0.5 shrink-0 text-accent"
                  >
                    {s.visited ? <CheckCircle2 size={19} className="fill-accent/20" /> : <Circle size={19} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[11px] font-bold text-primary">
                        {s.slotStart}–{s.slotEnd}
                      </p>
                      {s.timeOfDay && TIME_BADGES[s.timeOfDay] && (
                        <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold", TIME_BADGES[s.timeOfDay].bg)}>
                          <span>{TIME_BADGES[s.timeOfDay].icon}</span>
                          <span>{TIME_BADGES[s.timeOfDay].label}</span>
                        </span>
                      )}
                      {s.travelMinFromPrev > 0 && (
                        <span className="font-semibold text-muted-foreground text-[10px]">🚶 {s.travelMinFromPrev} min walk</span>
                      )}
                    </div>
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
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold",
                          s.priceBasis?.includes("Varies")
                            ? "bg-surface text-muted-foreground"
                            : "bg-primary/10 text-primary"
                        )}
                        title={s.priceQuote ?? s.priceBasis}
                      >
                        🏷️ {s.priceBasis ?? (s.pricePerPerson ? `~₹${s.pricePerPerson} pp` : "Varies")}
                      </span>
                      {s.lat !== undefined && s.lon !== undefined && (
                        <a
                          href={s.gmapsDirectionsUrl ?? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-[11px] font-semibold text-primary hover:underline"
                          title="Open turn-by-turn directions in Google Maps"
                        >
                          <Navigation size={10} />
                          <span>Directions</span>
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <div className="flex gap-1">
                      <button onClick={() => mutateStop(dayIdx, sIdx, {}, -1)} disabled={sIdx === 0} aria-label="Move up" className="clay-raised-sm flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-40">
                        <ArrowUp size={13} />
                      </button>
                      <button onClick={() => mutateStop(dayIdx, sIdx, {}, 1)} disabled={sIdx === day.stops.length - 1} aria-label="Move down" className="clay-raised-sm flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-40">
                        <ArrowDown size={13} />
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => vote(s.name, 1)} aria-label={`Vote for ${s.name}`} className="clay-raised-sm flex h-7 items-center gap-0.5 rounded-lg px-1.5 text-[11px] font-bold text-accent">
                        <ThumbsUp size={12} /> {votes[s.name] ? `+${votes[s.name]}` : ""}
                      </button>
                      <button onClick={() => vote(s.name, -1)} aria-label={`Vote against ${s.name}`} className="clay-raised-sm flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground">
                        <ThumbsDown size={12} />
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => mutateStop(dayIdx, sIdx, { locked: !s.locked })}
                        aria-label={s.locked ? "Unlock stop" : "Lock stop on re-plan"}
                        className={cn("clay-raised-sm flex h-7 w-7 items-center justify-center rounded-lg", s.locked && "clay-pressed text-primary")}
                      >
                        {s.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                      </button>
                      <button onClick={() => removeStop(dayIdx, sIdx)} aria-label={`Remove ${s.name}`} className="clay-raised-sm flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-red-400">
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.li>
            ))}
            {day.stops.length === 0 && <li className="clay-raised-sm p-4 text-sm text-muted-foreground">Nothing planned this day — lower hours/day or re-plan.</li>}
          </ol>

          {/* controls */}
          <div className="clay-raised mt-4 space-y-3 sm:space-y-4 p-3 sm:p-4 no-print">
            <div className="flex flex-wrap items-end gap-4">
              <Slider label="Hours / day" min={2} max={15} value={hours} onChange={setHours} format={(v) => `${v} h`} />
              <Slider label="Days" min={1} max={7} value={days} onChange={setDays} />
              <Button variant="primary" onClick={() => onReplan({ days, hoursPerDay: hours, vibe: selectedVibe === "all" ? undefined : (selectedVibe as Vibe) })}>
                🔄 {t("plan.replan")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
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
              <MapPin size={11} /> Legs use OSRM walking routes; without it, straight-line ×1.4 estimates. Estimated total ₹
              {Intl.NumberFormat("en-IN").format(plan.budgetTotal ?? 0)} per person.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
