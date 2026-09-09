import { NextResponse } from "next/server";
import { getJson, cached } from "@/lib/net";

export const dynamic = "force-dynamic";

interface WikiSearch {
  query?: { geosearch?: { pageid: number; title: string; lat: number; lon: number; dist: number }[] };
}
interface WikiSummary {
  extract?: string;
  thumbnail?: { source: string };
  content_urls?: { desktop?: { page?: string } };
  title?: string;
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const lat = Number(sp.get("lat"));
    const lon = Number(sp.get("lon"));
    const name = (sp.get("name") ?? "").trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) {
      return NextResponse.json({ error: "lat, lon and name are required" }, { status: 400 });
    }
    const summary = await cached(`wiki-enrich:${name.toLowerCase()}:${lat.toFixed(3)}`, async () => {
      // 1) geosearch near the place, 2) prefer title match, 3) fetch REST summary
      const s = await getJson<WikiSearch>(
        `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=1000&gslimit=10&format=json&formatversion=2`,
        { timeoutMs: 10000, retries: 1, headers: { "Api-User-Agent": "RoamApp/1.0" } },
      );
      const pages = s.query?.geosearch ?? [];
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const target =
        pages.find((p) => p.title.toLowerCase().replace(/[^a-z0-9]/g, "").includes(key)) ??
        pages.find((p) => key.includes(p.title.toLowerCase().replace(/[^a-z0-9]/g, ""))) ??
        pages[0];
      if (!target) return null;
      const sum = await getJson<WikiSummary>(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(target.title.replaceAll(" ", "_"))}`,
        { timeoutMs: 10000, retries: 1 },
      );
      return sum.extract ? { extract: sum.extract, thumbnail: sum.thumbnail?.source, url: sum.content_urls?.desktop?.page, title: sum.title } : null;
    });
    if (!summary) return NextResponse.json({ extract: null, note: "No Wikipedia article matched" });
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "wiki enrichment failed" },
      { status: 502 },
    );
  }
}
