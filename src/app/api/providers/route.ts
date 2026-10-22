import { NextResponse } from "next/server";
import { z } from "zod";
import {
  loadProvidersForCity,
  loadProvidersForHost,
  saveProviderListing,
  toggleProviderActive,
  deleteProviderListing,
  loadPlacesForCity,
} from "@/lib/db";
import type { Category, ProviderListing } from "@/lib/types";

export const dynamic = "force-dynamic";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const ProviderSchema = z.object({
  city: z.string().min(1).max(80),
  title: z.string().min(3).max(120),
  category: z.enum(["food", "culture", "nature", "market", "nightlife", "adventure", "workshop", "hidden_gem"]),
  hostName: z.string().min(2).max(80),
  contactPhone: z.string().max(30).optional(),
  contactWhatsapp: z.string().max(30).optional(),
  pricePerPerson: z.number().min(0).max(50000).optional(),
  durationMinutes: z.number().min(15).max(720).default(60),
  maxGroupSize: z.number().min(1).max(100).optional(),
  isKidFriendly: z.boolean().default(true),
  isWheelchairAccessible: z.boolean().default(false),
  description: z.string().min(10).max(2000),
  availabilitySlots: z.array(z.string()).default([]),
  imageUrl: z.string().optional(),
  address: z.string().max(200).optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

function isValidIndianPhone(phone?: string): boolean {
  if (!phone) return true;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return true;
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]/.test(digits.slice(2))) return true;
  if (digits.length === 11 && digits.startsWith("0") && /^[6-9]/.test(digits.slice(1))) return true;
  return false;
}

const SPAM_REGEX = /(crypto|bitcoin|forex|lottery|free\s*cash|wire\s*transfer|escort|telegram\s*@|whatsapp\s*group\s*link)/i;

