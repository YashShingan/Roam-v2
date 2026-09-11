import { NextResponse } from "next/server";
import { getPlacesForCity } from "@/lib/places-service";
import type { CityStats } from "@/lib/types";
import { sanitizeApiBase } from "@/lib/live-backend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ON_VERCEL = process.env.VERCEL === "1";
const BACKEND = sanitizeApiBase(process.env.API_URL || process.env.NEXT_PUBLIC_API_URL);

export async function GET(req: Request) {
  try {
    const city = new URL(req.url).searchParams.get("city") ?? "";
    if (!city.trim()) return NextResponse.json({ error: "Missing ?city=" }, { status: 400 });

    // Proxy to Render when on Vercel
    if (ON_VERCEL && BACKEND) {
      try {
        const upstream = await fetch(
          `${BACKEND}/api/stats?city=${encodeURIComponent(city)}`,
          { cache: "no-store", signal: AbortSignal.timeout(55_000) },
        );
        const data = await upstream.json();
        return NextResponse.json(data, { status: upstream.status });
      } catch {
        // Render cold/down → fall through to local computation
      }
    }

    const { places, cityLabel } = await getPlacesForCity(city, {});

    const byCategory: Record<string, number> = {};
    const sourceCount = new Map<string, number>();
    const mentionMap = new Map<string, number>();
    let mentionsTotal = 0;
    let priceSum = 0;
    let priceN = 0;
    const buckets: Record<string, number> = { "very negative": 0, negative: 0, neutral: 0, positive: 0, "very positive": 0 };

    for (const p of places) {
      byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
      for (const s of p.sources) sourceCount.set(s.source, (sourceCount.get(s.source) ?? 0) + 1);
      if (p.community.mentions > 0) {
        mentionsTotal += p.community.mentions;
        mentionMap.set(p.name, p.community.mentions);
      }
      if (p.pricePerPerson !== undefined && p.pricePerPerson > 0) {
        priceSum += p.pricePerPerson;
        priceN++;
      }
      const s = p.community.sentiment;
      const bucket =
        s <= -0.5 ? "very negative" : s < -0.05 ? "negative" : s <= 0.05 ? "neutral" : s < 0.5 ? "positive" : "very positive";
      if (p.community.mentions > 0 || p.community.quotes.length > 0) buckets[bucket]++;
    }

    const radarCats = ["food", "culture", "nature", "market", "adventure", "hidden gem"];
    const radar = radarCats.map((label) => {
      const key = label.replaceAll(" ", "_");
      const n = byCategory[key] ?? 0;
      const signal = Math.min(n / Math.max(places.length / 6, 4), 1);
      const variety = Math.min(
        places.filter((p) => p.category === key && p.sources.length >= 2).length / Math.max(n, 1),
        1,
      );
      return { category: label, signal: Number(signal.toFixed(2)), variety: Number(variety.toFixed(2)) };
    });

    const stats: CityStats = {
      city: cityLabel,
      total: places.length,
      byCategory,
      mentionsTotal,
      sentimentHistogram: Object.entries(buckets).map(([bucket, count]) => ({ bucket, count })),
      topMentioned: [...mentionMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, mentions]) => ({ name, mentions })),
      sourceCounts: [...sourceCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([source, count]) => ({ source, count })),
      radar,
      avgPrice: priceN > 0 ? Math.round(priceSum / priceN) : undefined,
    };
    return NextResponse.json(stats);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "stats failed" },
      { status: 502 },
    );
  }
}
