// ─── Rule-based NLU: transcript → typed Actions (default, offline ladder) ───
import type { Action, Category, Vibe } from "./types";
import { POPULAR_CITIES, geocodeCity } from "./geocode";

interface SessionMemory {
  city?: string;
  lastPlan?: { hoursPerDay: number; days: number; interests?: Category[]; budget?: number; vibe?: Vibe };
  lastFilterCategories?: Category[];
}

const sessions = new Map<string, SessionMemory>();

export function sessionMemory(sessionId: string): SessionMemory {
  let m = sessions.get(sessionId);
  if (!m) {
    m = {};
    sessions.set(sessionId, m);
    if (sessions.size > 500) {
      const first = sessions.keys().next().value;
      if (first) sessions.delete(first);
    }
  }
  return m;
}

const CATEGORY_WORDS: { re: RegExp; cat: Category }[] = [
  { re: /(cafe|coffee|chai|food|eat|restaurant|bakery|street food|breakfast|lunch|dinner|misal|vada|samosa|dessert|sweet)/i, cat: "food" },
  { re: /(fort|palace|museum|temple|heritage|history|historic|culture|cave|monument|art)/i, cat: "culture" },
  { re: /(park|nature|lake|garden|hill|waterfall|sunset|sunrise|outdoor|green)/i, cat: "nature" },
  { re: /(market|bazaar|bazar|shopping|shopping|malls?|souvenir)/i, cat: "market" },
  { re: /(bar|pub|drinks|nightlife|brewery|club)/i, cat: "nightlife" },
  { re: /(adventure|trek|trail|hike|kayak|outdoor adventure)/i, cat: "adventure" },
  { re: /(workshop|class|pottery|craft|learn)/i, cat: "workshop" },
  { re: /(hidden gem|offbeat|secret|lesser known|undiscovered)/i, cat: "hidden_gem" },
];

function extractCategories(t: string): Category[] {
  const out: Category[] = [];
  for (const { re, cat } of CATEGORY_WORDS) if (re.test(t) && !out.includes(cat)) out.push(cat);
  return out;
}

function extractBudget(t: string): number | undefined {
  const m = t.match(/(?:under|below|less than|max(?:imum)?|upto|up to|within|budget of|budget)\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)(k|\s*thousand)?/i)
    ?? t.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)(k)?/i);
  if (!m || !m[1]) return undefined;
  let n = Number(m[1].replace(/,/g, ""));
  if (m[2] || /thousand/i.test(t)) n *= 1000;
  return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n) : undefined;
}

function extractDays(t: string): number | undefined {
  const word: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, "half": 1 };
  const m = t.match(/\b(one|two|three|four|five|(\d+)(?:\.\d+)?)\s*(?:full\s*)?days?\b/i);
  if (!m) return undefined;
  return m[2] ? Number(m[2]) : (word[m[1].toLowerCase()] ?? undefined);
}

function extractHours(t: string): number | undefined {
  const m = t.match(/\b(\d{1,2})(?:\.\d+)?\s*(?:hours|hrs|hr)\b/i);
  return m ? Math.min(Math.max(Number(m[1]), 2), 15) : undefined;
}

function extractTimeOfDay(t: string): string | undefined {
  if (/morning|breakfast|early/i.test(t)) return "morning";
  if (/afternoon|noon|midday|lunch/i.test(t)) return "afternoon";
  if (/evening|golden hour|sunset/i.test(t)) return "evening";
  if (/night|late/i.test(t)) return "night";
  return undefined;
}

function extractVibe(t: string): Vibe | undefined {
  if (/chill|relax|slow|easy/i.test(t)) return "chill";
  if (/pack|see everything|full day|maximi/i.test(t)) return "packed";
  if (/foodie|food tour|eat/i.test(t)) return "foodie";
  if (/heritage|history|culture/i.test(t)) return "heritage";
  return undefined;
}

