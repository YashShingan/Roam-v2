"use client";

// ─── Client store: saved / visited / recent / compare / plan / lang (persisted)
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TripPlan } from "./types";

interface RoamState {
  saved: string[];
  visited: string[];
  recent: string[];
  compare: string[];
  plan: TripPlan | null;
  lang: "en" | "hi" | "mr";
  lastCity: string;
  toggleSaved: (id: string) => void;
  toggleVisited: (id: string) => void;
  pushRecent: (id: string) => void;
  toggleCompare: (id: string) => void;
  clearCompare: () => void;
  setPlan: (p: TripPlan | null) => void;
  patchPlan: (p: TripPlan) => void;
  setLang: (l: "en" | "hi" | "mr") => void;
  setLastCity: (c: string) => void;
}

export const useRoam = create<RoamState>()(
  persist(
    (set) => ({
      saved: [],
      visited: [],
      recent: [],
      compare: [],
      plan: null,
      lang: "en",
      lastCity: "Pune",
      toggleSaved: (id) =>
        set((s) => ({
          saved: s.saved.includes(id) ? s.saved.filter((x) => x !== id) : [...s.saved, id],
        })),
      toggleVisited: (id) =>
        set((s) => ({
          visited: s.visited.includes(id) ? s.visited.filter((x) => x !== id) : [...s.visited, id],
        })),
      pushRecent: (id) =>
        set((s) => ({ recent: [id, ...s.recent.filter((x) => x !== id)].slice(0, 12) })),
      toggleCompare: (id) =>
        set((s) => {
          if (s.compare.includes(id)) return { compare: s.compare.filter((x) => x !== id) };
          if (s.compare.length >= 3) return { compare: [...s.compare.slice(1), id] };
          return { compare: [...s.compare, id] };
        }),
      clearCompare: () => set({ compare: [] }),
      setPlan: (p) => set({ plan: p }),
      patchPlan: (p) => set({ plan: p }),
      setLang: (l) => set({ lang: l }),
      setLastCity: (c) => set({ lastCity: c }),
    }),
    { name: "roam-store", version: 1 },
  ),
);
