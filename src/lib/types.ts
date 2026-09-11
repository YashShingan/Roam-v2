// ─── Roam core data model ────────────────────────────────────────────────────
export type Category =
  | "food"
  | "culture"
  | "nature"
  | "market"
  | "nightlife"
  | "adventure"
  | "workshop"
  | "hidden_gem";

export const CATEGORIES: Category[] = [
  "food",
  "culture",
  "nature",
  "market",
  "nightlife",
  "adventure",
  "workshop",
  "hidden_gem",
];

export interface SourceRef {
  source: string;
  url?: string;
  note?: string;
}

export interface CommunitySignal {
  mentions: number;
  upvotes: number;
  sentiment: number; // -1..1 — 0 means "no signal"
  quotes: { text: string; permalink?: string }[];
  priceHint?: number;
  crowdWarning?: boolean;
  hiddenGem?: boolean;
}

export interface PriceSample {
  value: number;
  value_max?: number | null;
  unit?: string | null;
  context: string;
  source: string;
  url?: string | null;
  date?: string | null;
  raw_snippet?: string | null;
  confidence?: number;
}

export interface PriceHint {
  mode: "meal" | "entry" | "item" | "mixed" | string;
  min: number;
  max: number;
  per_person?: number | null;
  samples: PriceSample[];
  confidence: number;
}

export interface Experience {
  id: string;
  name: string;
  category: Category;
  source: string;
  sources: SourceRef[];
  description?: string;
  lat?: number;
  lon?: number;
  address: string; // never empty → "Not listed"
  popularity: string; // "👁 45K video" / "New — no signal yet"
  popularityScore: number; // 0..1 normalized, used by planner
  community: CommunitySignal; // zeros when absent — NEVER fabricated
  pricePerPerson?: number;
  priceIsEstimate?: boolean;
  durationMinutes: number;
  openingHoursRaw?: string;
  isOutdoor?: boolean;
  wheelchairAccessible?: boolean | null;
  goodForKids?: boolean | null;
  bookingRequired: boolean;
  tags: string[];
  imageUrl?: string;
  photoAttribution?: string;
  amenities: string[];
  osmId?: string;
  osmType?: string;
  website?: string;
  gmapsUrl?: string;
  gmapsDirectionsUrl?: string;
  bestTime?: string;
  goldenHour?: boolean;
  distanceKm?: number;
  walkTimeMin?: string;
  driveTimeMin?: string;
  priceHint?: PriceHint | null;
  foundViaSearch?: boolean;
}

export interface ItineraryStop {
  experienceId: string;
  name: string;
  category: Category;
  slotStart: string;
  slotEnd: string;
  travelMinFromPrev: number;
  legGeometry?: [number, number][];
  lat?: number;
  lon?: number;
  durationMinutes: number;
  pricePerPerson?: number;
  priceBasis?: string;
  priceMin?: number;
  priceMax?: number;
  priceQuote?: string;
  note?: string;
  locked?: boolean;
  visited?: boolean;
  gmapsDirectionsUrl?: string;
  imageUrl?: string;
  timeOfDay?: string;
}

export interface TripDay {
  date?: string;
  stops: ItineraryStop[];
  totalHours: number;
  walkKm?: number;
}

export interface TripPlan {
  id: string;
  city: string;
  cityLabel: string;
  lat?: number;
  lon?: number;
  createdAt: string;
  days: TripDay[];
  voiceSummary: string;
  feasibility: { ok: boolean; message: string };
  budgetTotal?: number;
  budgetPerDay?: number;
  budgetBand?: {
    min: number;
    max: number;
    pricedCount: number;
    totalStops: number;
    unpricedCount: number;
    note: string;
  };
  shareUrl: string;
  votes?: Record<string, number>;
  goldenHourNotes?: string[];
}

// ─── Voice assistant ─────────────────────────────────────────────────────────
export type Vibe = "chill" | "packed" | "foodie" | "heritage";

export type Action =
  | { type: "set_city"; city: string }
  | {
      type: "apply_filters";
      categories?: Category[];
      budget?: number;
      timeOfDay?: string;
      openNow?: boolean;
      hiddenGem?: boolean;
    }
  | {
      type: "plan_trip";
      hoursPerDay: number;
      days: number;
      interests?: Category[];
      budget?: number;
      vibe?: Vibe;
    }
  | { type: "add_stop"; name: string }
  | { type: "remove_stop"; name: string }
  | { type: "reorder"; from: number; to: number }
  | { type: "surprise_me" }
  | { type: "compare"; names: string[] }
  | { type: "read_day_plan" }
  | { type: "navigate_to"; name: string }
  | { type: "answer"; topic: "weather" | "best_time" | "price" | "crowd"; about?: string };

export interface AssistantResponse {
  actions: Action[];
  reply: string;
  nlu: "rules" | "webllm" | "ollama";
  sessionId: string;
}

// ─── Health / stats ──────────────────────────────────────────────────────────
export interface CollectorHealth {
  name: string;
  ok: boolean;
  latencyMs: number;
  count: number;
  error?: string;
  checkedAt: string;
}

export interface CityStats {
  city: string;
  total: number;
  byCategory: Record<string, number>;
  mentionsTotal: number;
  sentimentHistogram: { bucket: string; count: number }[];
  topMentioned: { name: string; mentions: number }[];
  sourceCounts: { source: string; count: number }[];
  radar: { category: string; signal: number; variety: number }[];
  avgPrice?: number;
}

// ─── Filters (URL-synced) ────────────────────────────────────────────────────
export interface Filters {
  q: string;
  categories: Category[];
  budget: number | null; // ₹ max per person
  duration: "any" | "short" | "half" | "long"; // <1h / 1-3h / 3h+
  timeOfDay: "any" | "morning" | "afternoon" | "evening" | "night";
  openNow: boolean;
  hiddenGem: boolean;
  crowdWarning: boolean; // ⚠️ show crowded
  savedOnly: boolean;
  hideBooking: boolean;
  wheelchair: boolean;
  sort:
    | "smart"
    | "popularity"
    | "distance"
    | "price_asc"
    | "price_desc"
    | "duration"
    | "sentiment";
  localLens: boolean;
  hasPhoto?: boolean;
  priceConfirmed?: boolean;
}
