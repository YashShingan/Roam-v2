// ─── Shared category catalog (safe for both server and client imports) ──────
import type { Category } from "./types";

export const CATEGORY_EMOJI: Record<Category, string> = {
  food: "☕",
  culture: "🏯",
  nature: "🌿",
  market: "🧺",
  nightlife: "🌙",
  adventure: "🥾",
  workshop: "🪵",
  hidden_gem: "💎",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  food: "Food & chai",
  culture: "Culture & heritage",
  nature: "Nature & views",
  market: "Markets & bazaars",
  nightlife: "Nightlife",
  adventure: "Adventure",
  workshop: "Workshops & crafts",
  hidden_gem: "Hidden gems",
};
