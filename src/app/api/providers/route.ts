import { NextResponse } from "next/server";
import { z } from "zod";
import { loadProvidersForCity, saveProviderListing, loadPlacesForCity } from "@/lib/db";
import type { Category, ProviderListing } from "@/lib/types";

export const dynamic = "force-dynamic";

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

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
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
