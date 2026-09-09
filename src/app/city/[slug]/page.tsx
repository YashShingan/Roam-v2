import Link from "next/link";
import type { Metadata } from "next";
import { getPlacesForCity } from "@/lib/places-service";
import { CATEGORY_EMOJI, CATEGORY_LABEL } from "@/lib/catalog";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const city = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return {
    title: `${city} — open-data places & community signal`,
    description: `Discover cafes, forts, bazaars and hidden gems in ${city}, India — aggregated live from 13 keyless open-data sources. No fabricated ratings.`,
    alternates: { canonical: `/city/${slug}` },
  };
}

export const dynamic = "force-dynamic";

export default async function CityPage({ params }: Props) {
  const { slug } = await params;
  const city = decodeURIComponent(slug)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  let places: Awaited<ReturnType<typeof getPlacesForCity>>["places"] = [];
  let note: string | null = null;
  try {
    const result = await getPlacesForCity(city, { radiusKm: 15, maxCount: 24 });
    places = result.places;
  } catch (e) {
    note = e instanceof Error ? e.message : "Aggregation failed";
  }

  const byCategory = new Map<string, typeof places>();
  for (const p of places) {
    const arr = byCategory.get(p.category) ?? [];
    arr.push(p);
    byCategory.set(p.category, arr);
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <p className="text-[12px] font-bold uppercase tracking-widest text-primary">Roam · SEO city guide</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Things to do in {city}</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Real places aggregated from OpenStreetMap, Wikipedia, Wikivoyage, Wikidata, Reddit, public-domain books and more —
        ranked by community signal, never fabricated ratings.
      </p>

      <div className="clay-primary mt-5 inline-flex h-11 items-center rounded-2xl px-5 text-sm font-bold">
        <Link href={`/?city=${encodeURIComponent(city)}`}>Open the full app for {city} →</Link>
      </div>

      {note && <p className="clay-raised mt-6 p-4 text-sm text-muted-foreground">{note}</p>}

      {[...byCategory.entries()].map(([cat, items]) => (
        <section key={cat} className="mt-8">
          <h2 className="text-lg font-bold">
            {CATEGORY_EMOJI[cat as keyof typeof CATEGORY_EMOJI]} {CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL]} in {city}
          </h2>
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {items.slice(0, 8).map((p) => (
              <li key={p.id} className="clay-raised-sm p-3.5">
                <p className="font-semibold">{p.name}</p>
                <p className="text-[12px] text-muted-foreground">{p.popularity}</p>
                {p.description && <p className="mt-1 line-clamp-2 text-[12px]">{p.description}</p>}
                <p className="mt-1 text-[11px] text-muted-foreground">Sources: {p.sources.map((s) => s.source).join(", ")}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <footer className="mt-12 border-t border-border pt-4 text-[12px] text-muted-foreground">
        Map data © OpenStreetMap contributors (ODbL) · Wikipedia/Wikivoyage (CC BY-SA) · GeoNames (CC BY 4.0) ·
        Roam shows honest empty signal — no invented ratings.
      </footer>
    </main>
  );
}
