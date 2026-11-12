import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

// Local dev uses a SQLite file (gitignored). Production points
// TRAVEL_DATABASE_URL at a Turso/libSQL database, since Vercel's filesystem
// doesn't persist.
const DEFAULT_URL = "file:.data/travel.db";

export const EVENT_STATUSES = ["none", "unnecessary", "not_booked", "booked", "transit"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

const SCHEMA = [
  // Logins: scrypt "salt:hash" per username (see lib/auth.ts).
  `CREATE TABLE IF NOT EXISTS travel_users (
    username TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    contribution REAL NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0
  )`,
  // The "Monthly Expenditures Estimate": what a typical visit costs, and who pays.
  `CREATE TABLE IF NOT EXISTS estimates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    cost REAL NOT NULL DEFAULT 0,
    whom TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  )`,
  // One budget year, e.g. 2026-09 through 2027-06.
  `CREATE TABLE IF NOT EXISTS cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_month TEXT NOT NULL,
    end_month TEXT NOT NULL
  )`,
  // A month counts toward a person's pool only once it's unlocked.
  `CREATE TABLE IF NOT EXISTS month_unlocks (
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    unlocked INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (person_id, month)
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    kind TEXT NOT NULL CHECK (kind IN ('travel','visiting')),
    amount REAL NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
    flight_from TEXT NOT NULL DEFAULT '',
    flight_to TEXT NOT NULL DEFAULT '',
    round_trip INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    doc TEXT NOT NULL DEFAULT '',
    view_start_hour INTEGER,
    view_end_hour INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Whole hours on a 12 AM → midnight grid: start 0-23, end 1-24.
  `CREATE TABLE IF NOT EXISTS trip_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    start_hour INTEGER NOT NULL,
    end_hour INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'none'
      CHECK (status IN ('none','unnecessary','not_booked','booked','transit')),
    notes TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    map_link TEXT NOT NULL DEFAULT '',
    reservation_link TEXT NOT NULL DEFAULT '',
    other_link TEXT NOT NULL DEFAULT '',
    lat REAL,
    lng REAL
  )`,
  `CREATE TABLE IF NOT EXISTS trip_days (
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    accommodation TEXT NOT NULL DEFAULT '',
    accommodation_status TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    breakfast TEXT NOT NULL DEFAULT '',
    lunch TEXT NOT NULL DEFAULT '',
    dinner TEXT NOT NULL DEFAULT '',
    cancellation_policy TEXT NOT NULL DEFAULT '',
    stay_link TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (trip_id, date)
  )`,
  `CREATE TABLE IF NOT EXISTS trip_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    item TEXT NOT NULL,
    price REAL,
    cancellation TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    booked INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS trip_ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    group_name TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    link TEXT NOT NULL DEFAULT '',
    price REAL,
    sort INTEGER NOT NULL DEFAULT 0
  )`,
  // The trip page's Ideas list: one line each, dragged onto the calendar when
  // scheduled. (Not trip_ideas: those old rows were folded into trip docs.)
  `CREATE TABLE IF NOT EXISTS trip_idea_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Flights on a transit event, one per traveller. Times are local to each
  // airport ("YYYY-MM-DDTHH:MM"), as printed on the ticket.
  `CREATE TABLE IF NOT EXISTS trip_flights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES trip_events(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    flight_no TEXT NOT NULL DEFAULT '',
    from_code TEXT NOT NULL,
    to_code TEXT NOT NULL,
    depart TEXT NOT NULL,
    arrive TEXT NOT NULL
  )`,
  // A trip's estimated costs: what it's expected to cost, before the real
  // expenses are logged. Not counted in the budget.
  `CREATE TABLE IF NOT EXISTS trip_estimated_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    item TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // The budget page's To do list (also shown on the Trips page). cost is an
  // estimate, null when not guessed yet; trip_id optionally ties it to a trip.
  `CREATE TABLE IF NOT EXISTS travel_todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    cost REAL,
    trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Place lookups (OpenStreetMap Nominatim), kept so each typed location is
  // looked up once. found = 0 remembers a miss.
  `CREATE TABLE IF NOT EXISTS geocode_cache (
    query TEXT PRIMARY KEY,
    found INTEGER NOT NULL,
    lat REAL,
    lng REAL,
    label TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Driving routes between two points (OSRM), keyed "lng,lat;lng,lat".
  `CREATE TABLE IF NOT EXISTS route_cache (
    key TEXT PRIMARY KEY,
    found INTEGER NOT NULL,
    geometry TEXT NOT NULL DEFAULT '',
    distance_m REAL,
    duration_s REAL
  )`,
];

/** Upgrades databases created by earlier versions; safe to run every start. */
async function migrate(client: Client): Promise<void> {
  const cols = await client.execute("PRAGMA table_info(trip_events)");
  const have = new Set(cols.rows.map((r) => String(r.name)));
  for (const col of ["map_link", "reservation_link", "other_link", "location"]) {
    if (!have.has(col)) {
      await client.execute(`ALTER TABLE trip_events ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    }
  }
  // A pin dropped on the map (or a picked suggestion's position): used instead of looking up the location text.
  if (!have.has("lat")) await client.execute("ALTER TABLE trip_events ADD COLUMN lat REAL");
  if (!have.has("lng")) await client.execute("ALTER TABLE trip_events ADD COLUMN lng REAL");
  const expenseCols = await client.execute("PRAGMA table_info(expenses)");
  const haveExp = new Set(expenseCols.rows.map((r) => String(r.name)));
  if (!haveExp.has("flight_from")) await client.execute("ALTER TABLE expenses ADD COLUMN flight_from TEXT NOT NULL DEFAULT ''");
  if (!haveExp.has("flight_to")) await client.execute("ALTER TABLE expenses ADD COLUMN flight_to TEXT NOT NULL DEFAULT ''");
  if (!haveExp.has("round_trip")) await client.execute("ALTER TABLE expenses ADD COLUMN round_trip INTEGER");
  const tripCols = await client.execute("PRAGMA table_info(trips)");
  const haveTrip = new Set(tripCols.rows.map((r) => String(r.name)));
  if (!haveTrip.has("view_start_hour")) await client.execute("ALTER TABLE trips ADD COLUMN view_start_hour INTEGER");
  if (!haveTrip.has("view_end_hour")) await client.execute("ALTER TABLE trips ADD COLUMN view_end_hour INTEGER");
  if (!haveTrip.has("time_zone")) await client.execute("ALTER TABLE trips ADD COLUMN time_zone TEXT NOT NULL DEFAULT ''");
  // 1 = draw this trip's route on the Trips page map (otherwise just its pin).
  if (!haveTrip.has("show_route")) await client.execute("ALTER TABLE trips ADD COLUMN show_route INTEGER NOT NULL DEFAULT 0");
  // 1 = the trip page's map is switched off (for trips where it isn't useful).
  if (!haveTrip.has("hide_map")) await client.execute("ALTER TABLE trips ADD COLUMN hide_map INTEGER NOT NULL DEFAULT 0");
  if (!haveTrip.has("doc")) {
    await client.execute("ALTER TABLE trips ADD COLUMN doc TEXT NOT NULL DEFAULT ''");
    // One-time move of the old "Ideas & links" lists into each trip's doc, so
    // nothing is lost when that section goes away. Runs only as the column is
    // added, so a doc cleared later isn't refilled.
    const ideas = await client.execute("SELECT trip_id, group_name, text, link, price FROM trip_ideas ORDER BY trip_id, sort, id");
    const docs = new Map<number, Map<string, string[]>>();
    for (const r of ideas.rows) {
      const trip = Number(r.trip_id);
      const group = String(r.group_name ?? "").trim() || "Ideas";
      const parts = [String(r.text ?? "").trim()];
      if (r.price != null) parts.push(`$${Number(r.price).toLocaleString("en-US")}`);
      if (r.link) parts.push(String(r.link));
      const groups = docs.get(trip) ?? new Map<string, string[]>();
      groups.set(group, [...(groups.get(group) ?? []), `- ${parts.filter(Boolean).join(" — ")}`]);
      docs.set(trip, groups);
    }
    for (const [trip, groups] of docs) {
      const doc = [...groups.entries()].map(([g, lines]) => `## ${g}\n${lines.join("\n")}`).join("\n\n");
      await client.execute({ sql: "UPDATE trips SET doc = ? WHERE id = ?", args: [doc, trip] });
    }
  }

  const dayCols = await client.execute("PRAGMA table_info(trip_days)");
  const haveDay = new Set(dayCols.rows.map((r) => String(r.name)));
  // Car rental per day mirrors the stay: car = company, car_status "CONFIRMED", car_cancel_by, link, notes.
  // stay_address: the stay's street address, for the map (the name is used when it's blank).
  for (const col of ["breakfast", "lunch", "dinner", "stay_link", "stay_address", "cancel_by", "car", "car_status", "car_cancel_by", "car_link", "car_notes"]) {
    if (!haveDay.has(col)) await client.execute(`ALTER TABLE trip_days ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  }
  if (!haveDay.has("non_refundable")) {
    await client.execute("ALTER TABLE trip_days ADD COLUMN non_refundable INTEGER NOT NULL DEFAULT 0");
  }
  if (!haveDay.has("car_non_refundable")) {
    await client.execute("ALTER TABLE trip_days ADD COLUMN car_non_refundable INTEGER NOT NULL DEFAULT 0");
  }
  if (!haveDay.has("cancellation_policy")) {
    await client.execute("ALTER TABLE trip_days ADD COLUMN cancellation_policy TEXT NOT NULL DEFAULT ''");
    // The "Bookings & costs" list is gone (stays now carry their own
    // cancellation policy). One-time: append each trip's bookings to its doc so
    // the items, prices and cancellation terms aren't lost.
    const rows = await client.execute(
      "SELECT trip_id, item, price, cancellation, notes, booked FROM trip_bookings ORDER BY trip_id, sort, id"
    );
    const byTrip = new Map<number, string[]>();
    for (const r of rows.rows) {
      const parts = [
        String(r.item ?? "").trim(),
        r.price != null ? `$${Number(r.price).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "",
        r.cancellation ? `cancel: ${String(r.cancellation).trim()}` : "",
        String(r.notes ?? "").trim(),
      ].filter(Boolean);
      const line = `- [${Number(r.booked) ? "x" : " "}] ${parts.join(" — ")}`;
      byTrip.set(Number(r.trip_id), [...(byTrip.get(Number(r.trip_id)) ?? []), line]);
    }
    for (const [trip, lines] of byTrip) {
      await client.execute({
        sql: "UPDATE trips SET doc = TRIM(doc || CASE WHEN doc = '' THEN '' ELSE char(10) || char(10) END || ?) WHERE id = ?",
        args: [`## Bookings\n${lines.join("\n")}`, trip],
      });
    }
  }

  // The grid used to run 3 AM → a midnight row (hour 24, ending at 25); it now
  // runs 12 AM → midnight, so anything past the end of the day ends at 24.
  await client.batch(
    [
      "UPDATE trip_events SET start_hour = 23.75 WHERE start_hour > 23.75",
      "UPDATE trip_events SET end_hour = 24 WHERE end_hour > 24",
      "UPDATE trip_events SET end_hour = start_hour + 0.25 WHERE end_hour <= start_hour",
    ],
    "write"
  );
}

type Globals = typeof globalThis & {
  __travelDb?: { client: Client; ready: Promise<void> };
};

function init() {
  const g = globalThis as Globals;
  if (g.__travelDb) return g.__travelDb;

  const url = process.env.TRAVEL_DATABASE_URL || DEFAULT_URL;
  if (url.startsWith("file:")) {
    mkdirSync(dirname(resolve(url.slice("file:".length))), { recursive: true });
  }
  const client = createClient({
    url,
    authToken: process.env.TRAVEL_DATABASE_AUTH_TOKEN,
  });
  const ready = (async () => {
    await client.execute("PRAGMA foreign_keys = ON");
    await client.batch(SCHEMA, "write");
    await migrate(client);
  })();
  // A failed start (e.g. the database briefly unreachable) is retried on the next
  // request, rather than failing every request until the instance restarts.
  ready.catch(() => {
    if (g.__travelDb?.ready === ready) g.__travelDb = undefined;
  });
  g.__travelDb = { client, ready };
  return g.__travelDb;
}

/** Shared libSQL client with the schema guaranteed to exist. */
export async function getTravelDb(): Promise<Client> {
  const { client, ready } = init();
  await ready;
  return client;
}
