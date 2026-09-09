import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About the data",
  description: "Where Roam's open data comes from, how privacy works, and why there are no fabricated ratings.",
};

const SOURCES: [string, string, string][] = [
  ["OpenStreetMap (Overpass API)", "Places, hours, amenities, walking routes", "ODbL — © OpenStreetMap contributors"],
  ["Wikidata SPARQL", "Structured places + heritage designations", "CC0"],
  ["Wikipedia (en/hi/mr)", "Descriptions, geosearch, 30-day pageviews", "CC BY-SA"],
  ["Wikivoyage", "Community travel listings (Eat/Drink/See/Buy)", "CC BY-SA"],
  ["Wikimedia Commons", "Freely-licensed photos by location", "Free licenses (varied)"],
  ["Reddit RSS + PullPush.io", "Community recommendations & quotes", "Public posts, linked back"],
  ["Google News RSS", "Local buzz around markets/heritage", "Headlines linked to publishers"],
  ["Project Gutenberg / Internet Archive / Wikisource", "Public-domain book quotes", "Public domain"],
  ["GeoNames (country dump)", "Populated-place features", "CC BY 4.0"],
  ["Photon + Nominatim", "Keyless geocoding & POI sweep", "ODbL"],
  ["Open-Meteo", "Weather + sunrise/sunset (golden hour)", "CC BY 4.0"],
  ["OSRM demo server", "Walking route durations + geometry", "ODbL"],
  ["Piped / Invidious proxies", "Video picks & chapter mining — no keys", "Community proxies"],
];

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/" className="text-[13px] font-bold text-primary hover:underline">
        ← Back to Roam
      </Link>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">About the data & your privacy</h1>

      <section className="clay-raised mt-6 p-6">
        <h2 className="text-lg font-bold">The no-fabrication policy</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          Roam has no star ratings because inventing them would be lying. A place with no community signal shows{" "}
          <em>“New — no community signal yet”</em>. Quotes are real sentences from public posts and books, linked to their
          source. Prices marked <em>est.</em> are category heuristics — clearly labeled, never passed off as measured data.
        </p>
      </section>

      <section className="clay-raised mt-4 p-6">
        <h2 className="text-lg font-bold">Privacy: your voice never leaves the device (by default)</h2>
        <ul className="mt-2 space-y-1.5 text-[14px] leading-relaxed text-muted-foreground">
          <li>• Speech recognition runs in your browser (Web Speech API) or, optionally, on-device Whisper via WebGPU.</li>
          <li>• The rule-based NLU is a plain parser — transcripts are processed server-side in memory and not stored.</li>
          <li>• The opt-in WebLLM runs a small open model entirely in your browser; it works offline after download.</li>
          <li>• No accounts, no trackers, no API keys. Saved places and trips live in your browser + this app's local SQLite.</li>
        </ul>
      </section>

      <section className="clay-raised mt-4 p-6">
        <h2 className="text-lg font-bold">Every source, with its license</h2>
        <ul className="mt-3 divide-y divide-border text-[13px]">
          {SOURCES.map(([name, role, license]) => (
            <li key={name} className="flex flex-wrap items-baseline gap-x-3 py-2.5">
              <span className="font-bold">{name}</span>
              <span className="text-muted-foreground">{role}</span>
              <span className="ml-auto rounded-full bg-accent/12 px-2.5 py-0.5 text-[11px] font-bold text-accent">{license}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="clay-raised mt-4 p-6">
        <h2 className="text-lg font-bold">Give back to the map</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          Found a wrong opening hour or a missing place? Every detail card links to{" "}
          <a className="font-semibold text-primary hover:underline" href="https://www.openstreetmap.org" target="_blank" rel="noopener noreferrer">
            OpenStreetMap edit
          </a>{" "}
          — improving OSM improves every open app, including this one.
        </p>
      </section>

      <p className="mt-8 text-[12px] text-muted-foreground">
        Roam is MIT-licensed free software. 100% open data, 100% keyless, 100% free.
      </p>
    </main>
  );
}
