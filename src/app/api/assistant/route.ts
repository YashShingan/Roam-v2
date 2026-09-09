import { NextResponse } from "next/server";
import { z } from "zod";
import { parseTranscript, sessionMemory } from "@/lib/nlu";
import type { Action, AssistantResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  transcript: z.string().min(1).max(1000),
  sessionId: z.string().min(1).max(80),
  nlu: z.enum(["rules", "ollama"]).optional().default("rules"),
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
    interests: z.array(z.string()).optional(),
    budget: z.number().optional(),
    vibe: z.enum(["chill", "packed", "foodie", "heritage"]).optional(),
  }),
  z.object({ type: z.literal("add_stop"), name: z.string().min(1) }),
  z.object({ type: z.literal("remove_stop"), name: z.string().min(1) }),
  z.object({ type: z.literal("reorder"), from: z.number(), to: z.number() }),
  z.object({ type: z.literal("surprise_me") }),
  z.object({ type: z.literal("compare"), names: z.array(z.string()).min(2).max(3) }),
  z.object({ type: z.literal("read_day_plan") }),
  z.object({ type: z.literal("navigate_to"), name: z.string().min(1) }),
  z.object({
    type: z.literal("answer"),
    topic: z.enum(["weather", "best_time", "price", "crowd"]),
    about: z.string().optional(),
  }),
]) as unknown as z.ZodType<Action>;

const OLLAMA_URL = process.env.OLLAMA_URL ?? process.env.NEXT_PUBLIC_OLLAMA_URL;

async function ollamaActions(transcript: string, city?: string): Promise<Action[] | null> {
  if (!OLLAMA_URL) return null;
  try {
    const res = await fetch(`${OLLAMA_URL.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL ?? "llama3.2:3b",
        prompt: `You convert travel requests to JSON actions. Current city: ${city ?? "unknown"}.
Allowed types: set_city{city}, apply_filters{categories?,budget?,timeOfDay?,openNow?,hiddenGem?}, plan_trip{hoursPerDay,days,interests?,budget?,vibe?}, add_stop{name}, remove_stop{name}, reorder{from,to}, surprise_me{}, compare{names[]}, read_day_plan{}, navigate_to{name}, answer{topic,about?}. Categories: food culture nature market nightlife adventure workshop hidden_gem.
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
      // fall through to rules
    }

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
