import { NextResponse } from "next/server";
import { z } from "zod";
import { parseTranscript, sessionMemory } from "@/lib/nlu";
import type { Action, AssistantResponse, Category } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  transcript: z.string().min(1).max(1000),
  sessionId: z.string().min(1).max(80),
  nlu: z.enum(["rules", "ollama", "groq", "openrouter"]).optional().default("rules"),
});

const ActionSchema: z.ZodType<Action> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_city"), city: z.string().min(1) }),
  z.object({
    type: z.literal("apply_filters"),
    categories: z.array(z.string()).optional(),
    budget: z.number().optional(),
    timeOfDay: z.string().optional(),
    openNow: z.boolean().optional(),
    hiddenGem: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("plan_trip"),
    hoursPerDay: z.number().min(2).max(15),
    days: z.number().min(1).max(7),
    city: z.string().optional(),
    interests: z.array(z.string()).optional(),
    budget: z.number().optional(),
    vibe: z.enum(["chill", "packed", "foodie", "heritage"]).optional(),
    includeBreakfast: z.boolean().optional(),
    includeLunch: z.boolean().optional(),
    includeDinner: z.boolean().optional(),
    persona: z.enum(["solo", "couple", "family", "group"]).optional(),
    startAnchor: z
      .object({
        type: z.enum(["city", "gps", "place"]),
        label: z.string(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        placeId: z.string().optional(),
      })
      .optional(),
    timeMode: z.enum(["recommended", "capped"]).optional(),
  }),
  z.object({ type: z.literal("add_stop"), name: z.string().min(1) }),
  z.object({ type: z.literal("remove_stop"), name: z.string().min(1) }),
  z.object({ type: z.literal("reorder"), from: z.number(), to: z.number() }),
  z.object({ type: z.literal("surprise_me") }),
  z.object({ type: z.literal("compare"), names: z.array(z.string()).min(2).max(3) }),
  z.object({ type: z.literal("read_day_plan") }),
  z.object({ type: z.literal("navigate_to"), name: z.string().min(1) }),
  z.object({ type: z.literal("adapt_weather"), condition: z.enum(["rain", "heat"]) }),
  z.object({ type: z.literal("running_late"), delayMinutes: z.number().optional() }),
  z.object({
    type: z.literal("answer"),
    topic: z.enum(["weather", "best_time", "price", "crowd"]),
    about: z.string().optional(),
  }),
]) as unknown as z.ZodType<Action>;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL ?? process.env.NEXT_PUBLIC_OLLAMA_URL;

