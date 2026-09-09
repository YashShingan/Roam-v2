// ─── Turso migration + seed ─────────────────────────────────────────────────
// Idempotently migrates every row from the local SQLite store (data/roam.db)
// into Turso. Safe to re-run: rows are upserted by primary key.
//
// Usage (after `turso db create roam`):
//   LIBSQL_URL=libsql://roam-xxx.turso.io LIBSQL_AUTH_TOKEN=... node scripts/seed.mjs
// Optional flags:
//   --from=path/to/roam.db   (default data/roam.db)
//   --check                  (just print remote counts, no writes)
//
// Verify afterwards:
//   turso db shell roam "SELECT city, COUNT(*) FROM places GROUP BY city;"

import { createClient } from "@libsql/client";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const CHECK = process.argv.includes("--check");
// --wipe: DELETE every row from the remote tables first (schema kept), then
// seed fresh. Use when Turso already holds stale/dirty data. The Turso URL
// stays the same — do NOT `turso db destroy` (that changes the URL and breaks
// the env vars in Vercel/Render).
const WIPE = process.argv.includes("--wipe");

const url = process.env.LIBSQL_URL;
const token = process.env.LIBSQL_AUTH_TOKEN;
if (!url) {
  console.error("Missing LIBSQL_URL (and LIBSQL_AUTH_TOKEN) env vars.");
  console.error("Get them via: turso db show roam --url && turso db tokens create roam");
  process.exit(1);
}

const fromPath = path.resolve(arg("--from", path.join("data", "roam.db")));
let local;
try {
  local = new DatabaseSync(fromPath);
} catch (e) {
  console.error(`Cannot open local store ${fromPath}:`, e.message);
  process.exit(1);
}

const remote = createClient({ url, authToken: token || undefined });

const TABLES = [
  { name: "places", pk: "id", cols: ["id", "city", "name", "category", "json", "updated_at"], upsert: ["json", "updated_at"] },
  { name: "trips", pk: "id", cols: ["id", "city", "json", "votes", "created_at"], upsert: ["json", "votes"] },
  { name: "kv", pk: "key", cols: ["key", "value", "updated_at"], upsert: ["value", "updated_at"] },
  { name: "place_prices", pk: null, cols: ["place_id", "value", "value_max", "unit", "context", "currency", "source", "url", "confidence", "captured_at"], upsert: null },
  { name: "search_candidates", pk: null, cols: ["name", "city", "engine", "query", "evidence_url", "status", "reason", "created_at"], upsert: null },
  { name: "place_photos", pk: null, cols: ["place_id", "url", "thumb_url", "license", "attribution", "source_page", "source", "captured_at"], upsert: null },
];

// ensure schema first (same DDL as db/schema.sql)
let ddl;
try {
  ddl = (await import("node:fs")).readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
} catch {
  ddl = null;
}
if (ddl) {
  const stripped = ddl
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = stripped.split(";").map((s) => s.trim()).filter(Boolean);
  await remote.batch(statements.map((sql) => ({ sql, args: [] })), "write");
  console.log(`schema ensured (${statements.length} statements)`);
}

let totalRows = 0;
if (WIPE && !CHECK) {
  await remote.batch(TABLES.map((t) => ({ sql: `DELETE FROM ${t.name}`, args: [] })), "write");
  console.log("🧹 remote tables wiped (schema kept)\n");
}
for (const t of TABLES) {
  let localCount = 0;
  try {
    localCount = local.prepare(`SELECT COUNT(*) n FROM ${t.name}`).get().n;
  } catch {
    console.log(`• ${t.name}: not present locally — skipped`);
    continue;
  }
  const before = await remote.execute(`SELECT COUNT(*) AS n FROM ${t.name}`);
  const beforeN = Number(before.rows[0][0]);

  if (!CHECK && localCount > 0) {
    const rows = local.prepare(`SELECT ${t.cols.join(", ")} FROM ${t.name}`).all();
    const cols = t.cols.join(", ");
    const placeholders = t.cols.map(() => "?").join(", ");
    const sql = t.upsert
      ? `INSERT INTO ${t.name} (${cols}) VALUES (${placeholders}) ON CONFLICT(${t.pk}) DO UPDATE SET ${t.upsert
          .map((c) => `${c}=excluded.${c}`)
          .join(", ")}`
      : `INSERT INTO ${t.name} (${cols}) VALUES (${placeholders})`;
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      await remote.batch(chunk.map((r) => ({ sql, args: t.cols.map((c) => r[c]) })), "write");
    }
  }

  const after = await remote.execute(`SELECT COUNT(*) AS n FROM ${t.name}`);
  const afterN = Number(after.rows[0][0]);
  totalRows += afterN;
  console.log(`• ${t.name}: local=${localCount} remote ${beforeN} → ${afterN}`);
}

const cities = await remote.execute("SELECT city, COUNT(*) AS n FROM places GROUP BY city ORDER BY n DESC");
console.log("\nplaces by city (remote):");
for (const r of cities.rows) console.log(`  ${r[0]}: ${r[1]}`);
console.log(`\n✅ done — ${totalRows} total rows in Turso`);
process.exit(0);
