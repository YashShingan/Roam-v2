// ─── Seed-data cleaner ──────────────────────────────────────────────────────
// Applies the production junk gates to the local SQLite store (data/roam.db)
// so a fresh Turso seed starts clean. Every rule mirrors what the pipeline
// already enforces for NEW rows — this backfills the same hygiene onto old
// harvests. A timestamped VACUUM-into backup is taken first; --dry-run shows
// what would go without touching anything.
//
// Usage:
//   npm run clean                 (backup + clean)
//   npm run clean -- --dry-run    (report only)
//   npm run clean -- --from path/to/roam.db

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const argOf = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const DRY = process.argv.includes("--dry-run");
const dbPath = path.resolve(argOf("--from", path.join("data", "roam.db")));

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 15000;");

// ── 0. backup (consistent snapshot, WAL-safe) ────────────────────────────────
if (!DRY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = dbPath.replace(/\.db$/, "") + `.backup-${stamp}.db`;
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  console.log(`backup → ${backupPath}`);
}

const before = db.prepare("SELECT COUNT(*) n FROM places").get().n;

// ── rule inputs ──────────────────────────────────────────────────────────────
const JUNK_NAME = /constituency|lok sabha|vidhan sabha|loco shed|cantonment board|municipal corporation|municipal council|gram panchayat/i;

// bare-geo fragments — keep in sync with src/lib/net.ts BARE_GEO_NAMES
const BARE_GEO_NAMES = new Set(
  (
    "india bharat hindustan asia europe africa america deccan konkan malabar coromandel " +
    "maharashtra karnataka goa kerala rajasthan gujarat punjab haryana odisha orissa " +
    "bihar assam jharkhand chhattisgarh uttarakhand telangana andhra himachal " +
    "mumbai pune kalyan dombivli thane nashik nagpur aurangabad solapur " +
    "delhi bengaluru bangalore chennai kolkata hyderabad jaipur " +
    "varanasi kochi cochin udaipur mysuru mysore indore bhopal surat " +
    "kanpur lucknow patna amritsar ludhiana bhubaneswar coimbatore " +
    "noida gurgaon gurugram faridabad ghaziabad vadodara rajkot"
  ).split(" ").concat([
    // multi-word phrases — split(" ") would shred these into single words
    "new delhi", "west asia", "east asia", "south asia", "southeast asia", "central asia",
    "middle east", "far east", "north india", "south india", "east india", "west india",
    "central india", "northeastern india", "western ghats", "eastern ghats",
    "uttar pradesh", "madhya pradesh", "tamil nadu", "west bengal",
    "south africa", "russia", "china", "japan", "nepal", "sri lanka", "bangladesh", "pakistan", "thailand", "singapore", "malaysia", "indonesia", "dubai", "london", "paris", "tokyo", "sydney", "navi mumbai", "south africa", "sri lanka", "united states", "united kingdom", "south korea", "new zealand", "hong kong", "abu dhabi",
  ]),
  );
