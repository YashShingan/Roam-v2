// ─── Digital Twin Simulation Zustand Store ────────────────────────────────
import { create } from "zustand";
import type { TripPlan } from "./types";
import type { ScenarioOverrides, TwinDiff, TwinSimulationResult } from "./digital-twin";
import type { NugenCausalExplanation } from "./nugen-client";

interface TwinStore {
  isOpen: boolean;
  scenario: ScenarioOverrides;
  simulatedPlan: TripPlan | null;
  diff: TwinDiff | null;
  explanation: NugenCausalExplanation | null;
  confidence: number;
  isSimulating: boolean;

  setOpen: (open: boolean) => void;
  setScenario: (patch: Partial<ScenarioOverrides>) => void;
  setSimulationResult: (res: TwinSimulationResult | null) => void;
  setIsSimulating: (loading: boolean) => void;
  reset: () => void;
}

const DEFAULT_SCENARIO: ScenarioOverrides = {
  precipMm: 0,
  tempC: 28,
  windKmh: 12,
  floodLevel: "none",
  preferTransit: false,
};

export const useTwinStore = create<TwinStore>((set) => ({
  isOpen: false,
  scenario: { ...DEFAULT_SCENARIO },
  simulatedPlan: null,
  diff: null,
  explanation: null,
  confidence: 1.0,
  isSimulating: false,

  setOpen: (open) => set({ isOpen: open }),
  setScenario: (patch) => set((s) => ({ scenario: { ...s.scenario, ...patch } })),
  setSimulationResult: (res) =>
    set({
      simulatedPlan: res?.simulatedPlan ?? null,
      diff: res?.diff ?? null,
      explanation: res?.explanation ?? null,
      confidence: res?.confidence ?? 1.0,
    }),
  setIsSimulating: (isSimulating) => set({ isSimulating }),
  reset: () =>
    set({
      scenario: { ...DEFAULT_SCENARIO },
      simulatedPlan: null,
      diff: null,
      explanation: null,
      confidence: 1.0,
      isSimulating: false,
    }),
}));
