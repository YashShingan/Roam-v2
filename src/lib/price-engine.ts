// ─── Context-Aware Price Intelligence Engine (TypeScript parity with backend) ─
import type { Category, PriceHint, PriceSample } from "./types";

const PLAUSIBILITY_GATES: Record<string, [number, number]> = {
  item: [5, 400],
  meal: [30, 3500],
  entry: [0, 600],
  adventure: [200, 10000],
  nature: [0, 1000],
  culture: [0, 1000],
  workshop: [100, 5000],
  market: [5, 3000],
  default: [0, 8000],
};

const FREE_PATTERNS: RegExp[] = [
  /\bfree\s+entry\b/i,
  /\bentry\s+free\b/i,
  /\bno\s+entry\s+fees?\b/i,
  /\bno\s+entry\s+charges?\b/i,
  /\bentry\s+is\s+(?:typically\s+)?free\b/i,
  /\bfree\s+of\s+charge\b/i,
  /\bno\s+tickets?\s+required\b/i,
  /\bno\s+tickets?\b/i,
  /\bno\s+entrance\s*fees?\b/i,
  /\badmission\s+free\b/i,
  /\bfree\s+admission\b/i,
  /\bentry\b[^.\n]{0,30}\bfree\b/i,
  /\bfree\b[^.\n]{0,30}\b(?:entry|visit|admission)\b/i,
];

const NUM_PATTERN = String.raw`(?:\d+(?:\.\d+)?k|\d+(?:,\d+)*(?:\.\d+)?)`;

const RANGE_RE = new RegExp(
  String.raw`(?:₹|rs\.?|inr)\s*(${NUM_PATTERN})\s*(?:[-–—]|to)\s*(?:₹|rs\.?|inr)?\s*(${NUM_PATTERN})(?:\s*\/-|\s*rupees)?`,
  "gi",
);

const PRICE_PREFIX_RE = new RegExp(
  String.raw`(?:₹|rs\.?|inr)\s*(${NUM_PATTERN})(?:\s*\/-)?`,
  "gi",
);

const PRICE_SUFFIX_RE = new RegExp(
  String.raw`(${NUM_PATTERN})\s*(?:\/-|rupees|rs\.?|₹)`,
  "gi",
);

const BARE_K_RE = /(\d+(?:\.\d+)?k)\s*(?:per\s+person|per\s+head|pp|buffet)/gi;

