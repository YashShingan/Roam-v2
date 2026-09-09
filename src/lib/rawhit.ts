// ─── Dependency-free shared collector types (safe for client import) ────────
import { CATEGORIES, type Category } from "./types";

export function validCategory(c?: string): Category | undefined {
  return CATEGORIES.includes(c as Category) ? (c as Category) : undefined;
}

export interface RawHit {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
  address?: string;
  description?: string;
  category?: Category;
  source: string;
  sourceUrl?: string;
  note?: string;
  tags?: string[];
  website?: string;
  openingHoursRaw?: string;
  imageUrl?: string;
  isOutdoor?: boolean;
  wheelchair?: boolean | null;
  kids?: boolean | null;
  osmType?: string;
  osmId?: string;
  popularityScore?: number; // 0..1
  popularityNote?: string;
  mentions?: number;
  upvotes?: number;
  quotes?: { text: string; permalink?: string }[];
  priceHint?: number;
}

export interface GeoCtx {
  city: string;
  label: string;
  lat: number;
  lon: number;
  radiusKm: number;
  /** Streaming hooks used by the background collector (optional everywhere). */
  onProgress?: (source: string, hits: RawHit[]) => void;
  onSourceDone?: (source: string, ok: boolean, count: number) => void;
}

export type Collector = (ctx: GeoCtx) => Promise<RawHit[]>;

export interface HealthEntry {
  name: string;
  ok: boolean;
  latencyMs: number;
  count: number;
  error?: string;
  checkedAt: string;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "place"
  );
}

export function hitId(source: string, name: string, ctxCity: string): string {
  return `x_${slugify(source)}_${slugify(name)}_${slugify(ctxCity)}`.slice(0, 110);
}