/** Find a city mentioned in the transcript: known list first, then "in X" pattern, then geocoders. */
export async function extractCity(t: string): Promise<string | undefined> {
  for (const c of POPULAR_CITIES) {
    if (new RegExp(`\\b${c.city.replace(/\s/g, "\\s")}\\b`, "i").test(t)) return c.city;
  }
  const m =
    t.match(/\b(?:in|to|at|for|near|around)\s+((?:[A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+)?)|(?:[a-z][a-z'’]+(?:\s+[a-z][a-z'’]+)?))\b/) ??
    t.match(/^(?:plan|show|find|go)\s+(?:me\s+)?(?:a\s+)?(?:trip|places|things)?.*?\b([A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+)?)\b/);
  const candidate = m?.[1];
  if (!candidate) return undefined;
  const cleaned = candidate
    .replace(/\b(a|an|the|trip|day|plan|places?|food|tour|today|tomorrow|morning|evening|india)\b/gi, "")
    .trim();
  if (cleaned.length < 3 || /day|trip|places?|food|things|hours?/i.test(cleaned)) return undefined;
  const geo = await geocodeCity(cleaned);
  return geo?.city ?? undefined;
}

function ordinalIndex(t: string): number | undefined {
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };
  const m = t.match(/\b(first|second|third|fourth|fifth|sixth|(\d+)(?:st|nd|rd|th)?)\b/i);
  if (!m) return undefined;
  return m[2] ? Number(m[2]) : (words[m[1].toLowerCase()] ?? undefined);
}

export interface NluResult {
  actions: Action[];
  reply: string;
}