async function moderateListingWithAI(data: z.infer<typeof ProviderSchema>): Promise<{ safe: boolean; notes: string }> {
  // 1. Fast heuristics
  if (SPAM_REGEX.test(data.title) || SPAM_REGEX.test(data.description)) {
    return { safe: false, notes: "Listing contains prohibited promotional keywords or spam signals." };
  }

  if (data.contactPhone && !isValidIndianPhone(data.contactPhone)) {
    return { safe: false, notes: "Contact phone must be a valid 10-digit Indian mobile number." };
  }

  if (data.contactWhatsapp && !isValidIndianPhone(data.contactWhatsapp)) {
    return { safe: false, notes: "WhatsApp number must be a valid 10-digit Indian mobile number." };
  }

  if (data.pricePerPerson !== undefined && data.pricePerPerson > 25000) {
    return { safe: false, notes: "Listing price exceeds reasonable threshold (₹25,000 max for community experiences)." };
  }

  // 2. Groq AI moderation guardrail
  if (GROQ_API_KEY) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content:
                "You are the Trust & Safety AI Guardian for Roam, a verified local experience platform in India. " +
                "Evaluate the host's experience listing for safety, authenticity, realistic tourist activities, and absence of scams/fraud/prohibited content. " +
                "Return valid JSON ONLY in this format: {\"safe\": boolean, \"notes\": \"brief reason or badge endorsement\"}. Do not include markdown ticks.",
            },
            {
              role: "user",
              content: JSON.stringify({
                title: data.title,
                category: data.category,
                city: data.city,
                description: data.description,
                pricePerPerson: data.pricePerPerson,
                durationMinutes: data.durationMinutes,
              }),
            },
          ],
          temperature: 0.1,
          max_tokens: 150,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content?.trim() || "";
        const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (typeof parsed.safe === "boolean") {
          return {
            safe: parsed.safe,
            notes: parsed.notes || (parsed.safe ? "AI Verified Authentic Local Experience" : "Content safety review flagged"),
          };
        }
      }
    } catch (err) {
      console.warn("[providers] AI moderation fallback to heuristics:", err);
    }
  }

  return { safe: true, notes: "Verified Local Host (Automated heuristic guardrails passed)" };
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const host = sp.get("hostPhone") || sp.get("host") || "";
    if (host) {
      const providers = await loadProvidersForHost(host);
      return NextResponse.json({ providers });
    }

    const city = sp.get("city")?.trim() || "";
    if (!city) {
      return NextResponse.json({ error: "City query param required" }, { status: 400 });
    }

    const providers = await loadProvidersForCity(city);
    const storedPlaces = await loadPlacesForCity(city.toLowerCase(), 500);

    // Compute Provider Demand Radar & Traveler Intelligence for this city
    const categoryCounts: Record<string, number> = {};
    let kidFriendlyCount = 0;
    let wheelchairCount = 0;
    let prices: number[] = [];

    for (const p of storedPlaces) {
      categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
      if (p.goodForKids) kidFriendlyCount++;
      if (p.wheelchairAccessible) wheelchairCount++;
      if (p.pricePerPerson && p.pricePerPerson > 0) prices.push(p.pricePerPerson);
      if (p.priceHint && p.priceHint.min > 0) prices.push(p.priceHint.min);
    }

    const totalPlaces = Math.max(storedPlaces.length, 1);
    const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 250;

    const demandRadar = {
      city,
      totalListings: providers.length,
      categoryDistribution: categoryCounts,
      kidFriendlyDemandPct: Math.round((kidFriendlyCount / totalPlaces) * 100) || 45,
      wheelchairDemandPct: Math.round((wheelchairCount / totalPlaces) * 100) || 20,
      suggestedPriceSweetSpot: {
        min: Math.max(50, Math.round(avgPrice * 0.6 / 10) * 10),
        max: Math.round(avgPrice * 1.5 / 10) * 10,
        currency: "INR",
      },
      topUnmetCategories: ["workshop", "food", "adventure"].filter((c) => (categoryCounts[c] || 0) < 5),
      marketInsight: `Travelers visiting ${city} are actively seeking authentic food tours, heritage workshops, and family-friendly experiences with local guides.`,
    };

    return NextResponse.json({ providers, demandRadar });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load provider listings" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const data = ProviderSchema.parse(raw);

    // Run AI content moderation screen
    const moderation = await moderateListingWithAI(data);
    if (!moderation.safe) {
      return NextResponse.json(
        {
          ok: false,
          error: `Listing rejected by Trust & Safety Guardian: ${moderation.notes}`,
          flagged: true,
          moderationNotes: moderation.notes,
        },
        { status: 422 },
      );
    }

    const provider: ProviderListing = {
      id: `pv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      city: data.city,
      title: data.title,
      category: data.category as Category,
      hostName: data.hostName,
      contactPhone: data.contactPhone || undefined,
      contactWhatsapp: data.contactWhatsapp || undefined,
      pricePerPerson: data.pricePerPerson,
      durationMinutes: data.durationMinutes,
      maxGroupSize: data.maxGroupSize,
      isKidFriendly: data.isKidFriendly,
      isWheelchairAccessible: data.isWheelchairAccessible,
      description: data.description,
      availabilitySlots: data.availabilitySlots.length ? data.availabilitySlots : ["Morning (10:00 AM)", "Afternoon (03:00 PM)"],
      imageUrl: data.imageUrl || undefined,
      address: data.address || undefined,
      lat: data.lat,
      lon: data.lon,
      createdAt: Date.now(),
      isActive: true,
      reviewStatus: "verified",
      moderationNotes: moderation.notes,
      inquiriesCount: 0,
      reportCount: 0,
    };

    await saveProviderListing(provider);

    return NextResponse.json({ ok: true, provider }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid provider data" },
      { status: 400 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const raw = await req.json();
    const { id, isActive } = raw as { id?: string; isActive?: boolean };
    if (!id || typeof isActive !== "boolean") {
      return NextResponse.json({ error: "Missing listing id or isActive status" }, { status: 400 });
    }

    await toggleProviderActive(id, isActive);
    return NextResponse.json({ ok: true, id, isActive });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update listing status" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const id = sp.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing listing id" }, { status: 400 });
    }

    await deleteProviderListing(id);
    return NextResponse.json({ ok: true, deleted: id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete provider listing" },
      { status: 500 },
    );
  }
}
