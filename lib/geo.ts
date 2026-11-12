import type { Client } from "@libsql/client";

// Place lookups and driving routes for the trip maps and weather, from free
// OpenStreetMap services (no API key): Nominatim for places, the OSRM demo
// server for roads. Every answer is cached in the travel database, so each
// typed location and each leg is fetched once, and lookups are rationed per
// request (Nominatim asks for at most one a second).

const UA = "travel.jascui.com travel planner (https://travel.jascui.com)";
/** Legs longer than this (straight line) are drawn as flights, not driven. */
const FLIGHT_KM = 800;

export type Point = { lat: number; lng: number };
export type Stop = Point & {
  trip_id: number;
  date: string;
  start_hour: number;
  location: string;
  titles: string[];
  /** A night's stay (from the day's accommodation) rather than an event. */
  hotel?: boolean;
  /** A stop spanning days (a stay ending one day and starting the next): its last day. */
  until?: string;
};
export type Leg = {
  trip_id: number;
  date: string;
  from: string;
  to: string;
  mode: "drive" | "flight" | "straight";
  /** [lat, lng] pairs. */
  path: [number, number][];
  km: number;
  minutes: number | null;
};
export type MapData = { stops: Stop[]; legs: Leg[]; missing: string[]; pending: number };

type EventRow = { trip_id: number; date: string; start_hour: number; title: string; location: string; hotel?: boolean };

const norm = (q: string) => q.trim().replace(/\s+/g, " ").toLowerCase();
const nextDay = (d: string) => new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function km(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Cached places for these queries; a query missing from the map hasn't been looked up yet. */
async function cachedPlaces(db: Client, queries: string[]): Promise<Map<string, Point | null>> {
  const keys = [...new Set(queries.map(norm))].filter(Boolean);
  const out = new Map<string, Point | null>();
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const rs = await db.execute({
      sql: `SELECT query, found, lat, lng FROM geocode_cache WHERE query IN (${chunk.map(() => "?").join(",")})`,
      args: chunk,
    });
    for (const r of rs.rows) {
      out.set(String(r.query), Number(r.found) ? { lat: Number(r.lat), lng: Number(r.lng) } : null);
    }
  }
  return out;
}

async function lookUpPlace(db: Client, query: string): Promise<Point | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const hit = hits[0];
  const point = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  await db.execute({
    sql: `INSERT OR REPLACE INTO geocode_cache (query, found, lat, lng, label) VALUES (?, ?, ?, ?, ?)`,
    args: [norm(query), point ? 1 : 0, point?.lat ?? null, point?.lng ?? null, hit?.display_name ?? ""],
  });
  return point;
}

/** Places for these locations, looking up at most `budget` new ones (about a second each). */
export async function places(db: Client, locations: string[], budget: number) {
  const found = await cachedPlaces(db, locations);
  let pending = 0;
  let first = true;
  for (const loc of [...new Set(locations.map(norm))]) {
    if (!loc || found.has(loc)) continue;
    if (budget <= 0) {
      pending++;
      continue;
    }
    budget--;
    if (!first) await sleep(1100);
    first = false;
    try {
      found.set(loc, await lookUpPlace(db, loc));
    } catch {
      pending++; // Network trouble: try again on the next request.
    }
  }
  return { get: (loc: string) => found.get(norm(loc)), pending };
}

const key = (a: Point, b: Point) => `${a.lng.toFixed(5)},${a.lat.toFixed(5)};${b.lng.toFixed(5)},${b.lat.toFixed(5)}`;

type Route = { path: [number, number][]; km: number; minutes: number };

/**
 * A driving route between two points, from the cache or (when allowed) OSRM;
 * null = no road route, undefined = not fetched yet. `fetched` says whether a
 * request was spent.
 */
