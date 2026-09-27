import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const FALLBACK_THOUGHTS: Record<string, string[]> = {
  pune: [
    "Sinhagad Fort winds are crisp today — don't forget kanda bhajji!",
    "Cafe Goodluck's bun maska is calling my name ☕",
    "Did you know Shaniwar Wada was the seat of the Peshwas in 1732?",
    "Pataleshwar's rock carvings are pure ancient magic.",
    "A 20-minute rest buffer between stops keeps fatigue low!",
    "FC Road evening vibes are unmatched. Let's explore!",
  ],
  mumbai: [
    "Sunset at Marine Drive hits different with fresh sea breeze.",
    "Historic Irani cafes in Fort have century-old recipes 🥐",
    "Gateway of India looks majestic at golden hour.",
    "Colaba causeway alleys are packed with brass antiques.",
    "Walking between South Mumbai heritage buildings is a breeze.",
  ],
  default: [
    "Where should we explore next? I'm ready to roam!",
    "Zero sponsored traps here — only verified community signals.",
    "Click me anytime to speak your wishlist aloud!",
    "Remember to stay hydrated and pace your afternoon walk.",
    "Drag me anywhere on your screen — I love the view from up here!",
  ],
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      city?: string;
      context?: "idle" | "day_plan_open" | "replan_completed" | "weather_sim";
      stopsCount?: number;
      weatherLabel?: string;
      tempC?: number;
    };

    const city = body.city || "Pune";
    const cityKey = city.toLowerCase().includes("mumbai")
      ? "mumbai"
      : city.toLowerCase().includes("pune")
      ? "pune"
      : "default";

    // Fast-path offline fallback if GROQ_API_KEY is not configured
    if (!GROQ_API_KEY) {
      const pool = FALLBACK_THOUGHTS[cityKey] || FALLBACK_THOUGHTS.default;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return NextResponse.json({ thought: pick, source: "fallback" });
    }

    // Context-sensitive prompt injection
    let contextHint = `Traveling in ${city}.`;
    if (body.context === "day_plan_open") {
      contextHint += ` The traveler just opened their day plan (${body.stopsCount || 0} stops). Peeking at the schedule.`;
    } else if (body.weatherLabel) {
      contextHint += ` Current weather is ${body.weatherLabel} (${body.tempC ?? 26}°C).`;
    }

    const systemPrompt = `You are Roamy, a tiny witty 3D robot companion on the Roam travel app in India.
Generate ONE playful, authentic, 1-sentence thought (MAX 14 WORDS) for the traveler.
Be hyper-local, warm, and charming (referencing chai, local lore, pacing, or ${city}).
Never sound like a generic AI assistant. Zero hashtags. Output ONLY the thought sentence.`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contextHint },
        ],
        temperature: 0.8,
        max_tokens: 45,
      }),
      signal: AbortSignal.timeout(4500),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text && text.length > 5 && text.length < 140) {
        // Strip wrapping quotes if any
        const cleaned = text.replace(/^["']|["']$/g, "");
        return NextResponse.json({ thought: cleaned, source: "groq" });
      }
    }

    // Fallback on timeout or API error
    const pool = FALLBACK_THOUGHTS[cityKey] || FALLBACK_THOUGHTS.default;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return NextResponse.json({ thought: pick, source: "fallback" });
  } catch {
    return NextResponse.json({
      thought: "Where should we roam next? Click me to plan!",
      source: "fallback",
    });
  }
}
