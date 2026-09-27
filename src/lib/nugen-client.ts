// ─── Nugen Domain-Aligned AI Client ─────────────────────────────────────────
import type { TripPlan } from "./types";
import type { WeatherVector } from "./weather";

export interface NugenCausalCascadeItem {
  from: string;
  to: string;
  reason: string;
}

export interface NugenAlternative {
  plan: string;
  tradeoff: string;
}

export interface NugenCausalExplanation {
  summary: string;
  cascade: NugenCausalCascadeItem[];
  confidence: number;
  uncertainty_note: string;
  alternatives: NugenAlternative[];
  source: "nugen_aligned" | "groq_fallback" | "heuristic_fallback";
}

export interface NugenReasonPayload {
  task: "explain_twin_simulation" | "recommend_contingency";
  city: string;
  scenario: {
    precipMm?: number;
    tempC?: number;
    windKmh?: number;
    floodLevel?: string;
  };
  originalPlan: TripPlan;
  simulatedPlan: TripPlan;
  weatherVector?: WeatherVector;
  compromisedStops: string[];
  substitutions: Array<{ original: string; substitute: string }>;
}

const NUGEN_SYSTEM_PROMPT = `You are Nugen Domain-Aligned AI™, an expert causal inference model for Indian travel logistics, monsoon weather dynamics, and urban transit pacing.
You analyze how environmental shifts (heavy rain, waterlogging, heatwaves) impact travel itineraries in Indian cities.
Rules:
1. Always preserve meal anchors (breakfast 08:30–09:30 AM, lunch 12:30–02:00 PM). Never cancel food stops.
2. In rain/storms, outdoor forts (e.g. Sinhagad, Nahargarh), waterfalls, and treks must be flagged unsafe and replaced with indoor cultural museums or heritage palaces.
3. Recommend shifting walking legs to metro or auto when rain > 10 mm/hr.
4. Provide honest uncertainty calibration based on forecast confidence.
Output strictly valid JSON with keys:
{
  "summary": "1-2 sentence direct explanation of what changed and why",
  "cascade": [
    { "from": "Original Stop / Mode", "to": "Replacement Stop / Mode", "reason": "concise rationale" }
  ],
  "confidence": 0.85,
  "uncertainty_note": "Uncertainty explanation based on forecast time and spread",
  "alternatives": [
    { "plan": "alternative approach", "tradeoff": "pros vs cons" }
  ]
}`;

/**
 * Calls Nugen Domain-Aligned model or falls back gracefully to Groq Llama 3.3.
 */
export async function queryNugenReasoning(payload: NugenReasonPayload): Promise<NugenCausalExplanation> {
  const nugenKey = process.env.NUGEN_API_KEY;
  const nugenEndpoint = process.env.NUGEN_MODEL_ENDPOINT || "https://api.nugen.in/api/v3/chat/completions";
  const nugenModel = process.env.NUGEN_MODEL || "llama-v3p3-70b-instruct";
  const nugenEnabled = process.env.NUGEN_ENABLED === "true" || !!nugenKey;

  const userContent = JSON.stringify({
    city: payload.city,
    scenario: payload.scenario,
    compromisedStops: payload.compromisedStops,
    substitutions: payload.substitutions,
    days: payload.originalPlan.days.length,
    stopsCount: payload.originalPlan.days.reduce((acc, d) => acc + d.stops.length, 0),
  });

  // 1. Try Nugen endpoint if configured
  if (nugenEnabled && nugenKey) {
    try {
      const res = await fetch(nugenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${nugenKey}`,
        },
        body: JSON.stringify({
          model: nugenModel,
          messages: [
            { role: "system", content: NUGEN_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text);
          return {
            summary: parsed.summary || "Digital Twin scenario analyzed.",
            cascade: Array.isArray(parsed.cascade) ? parsed.cascade : [],
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.85,
            uncertainty_note: parsed.uncertainty_note || "Forecast horizon uncertainty applied.",
            alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
            source: "nugen_aligned",
          };
        }
      }
    } catch {
      // Fall through to Groq
    }
  }

  // 2. Groq Llama 3.3 70B fallback with domain-aligned prompt
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: NUGEN_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text);
          return {
            summary: parsed.summary || "Weather scenario simulation completed.",
            cascade: Array.isArray(parsed.cascade) ? parsed.cascade : [],
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
            uncertainty_note: parsed.uncertainty_note || "Confidence calibrated to 3-hour forecast spread.",
            alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
            source: "groq_fallback",
          };
        }
      }
    } catch {
      // Fall through to deterministic heuristic
    }
  }

  // 3. Guaranteed Deterministic Heuristic Fallback
  const cascade: NugenCausalCascadeItem[] = payload.substitutions.map((s) => ({
    from: s.original,
    to: s.substitute,
    reason: (payload.scenario.precipMm || 0) > 15 ? "Heavy rainfall makes outdoor visit hazardous" : "Midday heat makes indoor shelter preferable",
  }));

  if ((payload.scenario.precipMm || 0) > 10) {
    cascade.push({
      from: "Walk legs",
      to: "Transit / Metro",
      reason: "Rain waterlogging reduces foot transit feasibility",
    });
  }

  return {
    summary:
      payload.substitutions.length > 0
        ? `Adjusted ${payload.substitutions.length} outdoor stop${payload.substitutions.length > 1 ? "s" : ""} to sheltered venues due to ${payload.scenario.precipMm ? `${payload.scenario.precipMm} mm/hr rain` : "weather conditions"}.`
        : "Active itinerary remains fully viable under current weather forecast.",
    cascade,
    confidence: (payload.scenario.precipMm || 0) > 25 ? 0.9 : 0.75,
    uncertainty_note: "Derived from Open-Meteo deterministic WMO indicators.",
    alternatives: [
      {
        plan: "Wait out showers at nearby cafe",
        tradeoff: "Preserves original sights but shifts timeline by 60 min",
      },
      {
        plan: "Move outdoor sights to tomorrow morning",
        tradeoff: "Avoids rain completely but increases Day 2 density",
      },
    ],
    source: "heuristic_fallback",
  };
}