async function drive(db: Client, a: Point, b: Point, fetchAllowed: boolean): Promise<{ route: Route | null | undefined; fetched: boolean }> {
  const k = key(a, b);
  const rs = await db.execute({ sql: "SELECT found, geometry, distance_m, duration_s FROM route_cache WHERE key = ?", args: [k] });
  if (rs.rows.length) {
    const r = rs.rows[0];
    const route = Number(r.found)
      ? { path: JSON.parse(String(r.geometry)) as [number, number][], km: Number(r.distance_m) / 1000, minutes: Number(r.duration_s) / 60 }
      : null;
    return { route, fetched: false };
  }
  if (!fetchAllowed) return { route: undefined, fetched: false };
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${k}?overview=simplified&geometries=geojson`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as {
      code: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    };
    const route = data.code === "Ok" ? data.routes?.[0] : undefined;
    const path = route?.geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(5), +lng.toFixed(5)] as [number, number]) ?? [];
    await db.execute({
      sql: "INSERT OR REPLACE INTO route_cache (key, found, geometry, distance_m, duration_s) VALUES (?, ?, ?, ?, ?)",
      args: [k, route ? 1 : 0, JSON.stringify(path), route?.distance ?? null, route?.duration ?? null],
    });
    return { route: route ? { path, km: route.distance / 1000, minutes: route.duration / 60 } : null, fetched: true };
  } catch {
    return { route: undefined, fetched: true };
  }
}

/**
 * Stops (events with a location, in time order, neighbours at the same place
 * merged) and the legs between them for the given trips. Each day starts at
 * the previous night's stay and ends at that night's stay (the accommodation
 * under the calendar day), so the hotel needn't be added as an event.
 */
export async function buildMap(
  db: Client,
  tripIds: number[],
  budget: { places: number; routes: number },
  /** Only these trips get legs (routes); the rest are stops only. Default: all. */
  routeTrips?: Set<number>
): Promise<MapData> {
  if (tripIds.length === 0) return { stops: [], legs: [], missing: [], pending: 0 };
  const ids = tripIds.map(() => "?").join(",");
  const [rs, stays] = await Promise.all([
    db.execute({
      sql: `SELECT trip_id, date, start_hour, title, location FROM trip_events
            WHERE location != '' AND trip_id IN (${ids})
            ORDER BY trip_id, date, start_hour, id`,
      args: tripIds,
    }),
    db.execute({
      sql: `SELECT d.trip_id, d.date, d.accommodation, d.stay_address FROM trip_days d JOIN trips t ON t.id = d.trip_id
            WHERE TRIM(d.accommodation) != '' AND d.trip_id IN (${ids}) AND d.date BETWEEN t.start_date AND t.end_date`,
      args: tripIds,
    }),
  ]);
  // Per trip: each night's stay (name and where to find it), and every day that has an event or a stay (or follows one).
  const nights = new Map<number, Map<string, { name: string; location: string }>>();
  const days = new Map<number, Set<string>>();
  const dayOf = (trip: number) => days.get(trip) ?? days.set(trip, new Set()).get(trip)!;
  for (const r of stays.rows) {
    const trip = Number(r.trip_id);
    const date = String(r.date);
    const name = String(r.accommodation).trim();
    const location = String(r.stay_address ?? "").trim() || name;
    (nights.get(trip) ?? nights.set(trip, new Map()).get(trip)!).set(date, { name, location });
    dayOf(trip).add(date).add(nextDay(date));
  }
  // A stay's address entered on one night counts for its other nights at the same place.
  for (const [trip, byNight] of nights) {
    const known = new Map<string, string>();
    for (const r of stays.rows) {
      const address = String(r.stay_address ?? "").trim();
      if (Number(r.trip_id) === trip && address) known.set(norm(String(r.accommodation)), address);
    }
    for (const n of byNight.values()) if (n.location === n.name) n.location = known.get(norm(n.name)) ?? n.name;
  }
  const byDay = new Map<string, EventRow[]>();
  for (const r of rs.rows) {
    const e = { trip_id: Number(r.trip_id), date: String(r.date), start_hour: Number(r.start_hour), title: String(r.title), location: String(r.location) };
    dayOf(e.trip_id).add(e.date);
    const k = `${e.trip_id}|${e.date}`;
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const events: EventRow[] = [];
  for (const trip of [...days.keys()].sort((a, b) => a - b)) {
    for (const date of [...days.get(trip)!].sort()) {
      const stay = (d: string, start_hour: number): EventRow[] => {
        const night = nights.get(trip)?.get(d);
        return night ? [{ trip_id: trip, date, start_hour, title: `🏨 ${night.name}`, location: night.location, hotel: true }] : [];
      };
      const prevNight = new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10);
      events.push(...stay(prevNight, 0), ...(byDay.get(`${trip}|${date}`) ?? []), ...stay(date, 24));
    }
  }
  const found = await places(db, events.map((e) => e.location), budget.places);
  let pending = found.pending;
  const missing = new Set<string>();

  const stops: Stop[] = [];
  for (const e of events) {
    const p = found.get(e.location);
    if (p === null) missing.add(e.location);
    if (!p) continue;
    const prev = stops[stops.length - 1];
    if (prev && prev.trip_id === e.trip_id && km(prev, p) < 0.1) {
      if (!prev.titles.includes(e.title)) prev.titles.push(e.title);
      if (e.date !== prev.date) prev.until = e.date;
      continue;
    }
    stops.push({
      ...p,
      trip_id: e.trip_id,
      date: e.date,
      start_hour: e.start_hour,
      location: e.location,
      titles: [e.title],
      ...(e.hotel ? { hotel: true } : {}),
    });
  }

  const legs: Leg[] = [];
  let routes = budget.routes;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (a.trip_id !== b.trip_id || (routeTrips && !routeTrips.has(b.trip_id))) continue;
    const straight = km(a, b);
    const base = { trip_id: b.trip_id, date: b.date, from: a.location, to: b.location };
    const line: [number, number][] = [
      [a.lat, a.lng],
      [b.lat, b.lng],
    ];
    if (straight > FLIGHT_KM) {
      legs.push({ ...base, mode: "flight", path: line, km: straight, minutes: null });
      continue;
    }
    const { route, fetched } = await drive(db, a, b, routes > 0);
    if (fetched) routes--;
    if (route === undefined) pending++;
    legs.push(route ? { ...base, mode: "drive", ...route } : { ...base, mode: "straight", path: line, km: straight, minutes: null });
  }
  return { stops, legs, missing: [...missing], pending };
}

/** Rough middle of a trip's already-found places, to favour nearby search results. */
export async function tripCenter(db: Client, tripId: number): Promise<Point | null> {
  const rs = await db.execute({ sql: "SELECT DISTINCT location FROM trip_events WHERE trip_id = ? AND location != ''", args: [tripId] });
  const found = await cachedPlaces(db, rs.rows.map((r) => String(r.location)));
  const pts = [...found.values()].filter((p): p is Point => !!p);
  if (!pts.length) return null;
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
}

export type PlaceSuggestion = Point & {
  /** What goes in the Location box (and is looked up for the map): name, street and town. */
  value: string;
  /** The place's own name, or its street address when it has none. */
  name: string;
  /** What sort of place it is: "Cafe", "Museum", "Address", "City"… */
  kind: string;
  /** Its full postal address, so look-alike results can be told apart. */
  address: string;
  /** Same as `address` (older clients read this). */
  detail: string;
};

/** OpenStreetMap tag values that say nothing useful about a place. */
const VAGUE_KIND = new Set(["yes", "unclassified", "residential", "service", "primary", "secondary", "tertiary", "building"]);

/** Photon's osm_key/osm_value/type → a short label: "fast_food" → "Fast food", a house number → "Address". */
function placeKind(p: Record<string, string | undefined>): string {
  if (p.type === "house" && !p.name) return "Address";
  if (p.type === "street" || p.osm_key === "highway") return "Street";
  const v = p.osm_value ?? "";
  if (!v || VAGUE_KIND.has(v)) return p.type && p.type !== "house" ? cap(p.type) : "";
  return cap(v.replace(/_/g, " "));
}
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/**
 * Search-as-you-type suggestions from Photon (komoot's free OpenStreetMap
 * search, built for autocomplete; it takes street addresses as well as place
 * names). Each suggestion's coordinates go into the place cache under its
 * text, so picking one never needs a second lookup.
 */
export async function suggestPlaces(db: Client, q: string, near: Point | null): Promise<PlaceSuggestion[]> {
  const bias = near ? `&lat=${near.lat.toFixed(3)}&lon=${near.lng.toFixed(3)}` : "";
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en${bias}`, {
    headers: { "User-Agent": UA },
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = (await res.json()) as {
    features: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }[];
  };
  const found = data.features.flatMap((f) => {
    const p = f.properties;
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const name = p.name || street;
    if (!name) return [];
    const town = p.city || p.town || p.village || p.district || p.county;
    // The neighbourhood, when it isn't already the town: tells apart two branches on unnamed streets.
    const area = [p.locality, p.district].find((x) => x && x !== town && x !== name);
    const region = p.countrycode === "US" || p.countrycode === "CA" ? p.state : undefined;
    const value = [
      name,
      name !== street ? street || area : "",
      town !== name ? town : "",
      region || (p.countrycode !== "US" ? p.country : ""),
    ]
      .filter(Boolean)
      .join(", ");
    const address = [
      name !== street ? street : "",
      area,
      [p.postcode, town !== name ? town : ""].filter(Boolean).join(" "),
      p.state !== town ? p.state : "",
      p.country,
    ]
      .filter(Boolean)
      .join(", ");
    const [lng, lat] = f.geometry.coordinates;
    return [{ value, name, kind: placeKind(p), address, detail: address, lat, lng, postcode: p.postcode }];
  });
  // Two results that would read the same in the Location box (two branches of a chain in one town):
  // add the postcode so the saved text still finds the one picked.
  const count = new Map<string, number>();
  for (const s of found) count.set(s.value, (count.get(s.value) ?? 0) + 1);
  const seen = new Set<string>();
  const out: PlaceSuggestion[] = [];
  for (const { postcode, ...s } of found) {
    if ((count.get(s.value) ?? 0) > 1 && postcode) s.value = `${s.value} ${postcode}`;
    if (seen.has(s.value)) continue;
    seen.add(s.value);
    out.push(s);
  }
  if (out.length) {
    await db.batch(
      out.map((s) => ({
        sql: "INSERT OR REPLACE INTO geocode_cache (query, found, lat, lng, label) VALUES (?, 1, ?, ?, ?)",
        args: [norm(s.value), s.lat, s.lng, s.address],
      })),
      "write"
    );
  }
  return out;
}