const stripPossessive = (n) => n.replace(/[\u2019']s$/i, "").trim();
const isBareGeoFragment = (name) => {
  const n = stripPossessive(name)
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return n.length === 0 || BARE_GEO_NAMES.has(n);
};

// extend the junk-name regex with fuel stations (covers "Indian Oil Fuel
// Filling Station" class rows)

// India bounding box (Roam is India-only; stray foreign scrapes go)
const IN_BBOX = { latMin: 6.0, latMax: 36.0, lonMin: 68.0, lonMax: 98.0 };
// well-known geo names that are never a venue by themselves (only applied to
// rows WITHOUT coords — a mapped node named after a real place is kept)
const KNOWN_GEO = new Set(
  [
    "india", "bharat", "hindustan",
    "mumbai", "pune", "kalyan", "dombivli", "thane", "nashik", "jaipur", "varanasi",
    "kochi", "udaipur", "delhi", "new delhi", "bengaluru", "bangalore", "hyderabad",
    "chennai", "kolkata", "ahmedabad", "mysuru", "mysore", "goa", "surat", "indore",
    "bhopal", "nagpur", "lucknow", "kanpur", "patna", "bhubaneswar", "coimbatore",
    "maharashtra", "karnataka", "tamil nadu", "kerala", "rajasthan", "uttar pradesh",
    "gujarat", "west bengal", "telangana", "andhra pradesh", "madhya pradesh", "bihar",
    "punjab", "haryana", "odisha", "orissa", "assam", "jharkhand", "chhattisgarh",
    "uttarakhand", "himachal pradesh", "jhansi", "gwalior", "amritsar", "shimla",
  ].map((s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")),
);

const STOP_WORDS = new Set(["the", "a", "an", "cafe", "café"]);
function dedupKey(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .sort()
    .join(" ")
    .trim();
}
const rank = (j, sourcesLen) =>
  sourcesLen * 10 + (j.lat !== undefined ? 5 : 0) + (j.popularityScore ?? 0) * 10 + (j.description ? 1 : 0);

// ── pass 1: row-level junk gates ─────────────────────────────────────────────


const rows = db.prepare("SELECT id, city, name, category, json FROM places").all();

// ── pass 0: name normalization (trailing/leading separators from mined titles) ─
const normName = (n) =>
  n
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s\-\u2013\u2014|:;,."]+$/g, "")
    .replace(/^[\s\-\u2013\u2014|:;,."]+/, "")
    .trim();
let renamed = 0;
for (const r of rows) {
  const n = normName(r.name ?? "");
  if (n && n !== r.name) {
    if (!DRY) {
      try {
        const j = JSON.parse(r.json);
        j.name = n;
        db.prepare("UPDATE places SET name = ?, json = ? WHERE id = ?").run(n, JSON.stringify(j), r.id);
      } catch {
        continue;
      }
    }
    r.name = n;
    renamed++;
  }
}
console.log(`names normalized: ${renamed}`);
const drop = new Map(); // id → rule
const keep = [];
for (const r of rows) {
  const dropFor = (rule) => drop.set(r.id, rule);
  let j = null;
  try {
    j = JSON.parse(r.json);
  } catch {
    dropFor("invalid-json");
    continue;
  }
  const name = (r.name ?? "").trim();
  const norm = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const hasCoords = j.lat !== undefined && j.lon !== undefined;

  if (name.length < 3 || !/[a-zA-Z\u0900-\u097F]/.test(name)) dropFor("tiny-name");
  else if (JUNK_NAME.test(name) || /fuel\s*(?:station|pump)|filling\s*station|petrol\s*(?:pump|station)/i.test(name)) dropFor("admin-junk-name");
  else if (isBareGeoFragment(name)) dropFor("bare-geo-fragment");
  else if (/^[\u2018\u2019\u201C\u201D'"]/.test(name) && isBareGeoFragment(name.replace(/^[\u2018\u2019\u201C\u201D'"]+/, ""))) dropFor("quote-fragment");
  else if (/^(cafe|shop|hotel|park|church|temple|restaurant|bar|store|market|garden|museum|art gallery|city of|town of)$/i.test(name.replace(/^[‘’“”'"]+/, "").trim())) dropFor("generic-single-word");
  else if (
    (j.lat === undefined || j.lat === null) &&
    /reddit|news|youtube|books/i.test(String((j.sources ?? []).map((x) => x.source).join("|"))) &&
    /^(culture|hidden_gem|nature|adventure)$/.test(r.category ?? j.category ?? "")
  )
    dropFor("mined-story-fragment");
  else if (/[\u2019']s$/i.test(name) && /^[a-z]/.test(name.trim())) dropFor("possessive-fragment");
  else if (!hasCoords && KNOWN_GEO.has(norm)) dropFor("bare-geo-name");
  else if (!hasCoords && j.category === "hidden_gem" && !j.description) dropFor("coord-less-gem");
  else if (
    hasCoords &&
    (j.lat < IN_BBOX.latMin || j.lat > IN_BBOX.latMax || j.lon < IN_BBOX.lonMin || j.lon > IN_BBOX.lonMax)
  )
    dropFor("outside-india");
  // bare city stub: name equals the bucket city or one of its name parts
  else {
    const parts = new Set(
      r.city
        .toLowerCase()
        .split(/[-\s]+/)
        .filter((p) => p.length > 3),
    );
    if (parts.has(norm) || r.city.toLowerCase() === norm) dropFor("bare-city-stub");
    else keep.push({ r, j });
  }
}

// ── pass 2: exact-name dedupe within each city (keep strongest) ──────────────
const byKey = new Map();
for (const { r, j } of keep) {
  const key = `${r.city.toLowerCase()}|${dedupKey(r.name) || `id:${r.id}`}`;
  const cur = byKey.get(key);
  const rankThis = rank(j, (j.sources ?? []).length);
  if (!cur || rankThis > cur.rank) byKey.set(key, { id: r.id, rank: rankThis, name: r.name });
}
const dupes = new Map(); // id → rule
for (const { r } of keep) {
  const key = `${r.city.toLowerCase()}|${dedupKey(r.name) || `id:${r.id}`}`;
  const best = byKey.get(key);
  if (best && best.id !== r.id) dupes.set(r.id, `duplicate-of:${best.name.slice(0, 40)}`);
}
for (const [id, rule] of dupes) if (!drop.has(id)) drop.set(id, rule);

// ── report + execute ─────────────────────────────────────────────────────────
const byRule = {};
for (const rule of drop.values()) byRule[rule] = (byRule[rule] ?? 0) + 1;
console.log(`\nplaces: ${before} → ${before - drop.size} (dropping ${drop.size})`);
for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${rule}: ${n}`);

if (!DRY && drop.size > 0) {
  const del = db.prepare("DELETE FROM places WHERE id = ?");
  for (const id of drop.keys()) del.run(id);
  // orphaned evidence rows
  const o1 = db.prepare("DELETE FROM place_prices WHERE place_id NOT IN (SELECT id FROM places)").run().changes;
  const o2 = db.prepare("DELETE FROM place_photos WHERE place_id NOT IN (SELECT id FROM places)").run().changes;
  if (o1 || o2) console.log(`orphaned evidence rows removed: prices=${o1} photos=${o2}`);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
  console.log("cleaned + vacuumed.");
}

console.log("\nplaces by city now:");
for (const r of db.prepare("SELECT city, COUNT(*) n FROM places GROUP BY city ORDER BY n DESC").all())
  console.log(`  ${r.city}: ${r.n}`);
