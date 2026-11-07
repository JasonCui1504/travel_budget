// Loads .data/travel-import.json (from extract-xlsx.py) into the travel
// database. Uses TRAVEL_DATABASE_URL / TRAVEL_DATABASE_AUTH_TOKEN from
// .env.local when set, so the same script fills Turso at deploy time;
// otherwise the local .data/travel.db file.
//
//   node scripts/import.mjs            # refuses if data already exists
//   node scripts/import.mjs --replace  # wipes and re-imports
import { createClient } from "@libsql/client";
import { existsSync, readFileSync } from "fs";

// --env <file> reads the database settings from another file (e.g. the
// production Turso credentials in .env.travel-prod) instead of .env.local.
const envArg = process.argv.indexOf("--env");
const envFile = envArg > -1 ? process.argv[envArg + 1] : ".env.local";
const env = Object.fromEntries(
  (existsSync(envFile) ? readFileSync(envFile, "utf8") : "")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, "")])
);
if (envArg > -1 && !/^libsql:\/\//.test(env.TRAVEL_DATABASE_URL ?? "")) {
  console.error(`${envFile} needs TRAVEL_DATABASE_URL (libsql://…) and TRAVEL_DATABASE_AUTH_TOKEN.`);
  process.exit(1);
}
const url = env.TRAVEL_DATABASE_URL || "file:.data/travel.db";
const db = createClient({ url, authToken: env.TRAVEL_DATABASE_AUTH_TOKEN });
const data = JSON.parse(readFileSync(".data/travel-import.json", "utf8"));
const replace = process.argv.includes("--replace");

// The app creates the schema on first request; here it's needed before that,
// so run the same CREATE TABLE statements, read straight from db.ts.
const schema = readFileSync("lib/db.ts", "utf8")
  .match(/`CREATE TABLE[\s\S]*?\)`/g)
  .map((s) => s.slice(1, -1));
await db.batch(schema, "write");

const existing = await db.execute("SELECT COUNT(*) AS n FROM trips");
if (Number(existing.rows[0].n) > 0 && !replace) {
  console.error("Database already has trips; pass --replace to wipe and re-import.");
  process.exit(1);
}
if (replace) {
  for (const t of ["estimates", "trip_ideas", "trip_bookings", "trip_days", "trip_events", "expenses", "trips", "month_unlocks", "people", "cycles"]) {
    await db.execute(`DELETE FROM ${t}`);
  }
}

await db.execute({
  sql: "INSERT INTO cycles (start_month, end_month) VALUES (?, ?)",
  args: [data.cycle.start_month, data.cycle.end_month],
});
for (const [i, e] of (data.estimates ?? []).entries()) {
  await db.execute({
    sql: "INSERT INTO estimates (category, cost, whom, sort) VALUES (?, ?, ?, ?)",
    args: [e.category, e.cost, e.whom, i],
  });
}
const personId = {};
for (const p of data.people) {
  const rs = await db.execute({
    sql: "INSERT INTO people (slug, name, contribution, sort) VALUES (?, ?, ?, ?) RETURNING id",
    args: [p.slug, p.name, p.contribution, p.sort],
  });
  personId[p.slug] = Number(rs.rows[0].id);
}
await db.batch(
  data.unlocks.map((u) => ({
    sql: "INSERT INTO month_unlocks (person_id, month, unlocked) VALUES (?, ?, ?)",
    args: [personId[u.person], u.month, u.unlocked ? 1 : 0],
  })),
  "write"
);
await db.batch(
  data.expenses.map((e) => ({
    sql: "INSERT INTO expenses (person_id, month, category, kind, amount, notes) VALUES (?, ?, ?, ?, ?, ?)",
    args: [personId[e.person], e.month, e.category, e.kind, e.amount, e.notes],
  })),
  "write"
);
// A trip's ideas become its doc: a heading per group, a bullet per idea.
function ideasDoc(ideas) {
  const groups = new Map();
  for (const x of ideas) {
    const g = x.group?.trim() || "Ideas";
    const parts = [x.text?.trim(), x.price != null ? `$${Number(x.price).toLocaleString("en-US")}` : "", x.link];
    groups.set(g, [...(groups.get(g) ?? []), `- ${parts.filter(Boolean).join(" — ")}`]);
  }
  return [...groups.entries()].map(([g, lines]) => `## ${g}\n${lines.join("\n")}`).join("\n\n");
}

// Bookings (item, price, cancellation terms) become a to-do section of the doc.
function bookingsDoc(bookings) {
  if (!bookings.length) return "";
  const lines = bookings.map((b) => {
    const parts = [b.item, b.price != null ? `$${Number(b.price).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "", b.cancellation ? `cancel: ${b.cancellation}` : "", b.notes];
    return `- [ ] ${parts.filter(Boolean).join(" — ")}`;
  });
  return `## Bookings\n${lines.join("\n")}`;
}

for (const t of data.trips) {
  const rs = await db.execute({
    sql: "INSERT INTO trips (name, start_date, end_date, done, doc) VALUES (?, ?, ?, ?, ?) RETURNING id",
    args: [t.name, t.start_date, t.end_date, t.done ? 1 : 0, [ideasDoc(t.ideas), bookingsDoc(t.bookings)].filter(Boolean).join("\n\n")],
  });
  const id = Number(rs.rows[0].id);
  const stmts = [
    ...t.events.map((e) => ({
      sql: "INSERT INTO trip_events (trip_id, date, start_hour, end_hour, title, status) VALUES (?, ?, ?, ?, ?, ?)",
      args: [id, e.date, e.start_hour, e.end_hour, e.title, e.status],
    })),
    ...Object.entries(t.days).map(([date, d]) => ({
      sql: "INSERT INTO trip_days (trip_id, date, accommodation, accommodation_status, notes) VALUES (?, ?, ?, ?, ?)",
      args: [id, date, d.accommodation ?? "", d.accommodation_status ?? "", d.notes ?? ""],
    })),
  ];
  if (stmts.length) await db.batch(stmts, "write");
}
console.log(`Imported into ${url.startsWith("file:") ? url : "Turso"}: ${data.trips.length} trips, ${data.expenses.length} expenses.`);