const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "plan_trip",
      description: "Plan a complete multi-stop or multi-day trip itinerary with optimal route, meals, and budget.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City or destination name, e.g. Pune, Kalyan, Mumbai, Jaipur, Badlapur" },
          days: { type: "integer", minimum: 1, maximum: 7, description: "Number of trip days (default 1)" },
          hoursPerDay: { type: "number", minimum: 2, maximum: 15, description: "Hours per day (default 8)" },
          interests: {
            type: "array",
            items: { type: "string", enum: ["food", "culture", "nature", "market", "nightlife", "adventure", "workshop"] },
            description: "Category interests to prioritize"
          },
          budget: { type: "number", description: "Total budget limit in INR (₹)" },
          vibe: { type: "string", enum: ["chill", "packed", "foodie", "heritage"] },
          startAnchorLabel: { type: "string", description: "Specific starting landmark or area, e.g. 'Swargate', 'Pune Station', 'FC Road'" },
          includeBreakfast: { type: "boolean", description: "Whether to slot an authentic breakfast stop (~8:30 AM)" },
          includeLunch: { type: "boolean", description: "Whether to slot a local lunch stop (~1:00 PM)" },
          includeDinner: { type: "boolean", description: "Whether to slot a dinner stop (~8:00 PM)" },
          persona: { type: "string", enum: ["solo", "couple", "family", "group"], description: "Traveler persona for pacing & stamina" },
          timeMode: { type: "string", enum: ["recommended", "capped"], description: "Time scheduling mode" }
        },
        required: ["days"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mutate_itinerary",
      description: "Modify the current itinerary: add stop, remove stop, adapt for weather, adjust for delays.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add_stop", "remove_stop", "adapt_weather", "running_late"] },
          stopName: { type: "string", description: "Name of the place to add or remove" },
          condition: { type: "string", enum: ["rain", "heat"], description: "Weather condition to adapt for" },
          delayMinutes: { type: "integer", description: "Minutes running late to catch up (default 60)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "apply_filters",
      description: "Filter places shown on the map or exploration grid.",
      parameters: {
        type: "object",
        properties: {
          categories: { type: "array", items: { type: "string" } },
          budget: { type: "number" },
          openNow: { type: "boolean" },
          hiddenGem: { type: "boolean" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_city",
      description: "Switch the active explorer city without immediately replanning the entire trip.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "Name of the destination city" }
        },
        required: ["city"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "surprise_me",
      description: "Pick a secret local hidden gem in the current city."
    }
  },
  {
    type: "function",
    function: {
      name: "read_day_plan",
      description: "Read aloud the current day's itinerary plan."
    }
  }
];

async function callAgentLLM(
  transcript: string,
  city?: string,
): Promise<{ actions: Action[]; reply: string; nlu: "groq" | "openrouter" } | null> {
  const isGroq = !!GROQ_API_KEY;
  const isOR = !isGroq && !!OPENROUTER_API_KEY;
  if (!isGroq && !isOR) return null;

  const endpoint = isGroq
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";

  const authHeader = isGroq ? `Bearer ${GROQ_API_KEY}` : `Bearer ${OPENROUTER_API_KEY}`;
  const modelsToTry = isGroq
    ? ([process.env.GROQ_MODEL, "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"].filter(Boolean) as string[])
    : [process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free"];

  const systemMsg = `You are Roam's expert AI travel agent for Indian destinations and local experiences.
Current active city context: ${city || "Pune"}.
The user will speak or type natural travel requests in English, Hinglish, or casual phrasing.
Always decide the appropriate tool call(s) and provide a warm, concise, natural verbal reply acknowledging what you are doing (e.g., "Planning a 2-day relaxed family trip in Pune with lunch on FC road...").
If the user asks a general question about travel, timing, weather, or tips, answer concisely.
Never invent proprietary IDs. When user mentions places, specify them by name.`;

  for (const model of modelsToTry) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemMsg },
            { role: "user", content: transcript },
          ],
          tools: AGENT_TOOLS,
          tool_choice: "auto",
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`Agent LLM API returned status ${res.status} for model ${model}:`, errText);
        continue;
      }

      const data = await res.json();
      const choice = data.choices?.[0]?.message;
      if (!choice) continue;

    const actions: Action[] = [];
    let verbalReply = choice.content || "";

    if (choice.tool_calls && Array.isArray(choice.tool_calls)) {
      for (const tc of choice.tool_calls) {
        const fnName = tc.function?.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function?.arguments || "{}");
        } catch {
          // ignore
        }

        if (fnName === "plan_trip") {
          actions.push({
            type: "plan_trip",
            city: typeof args.city === "string" ? args.city : undefined,
            days: Number(args.days) || 1,
            hoursPerDay: Number(args.hoursPerDay) || 8,
            interests: Array.isArray(args.interests) ? (args.interests as Category[]) : undefined,
            budget: args.budget ? Number(args.budget) : undefined,
            vibe: typeof args.vibe === "string" ? (args.vibe as never) : undefined,
            includeBreakfast: !!args.includeBreakfast,
            includeLunch: !!args.includeLunch,
            includeDinner: !!args.includeDinner,
            persona: typeof args.persona === "string" ? (args.persona as never) : undefined,
            timeMode: typeof args.timeMode === "string" ? (args.timeMode as never) : undefined,
            startAnchor: typeof args.startAnchorLabel === "string" && args.startAnchorLabel
              ? { type: "place", label: args.startAnchorLabel, lat: 0, lon: 0 }
              : undefined,
          });
          if (!verbalReply) {
            const daysNum = Number(args.days) || 1;
            const daysStr = daysNum > 1 ? `${daysNum}-day ` : "day ";
            const destCity = (args.city as string) || city || "your destination";
            verbalReply = `Planning your ${daysStr}route in ${destCity}…`;
          }
        } else if (fnName === "mutate_itinerary") {
          const act = args.action;
          if (act === "add_stop" && typeof args.stopName === "string") {
            actions.push({ type: "add_stop", name: args.stopName });
          } else if (act === "remove_stop" && typeof args.stopName === "string") {
            actions.push({ type: "remove_stop", name: args.stopName });
          } else if (act === "adapt_weather") {
            actions.push({ type: "adapt_weather", condition: args.condition === "heat" ? "heat" : "rain" });
          } else if (act === "running_late") {
            actions.push({ type: "running_late", delayMinutes: Number(args.delayMinutes) || 60 });
          }
          if (!verbalReply) {
            verbalReply = `Updating your itinerary accordingly.`;
          }
        } else if (fnName === "apply_filters") {
          actions.push({
            type: "apply_filters",
            categories: Array.isArray(args.categories) ? (args.categories as Category[]) : undefined,
            budget: typeof args.budget === "number" ? args.budget : undefined,
            openNow: typeof args.openNow === "boolean" ? args.openNow : undefined,
            hiddenGem: typeof args.hiddenGem === "boolean" ? args.hiddenGem : undefined,
          });
          if (!verbalReply) {
            verbalReply = `Filtering places on your map.`;
          }
        } else if (fnName === "set_city" && typeof args.city === "string") {
          actions.push({ type: "set_city", city: args.city });
          if (!verbalReply) {
            verbalReply = `Switched to ${args.city}.`;
          }
        } else if (fnName === "surprise_me") {
          actions.push({ type: "surprise_me" });
          if (!verbalReply) {
            verbalReply = `Finding a secret local hidden gem for you!`;
          }
        } else if (fnName === "read_day_plan") {
          actions.push({ type: "read_day_plan" });
        }
      }
    }

    if (actions.length === 0 && verbalReply) {
      actions.push({ type: "answer", topic: "best_time", about: verbalReply });
    }

    return {
      actions,
      reply: verbalReply || "Got it — updating your plan.",
      nlu: isGroq ? "groq" : "openrouter",
    };
  } catch (err) {
    console.warn(`Agent LLM call failed for model ${model}:`, err);
  }
}
return null;
}

