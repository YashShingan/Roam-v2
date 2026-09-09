// Nightly harvester: bulk-fill SQLite for a list of cities.
// Usage: node scripts/harvest.mjs [baseUrl]  (default http://localhost:3000)
// Cities via HARVEST_CITIES env (comma-separated) or the default list.
// Triggers the (uncapped, minutes-long) background scrape per city, then polls
// GET /api/collect?city= until it finishes.

const BASE = process.argv[2] ?? process.env.HARVEST_BASE ?? "http://localhost:3000";
const CITIES = (process.env.HARVEST_CITIES ?? "Mumbai,Pune,Kalyan,Thane,Nashik,Jaipur,Varanasi,Kochi,Udaipur,Delhi,Bengaluru,Hyderabad,Chennai,Kolkata,Ahmedabad").split(",");
const POLL_MS = 10000;
const TIMEOUT_MS = 12 * 60 * 1000; // uncapped sweep — give it room

const token = process.env.COLLECT_TOKEN;
let failed = 0;
for (const city of CITIES) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ city, token }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? res.status);
    // poll until the background scrape finishes
    let state = null;
    while (Date.now() - t0 < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const s = await fetch(`${BASE}/api/collect?city=${encodeURIComponent(j.city ?? city)}`);
      const sj = await s.json();
      state = sj.state;
      if (!state || state.status !== "running") break;
    }
    const dur = Math.round((Date.now() - t0) / 1000);
    if (state?.status === "done") {
      console.log(`✓ ${city}: ${state.places} places (+${state.added} new) in ${dur}s`);
    } else if (state?.status === "error") {
      throw new Error(state.error ?? "scrape failed");
    } else {
      console.error(`⏳ ${city}: still running after ${dur}s — will finish server-side`);
    }
  } catch (e) {
    failed++;
    console.error(`✗ ${city}: ${e.message}`);
  }
}
process.exit(failed > CITIES.length / 2 ? 1 : 0);