export async function parseTranscript(transcript: string, sessionId: string): Promise<NluResult> {
  const t = transcript.trim();
  const low = t.toLowerCase();
  const mem = sessionMemory(sessionId);
  const actions: Action[] = [];
  const replyParts: string[] = [];
  const continueLast = /^(and\s|also\s|then\s)/i.test(t) || /make it|change it|instead/i.test(low);

  // 1. explicit city
  const city = await extractCity(t);
  if (city && city !== mem.city) {
    mem.city = city;
    actions.push({ type: "set_city", city });
    replyParts.push(`Switching to ${city}.`);
  }

  const cats = extractCategories(low);
  const budget = extractBudget(low);
  const timeOfDay = extractTimeOfDay(low);
  const days = extractDays(low);
  const hours = extractHours(low);

  // 2. plan intent
  if (/\b(plan|create|make|build|suggest|show me|give me|i want)\b.*\b(trip|plan|itinerary|day|days)\b/i.test(low) || (/\bplan\b/i.test(low) && /\bfor\b|\bin\b/i.test(low))) {
    const base = mem.lastPlan ?? { hoursPerDay: 8, days: 1 };
    const planIntent = {
      hoursPerDay: hours ?? base.hoursPerDay,
      days: days ?? (continueLast ? base.days : 1),
      interests: cats.length ? cats : base.interests,
      budget: budget ?? base.budget,
      vibe: extractVibe(low) ?? base.vibe,
    };
    mem.lastPlan = planIntent;
    actions.push({
      type: "plan_trip",
      hoursPerDay: planIntent.hoursPerDay,
      days: planIntent.days,
      interests: planIntent.interests,
      budget: planIntent.budget,
      vibe: planIntent.vibe,
    });
    replyParts.push(
      `Planning ${planIntent.days} day${planIntent.days > 1 ? "s" : ""} (${planIntent.hoursPerDay} h/day)${planIntent.interests?.length ? ` focused on ${planIntent.interests.join(", ").replaceAll("_", " ")}` : ""}${planIntent.budget ? ` under ₹${planIntent.budget}` : ""} in ${mem.city ?? "your city"}.`,
    );
  } else if (cats.length || budget !== undefined || timeOfDay) {
    const filters: { categories?: Category[]; budget?: number; timeOfDay?: string; openNow?: boolean; hiddenGem?: boolean } = {};
    if (cats.length) {
      filters.categories = cats;
      mem.lastFilterCategories = cats;
    } else if (continueLast && mem.lastFilterCategories) filters.categories = mem.lastFilterCategories;
    if (budget !== undefined) filters.budget = budget;
    if (timeOfDay) filters.timeOfDay = timeOfDay;
    if (/open now|open right now/i.test(low)) filters.openNow = true;
    if (/hidden gem|offbeat|secret/i.test(low)) filters.hiddenGem = true;
    if (Object.keys(filters).length) {
      actions.push({ type: "apply_filters", ...filters });
      replyParts.push("Filters applied.");
    }
  }

  // 3. stops
  const addM = low.match(/\b(?:add|include)\s+(?:a\s+stop\s+(?:at|for)\s+)?(.+?)(?:\s+to (?:the )?(?:plan|day|trip))?$/);
  if (addM && !/filter|category/i.test(low)) {
    const name = t.slice(t.toLowerCase().indexOf(addM[1]), t.toLowerCase().indexOf(addM[1]) + addM[1].length).replace(/^(a|an|the)\s+/i, "").trim();
    if (name.length > 1) {
      actions.push({ type: "add_stop", name: name.replace(/[.!?]+$/, "") });
      replyParts.push(`Adding ${name}.`);
    }
  }
  const rmM = low.match(/\b(?:remove|drop|skip|delete|take out)\s+(?:the\s+)?(.+?)(?:\s+from (?:the )?(?:plan|day|trip))?$/);
  if (rmM) {
    const name = rmM[1].replace(/^(a|an|the)\s+/i, "").replace(/[.!?]+$/, "").trim();
    actions.push({ type: "remove_stop", name });
    replyParts.push(`Removing ${name}.`);
  }
  const swapM = low.match(/\b(?:swap|move|reorder)\b.*\b(first|second|third|fourth|fifth|(\d+))\b.*\b(?:to|with|after)\b.*\b(first|second|third|fourth|fifth|(\d+))\b/i);
  if (swapM) {
    const from = (ordinalIndex(`${swapM[1]}`) ?? 1) - 1;
    const to = (ordinalIndex(`${swapM[3]}`) ?? 2) - 1;
    actions.push({ type: "reorder", from, to });
    replyParts.push(`Reordered the plan.`);
  }

  // 4. misc intents
  if (/surprise|random|anything good|you pick/i.test(low)) {
    actions.push({ type: "surprise_me" });
    replyParts.push("Rolling the dice on a hidden gem…");
  }
  const cmpM = low.match(/\bcompare\b\s+(?:between\s+)?(.+?)\s+(?:and|vs\.?|versus)\s+(.+)$/i);
  if (cmpM) {
    const names = [cmpM[1].trim(), cmpM[2].replace(/[.?]+$/, "").trim()].map((s) => s.replace(/^(the)\s+/i, ""));
    actions.push({ type: "compare", names });
    replyParts.push(`Comparing ${names.join(" and ")}.`);
  }
  if (/read (my |the )?(plan|day)|read it out|read aloud|say (my|the) plan/i.test(low)) {
    actions.push({ type: "read_day_plan" });
    replyParts.push("Reading your plan aloud.");
  }
  const navM = low.match(/\b(?:navigate to|directions to|take me to|route to|how do i get to)\s+(?:the\s+)?(.+)$/i);
  if (navM) {
    actions.push({ type: "navigate_to", name: navM[1].replace(/[.!?]+$/, "").trim() });
    replyParts.push("Opening directions.");
  }
  if (/weather|rain|hot|cold|temperature/i.test(low)) {
    actions.push({ type: "answer", topic: "weather" });
    replyParts.push("Checking the sky for you.");
  } else if (/best time|when should|golden hour/i.test(low)) {
    actions.push({ type: "answer", topic: "best_time", about: city });
    replyParts.push("Let me tell you the best time to go.");
  } else if (/price|cost|expensive|budget for/i.test(low) && !budget) {
    actions.push({ type: "answer", topic: "price", about: city });
    replyParts.push("Estimating typical prices.");
  } else if (/crowd|busy|queue|packed\b/i.test(low)) {
    actions.push({ type: "answer", topic: "crowd", about: city });
    replyParts.push("Checking the crowd pulse.");
  }

  if (actions.length === 0) {
    return {
      actions: [],
      reply:
        `I heard: “${t}”. Try things like “plan a one-day food trip in Kalyan under ₹500”, “make it two days”, “surprise me”, “compare Cafe X and Cafe Y”, or “what's the weather”.`,
    };
  }
  return { actions, reply: replyParts.join(" ") };
}