async function ollamaActions(transcript: string, city?: string): Promise<Action[] | null> {
  if (!OLLAMA_URL) return null;
  try {
    const res = await fetch(`${OLLAMA_URL.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL ?? "llama3.2:3b",
        prompt: `You convert travel requests to JSON actions. Current city: ${city ?? "unknown"}.
Allowed types: set_city{city}, apply_filters{categories?,budget?,timeOfDay?,openNow?,hiddenGem?}, plan_trip{hoursPerDay,days,city?,interests?,budget?,vibe?,includeBreakfast?,includeLunch?,includeDinner?,persona?}, add_stop{name}, remove_stop{name}, reorder{from,to}, surprise_me{}, compare{names[]}, read_day_plan{}, navigate_to{name}, adapt_weather{condition}, running_late{delayMinutes?}, answer{topic,about?}. Categories: food culture nature market nightlife adventure workshop hidden_gem.
Reply with ONLY a JSON array of actions. Request: "${transcript}"`,
        stream: false,
        format: "json",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { response?: string };
    const parsed: unknown = JSON.parse(j.response ?? "null");
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const out: Action[] = [];
    for (const a of arr) {
      const r = ActionSchema.safeParse(a);
      if (r.success) out.push(r.data);
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const mem = sessionMemory(body.sessionId);

    // 1. Try Groq / OpenRouter function calling agent first (fastest, most accurate)
    const agentResult = await callAgentLLM(body.transcript, mem.city);
    if (agentResult && agentResult.actions.length > 0) {
      const cityAct = agentResult.actions.find((a): a is Extract<Action, { type: "set_city" }> => a.type === "set_city");
      if (cityAct) mem.city = cityAct.city;
      const planAct = agentResult.actions.find((a): a is Extract<Action, { type: "plan_trip" }> => a.type === "plan_trip");
      if (planAct?.city) mem.city = planAct.city;

      return NextResponse.json({
        actions: agentResult.actions,
        reply: agentResult.reply,
        nlu: agentResult.nlu,
        sessionId: body.sessionId,
      } satisfies AssistantResponse);
    }

    // 2. Try Local Ollama if configured
    if (body.nlu === "ollama" && OLLAMA_URL) {
      const actions = await ollamaActions(body.transcript, mem.city);
      if (actions) {
        const cityAct = actions.find((a): a is Extract<Action, { type: "set_city" }> => a.type === "set_city");
        if (cityAct) mem.city = cityAct.city;
        return NextResponse.json({
          actions,
          reply: `Done — ${actions.length} change${actions.length > 1 ? "s" : ""} applied (local LLM).`,
          nlu: "ollama",
          sessionId: body.sessionId,
        } satisfies AssistantResponse);
      }
    }

    // 3. Fall back to local regex-based NLU ladder
    const { actions, reply } = await parseTranscript(body.transcript, body.sessionId);
    return NextResponse.json({ actions, reply, nlu: "rules", sessionId: body.sessionId } satisfies AssistantResponse);
  } catch (e) {
    return NextResponse.json(
      {
        actions: [],
        reply: "Sorry — I couldn't parse that. Type it instead, or try “plan a one-day food trip in Kalyan under ₹500”.",
        error: e instanceof Error ? e.message : "assistant failed",
        nlu: "rules",
        sessionId: "recovered",
      } satisfies AssistantResponse & { error: string },
      { status: 200 },
    );
  }
}
