"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CloudRain,
  Thermometer,
  Wind,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ArrowRight,
  TrendingDown,
  Navigation,
  X,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Chip, cn, SPRING } from "./ui";
import { useTwinStore } from "@/lib/twin-store";
import { useRoam } from "@/lib/store";
import type { SocialSignal } from "@/lib/social-signals";

export function DigitalTwinPanel({
  onAcceptSimulation,
}: {
  onAcceptSimulation: (simulatedPlan: any) => void;
}) {
  const {
    isOpen,
    scenario,
    simulatedPlan,
    diff,
    explanation,
    confidence,
    isSimulating,
    setOpen,
    setScenario,
    setSimulationResult,
    setIsSimulating,
    reset,
  } = useTwinStore();

  const plan = useRoam((s) => s.plan);
  const city = useRoam((s) => s.lastCity) || "Pune";

  const [signals, setSignals] = useState<SocialSignal[]>([]);
  const [activeTab, setActiveTab] = useState<"controls" | "cascade" | "signals">("controls");

  // Load social signals on open
  useEffect(() => {
    if (!isOpen) return;
    void fetch(`/api/social/signals?city=${encodeURIComponent(city)}&rain=${scenario.precipMm || 0}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.signals) setSignals(data.signals);
      })
      .catch(() => {});
  }, [city, isOpen, scenario.precipMm]);

  if (!isOpen || !plan) return null;

  const handleSimulate = async () => {
    setIsSimulating(true);
    try {
      const res = await fetch("/api/twin/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          scenario,
        }),
      });

      if (!res.ok) throw new Error("Simulation request failed");
      const data = await res.json();
      setSimulationResult(data);
      setActiveTab("cascade");
      toast.success("What-If simulation completed!");
    } catch {
      toast.error("Failed to run simulation. Please retry.");
    } finally {
      setIsSimulating(false);
    }
  };

  const handleAccept = () => {
    if (!simulatedPlan) return;
    onAcceptSimulation(simulatedPlan);
    setOpen(false);
    toast.success("✓ Simulation accepted! Itinerary updated.");
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 80 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 80 }}
        transition={SPRING}
        className="fixed inset-y-0 right-0 z-[110] flex w-full max-w-md flex-col bg-background/95 backdrop-blur-md shadow-2xl border-l border-border"
        role="dialog"
        aria-label="Digital Twin What-If Simulator"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles size={16} />
            </span>
            <div>
              <h2 className="text-sm font-bold tracking-tight">Weather Digital Twin</h2>
              <p className="text-[11px] text-muted-foreground">What-If Scenario Simulator</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={reset}
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-surface hover:text-foreground"
              title="Reset scenario"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-surface hover:text-foreground"
              title="Close panel"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-border px-3 pt-2">
          {(["controls", "cascade", "signals"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={cn(
                "flex-1 pb-2 text-xs font-semibold capitalize border-b-2 transition-colors",
                activeTab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "controls" ? "Scenario" : t === "cascade" ? "Impact Diff" : "Disruptions"}
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-4 thin-scroll">
          {activeTab === "controls" && (
            <div className="space-y-4">
              {/* Rain Slider */}
              <div className="clay-raised-sm rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <CloudRain size={14} className="text-blue-500" /> Rain Intensity
                  </span>
                  <span className="text-xs font-mono font-bold text-primary">
                    {scenario.precipMm ?? 0} mm/hr
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="45"
                  step="5"
                  value={scenario.precipMm ?? 0}
                  onChange={(e) => setScenario({ precipMm: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Dry (0)</span>
                  <span>Light (10)</span>
                  <span>Monsoon (25+)</span>
                  <span>Downpour (45)</span>
                </div>
              </div>

              {/* Temperature Slider */}
              <div className="clay-raised-sm rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <Thermometer size={14} className="text-amber-500" /> Temperature
                  </span>
                  <span className="text-xs font-mono font-bold text-primary">
                    {scenario.tempC ?? 28}°C
                  </span>
                </div>
                <input
                  type="range"
                  min="15"
                  max="46"
                  step="1"
                  value={scenario.tempC ?? 28}
                  onChange={(e) => setScenario({ tempC: Number(e.target.value) })}
                  className="w-full accent-amber-500"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Pleasant (20°)</span>
                  <span>Normal (28°)</span>
                  <span>Warm (35°)</span>
                  <span>Heatwave (42°+)</span>
                </div>
              </div>

              {/* Wind Speed Slider */}
              <div className="clay-raised-sm rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <Wind size={14} className="text-teal-500" /> Wind Velocity
                  </span>
                  <span className="text-xs font-mono font-bold text-primary">
                    {scenario.windKmh ?? 12} km/h
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="5"
                  value={scenario.windKmh ?? 12}
                  onChange={(e) => setScenario({ windKmh: Number(e.target.value) })}
                  className="w-full accent-teal-500"
                />
              </div>

              {/* Flood Level & Transit Preferences */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Flooding / Waterlogging</label>
                <div className="flex gap-2">
                  {(["none", "minor", "major"] as const).map((lvl) => (
                    <Chip
                      key={lvl}
                      active={(scenario.floodLevel ?? "none") === lvl}
                      onClick={() => setScenario({ floodLevel: lvl })}
                      className="flex-1 justify-center capitalize"
                    >
                      {lvl}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "cascade" && (
            <div className="space-y-3.5">
              {diff ? (
                <>
                  {/* Confidence Banner */}
                  <div className="clay-raised-sm rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-muted-foreground block">Model Confidence</span>
                      <span className="text-xs font-bold text-emerald-500">
                        {Math.round(confidence * 100)}% Certainty
                      </span>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                      Nugen-Aligned
                    </span>
                  </div>

                  {/* Summary */}
                  {explanation && (
                    <div className="clay-raised-sm rounded-xl p-3 space-y-1 bg-surface/50">
                      <p className="text-xs font-medium leading-relaxed">{explanation.summary}</p>
                      <p className="text-[10px] italic text-muted-foreground">
                        {explanation.uncertainty_note}
                      </p>
                    </div>
                  )}

                  {/* Impact Stats */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="clay-raised-sm rounded-xl p-2.5">
                      <span className="text-[10px] text-muted-foreground block">Compromised Stops</span>
                      <span className="text-sm font-bold text-amber-500">{diff.compromisedCount}</span>
                    </div>
                    <div className="clay-raised-sm rounded-xl p-2.5">
                      <span className="text-[10px] text-muted-foreground block">Indoor Replacements</span>
                      <span className="text-sm font-bold text-emerald-500">{diff.replacedCount}</span>
                    </div>
                  </div>

                  {/* Substitutions Cascade List */}
                  {diff.substitutions.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-muted-foreground">Proposed Substitutions</h4>
                      {diff.substitutions.map((sub, i) => (
                        <div key={i} className="clay-raised-sm rounded-xl p-2.5 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <span className="text-destructive line-through">{sub.original}</span>
                            <ArrowRight size={12} className="text-muted-foreground" />
                            <span className="text-emerald-500">{sub.substitute}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{sub.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground space-y-2">
                  <Sparkles size={24} className="mx-auto text-primary opacity-60" />
                  <p className="text-xs">Configure your scenario and click "Run Simulation" below.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === "signals" && (
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold text-muted-foreground">Live Traveler Disruption Signals</h4>
              {signals.length > 0 ? (
                signals.map((sig) => (
                  <div key={sig.id} className="clay-raised-sm rounded-xl p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-primary">{sig.author}</span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                          sig.isDisruption ? "bg-destructive/15 text-destructive" : "bg-emerald-500/15 text-emerald-600",
                        )}
                      >
                        {sig.isDisruption ? "Disruption" : "Clear"}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed">{sig.text}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">No disruptions reported.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-border p-3.5 space-y-2 bg-card">
          {activeTab === "controls" ? (
            <Button
              variant="primary"
              className="w-full justify-center text-xs py-2.5 font-bold"
              onClick={handleSimulate}
              disabled={isSimulating}
            >
              <Sparkles size={14} className="mr-1.5" />
              {isSimulating ? "Running What-If Simulation…" : "Run Simulation"}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="default"
                className="flex-1 justify-center text-xs py-2"
                onClick={() => setActiveTab("controls")}
              >
                Adjust Controls
              </Button>
              <Button
                variant="primary"
                className="flex-1 justify-center text-xs py-2 font-bold bg-emerald-600 hover:bg-emerald-700"
                onClick={handleAccept}
                disabled={!simulatedPlan}
              >
                <CheckCircle2 size={14} className="mr-1.5" /> Accept Simulation
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