const REJECT_WORDS_RE = /\b(lakhs?|crores?|km|kms|meters?|am|pm|o'clock|stars?|rating)\b/i;

function cleanNumber(valStr: string): number | null {
  const s = valStr.trim().toLowerCase().replace(/,/g, "");
  if (s.endsWith("k")) {
    const n = Number.parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n * 1000 : null;
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function classifyContext(windowText: string): "entry" | "meal" | "item" {
  const text = windowText.toLowerCase();

  let entryScore = 0;
  for (const cue of [
    "entry",
    "ticket",
    "entrance",
    "admission",
    "pass",
    "entry fee",
    "entry ticket",
    "adult",
    "child ticket",
  ]) {
    if (text.includes(cue)) {
      entryScore += ["entry fee", "entry ticket", "entrance fee", "admission"].includes(cue) ? 2 : 1;
    }
  }

  let mealScore = 0;
  for (const cue of [
    "per person",
    "per head",
    "pp",
    "for two",
    "thali",
    "meal",
    "dinner",
    "lunch",
    "buffet",
    "cost for two",
    "dinner for",
    "food for",
    "buffet is",
  ]) {
    if (text.includes(cue)) {
      mealScore += ["per person", "per head", "for two", "cost for two", "thali", "buffet"].includes(cue) ? 2 : 1;
    }
  }

  let itemScore = 0;
  for (const cue of [
    "chai",
    "tea",
    "coffee",
    "plate",
    "vada",
    "samosa",
    "snack",
    "per cup",
    "per plate",
    "dosa",
    "pav",
    "dish",
    "bowl",
    "drink",
  ]) {
    if (text.includes(cue)) {
      itemScore += ["per plate", "per cup", "chai", "samosa", "vada", "dosa"].includes(cue) ? 2 : 1;
    }
  }

  if (entryScore > mealScore && entryScore > itemScore) return "entry";
  if (itemScore > entryScore && itemScore > mealScore) return "item";
  return "meal";
}

export function parsePriceSnippets(
  text: string | undefined | null,
  source = "web",
  url?: string,
  category?: Category | string,
): PriceSample[] {
  if (!text) return [];

  const samples: PriceSample[] = [];
  const matchedSpans: [number, number][] = [];

  const isOverlapping = (s: number, e: number): boolean =>
    matchedSpans.some(([ms, me]) => !(e <= ms || s >= me));

  // 1. Free entry patterns
  for (const fp of FREE_PATTERNS) {
    const match = fp.exec(text);
    if (match && match.index !== undefined) {
      const start = match.index;
      const end = start + match[0].length;
      const window = text.slice(Math.max(0, start - 100), Math.min(text.length, end + 100));
      samples.push({
        value: 0,
        value_max: 0,
        unit: "INR",
        context: "entry",
        source,
        url: url ?? null,
        raw_snippet: window.trim().slice(0, 140),
        confidence: 0.9,
      });
      matchedSpans.push([start, end]);
    }
  }

  // 2. Price ranges (₹200–300, Rs 150 to 250)
  for (const m of text.matchAll(RANGE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const window = text.slice(Math.max(0, start - 120), Math.min(text.length, end + 120));
    if (REJECT_WORDS_RE.test(window)) continue;

    const v1 = cleanNumber(m[1]);
    const v2 = cleanNumber(m[2]);
    if (v1 === null || v2 === null || v1 < 0 || v2 < 0) continue;

    let vmin = Math.min(v1, v2);
    let vmax = Math.max(v1, v2);

    if (vmin >= 1900 && vmin <= 2099 && vmax >= 1900 && vmax <= 2099 && !/₹|rs/i.test(m[0])) {
      continue;
    }

    let context = classifyContext(window);
    if (/for two|cost for two/i.test(window)) {
      vmin = Math.round(vmin / 2);
      vmax = Math.round(vmax / 2);
      context = "meal";
    }

    const gateCat = category || context;
    const [minG, maxG] = PLAUSIBILITY_GATES[gateCat] ?? PLAUSIBILITY_GATES.default;
    if (!(vmin >= minG && vmin <= maxG) && !(vmax >= minG && vmax <= maxG * 1.5)) {
      continue;
    }

    samples.push({
      value: vmin,
      value_max: vmax,
      unit: "INR",
      context,
      source,
      url: url ?? null,
      raw_snippet: window.trim().slice(0, 140),
      confidence: 0.85,
    });
    matchedSpans.push([start, end]);
  }

  // 3. Single prices: Prefix (₹500, Rs. 500)
  for (const m of text.matchAll(PRICE_PREFIX_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (isOverlapping(start, end)) continue;

    const window = text.slice(Math.max(0, start - 120), Math.min(text.length, end + 120));
    if (REJECT_WORDS_RE.test(window)) continue;

    let v = cleanNumber(m[1]);
    if (v === null) continue;
    if (v >= 1900 && v <= 2099 && !/₹|rs/i.test(m[0])) continue;

    let context = classifyContext(window);
    if (/for two|cost for two/i.test(window)) {
      v = Math.round(v / 2);
      context = "meal";
    }

    const gateCat = category || context;
    const [minG, maxG] = PLAUSIBILITY_GATES[gateCat] ?? PLAUSIBILITY_GATES.default;
    if (v < minG || v > maxG) continue;

    samples.push({
      value: v,
      value_max: null,
      unit: "INR",
      context,
      source,
      url: url ?? null,
      raw_snippet: window.trim().slice(0, 140),
      confidence: 0.75,
    });
    matchedSpans.push([start, end]);
  }

  // 4. Single prices: Suffix (500/-, 500 rupees)
  for (const m of text.matchAll(PRICE_SUFFIX_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (isOverlapping(start, end)) continue;

    const window = text.slice(Math.max(0, start - 120), Math.min(text.length, end + 120));
    if (REJECT_WORDS_RE.test(window)) continue;

    let v = cleanNumber(m[1]);
    if (v === null) continue;

    let context = classifyContext(window);
    if (/for two|cost for two/i.test(window)) {
      v = Math.round(v / 2);
      context = "meal";
    }

    const gateCat = category || context;
    const [minG, maxG] = PLAUSIBILITY_GATES[gateCat] ?? PLAUSIBILITY_GATES.default;
    if (v < minG || v > maxG) continue;

    samples.push({
      value: v,
      value_max: null,
      unit: "INR",
      context,
      source,
      url: url ?? null,
      raw_snippet: window.trim().slice(0, 140),
      confidence: 0.7,
    });
    matchedSpans.push([start, end]);
  }

  // 5. Bare 'k' with per-person / buffet cue
  for (const m of text.matchAll(BARE_K_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (isOverlapping(start, end)) continue;
    const v = cleanNumber(m[1]);
    if (v !== null) {
      const window = text.slice(Math.max(0, start - 100), Math.min(text.length, end + 100));
      const context = classifyContext(window);
      samples.push({
        value: v,
        value_max: null,
        unit: "INR",
        context,
        source,
        url: url ?? null,
        raw_snippet: window.trim().slice(0, 140),
        confidence: 0.75,
      });
      matchedSpans.push([start, end]);
    }
  }

  return samples;
}

export function aggregatePriceHint(
  samples: PriceSample[],
  category?: Category | string,
): PriceHint | null {
  if (!samples || samples.length === 0) return null;

  const valid = samples.filter((s) => Number.isFinite(s.value) && s.value >= 0);
  if (valid.length === 0) return null;

  const values: number[] = [];
  for (const s of valid) {
    values.push(s.value);
    if (s.value_max !== undefined && s.value_max !== null && Number.isFinite(s.value_max)) {
      values.push(s.value_max);
    }
  }
  if (values.length === 0) return null;

  const contexts = valid.map((s) => s.context);
  const uniqueContexts = new Set(contexts);
  let mode = "meal";
  if (uniqueContexts.size === 1) {
    mode = [...uniqueContexts][0];
  } else if (contexts.includes("meal") && !contexts.includes("entry")) {
    mode = "meal";
  } else if (contexts.includes("entry") && !contexts.includes("meal")) {
    mode = "entry";
  } else if (category === "culture" || category === "nature") {
    mode = contexts.includes("entry") ? "entry" : "mixed";
  } else {
    mode = "mixed";
  }

  let minVal = Math.round(Math.min(...values) / 10) * 10;
  let maxVal = Math.round(Math.max(...values) / 10) * 10;
  if (maxVal < minVal) maxVal = minVal;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const rawMedian = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  let medianVal = Math.round(rawMedian / 10) * 10;

  const sources = new Set(valid.map((s) => s.source));
  const sampleCount = valid.length;
  const sourceCount = sources.size;

  let conf = 0.2;
  if (sampleCount >= 3 && sourceCount >= 2) conf = 0.85;
  else if (sampleCount >= 2 || sourceCount >= 2) conf = 0.65;
  else if (sampleCount === 1) conf = 0.45;

  if (maxVal === 0) {
    mode = "entry";
    minVal = 0;
    medianVal = 0;
  }

  return {
    mode,
    min: minVal,
    max: maxVal,
    per_person: medianVal,
    samples: valid.slice(0, 8),
    confidence: Number(conf.toFixed(2)),
  };
}

export const CATEGORY_TYPICAL_PRICES: Record<
  Category,
  { min: number; max: number; mode: string; basis: string }
> = {
  nature: { min: 0, max: 0, mode: "entry", basis: "Free entry" },
  culture: { min: 20, max: 50, mode: "entry", basis: "₹20–₹50 pp (Typical entry)" },
  food: { min: 150, max: 350, mode: "meal", basis: "₹150–₹350 pp (Casual dining)" },
  adventure: { min: 300, max: 800, mode: "adventure", basis: "₹300–₹800 pp (Typical)" },
  market: { min: 200, max: 800, mode: "item", basis: "₹200–₹800 (Typical)" },
  nightlife: { min: 400, max: 1200, mode: "activity", basis: "₹400–₹1,200 pp (Typical)" },
  workshop: { min: 300, max: 1000, mode: "workshop", basis: "₹300–₹1,000 (Typical)" },
  hidden_gem: { min: 50, max: 200, mode: "entry", basis: "₹50–₹200 pp (Typical)" },
};

export function deriveStopPriceInfo(exp: {
  priceHint?: PriceHint | null;
  pricePerPerson?: number;
  priceIsEstimate?: boolean;
  category?: Category;
}): {
  priceBasis: string;
  priceMin?: number;
  priceMax?: number;
  pricePerPerson?: number;
  priceQuote?: string;
  isCategoryTypical?: boolean;
} {
  if (exp.priceHint) {
    const h = exp.priceHint;
    const min = Math.round(h.min);
    const max = Math.round(h.max);
    const pp = Math.round(h.per_person ?? min);
    let basis = "";
    if (min === 0 && max === 0) {
      basis = "Free entry";
    } else if (h.mode === "entry") {
      basis = min === max ? `entry ₹${min}` : `entry ₹${min}–${max}`;
    } else if (h.mode === "meal") {
      basis = min === max ? `meal ~₹${pp} pp` : `meal ₹${min}–${max} pp`;
    } else if (h.mode === "item") {
      basis = min === max ? `item ~₹${min}` : `item ₹${min}–${max}`;
    } else {
      basis = min === max ? `~₹${pp} pp` : `₹${min}–${max} pp`;
    }
    return {
      priceBasis: basis,
      priceMin: min,
      priceMax: max,
      pricePerPerson: pp,
      priceQuote: h.samples?.[0]?.raw_snippet ?? undefined,
      isCategoryTypical: false,
    };
  }

  if (exp.pricePerPerson !== undefined && exp.pricePerPerson !== null) {
    const val = Math.round(exp.pricePerPerson);
    if (val === 0) {
      return {
        priceBasis: "Free entry",
        priceMin: 0,
        priceMax: 0,
        pricePerPerson: 0,
        isCategoryTypical: false,
      };
    }
    if (!exp.priceIsEstimate) {
      return {
        priceBasis: `~₹${val} pp`,
        priceMin: val,
        priceMax: val,
        pricePerPerson: val,
        isCategoryTypical: false,
      };
    }
  }

  return {
    priceBasis: "Varies on site",
    priceMin: undefined,
    priceMax: undefined,
    pricePerPerson: undefined,
    priceQuote: undefined,
    isCategoryTypical: false,
  };
}
