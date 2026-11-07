import data from "./airports.json";

// Airports by IATA code (OpenFlights data): name, city, country, lat, lng, time zone.
// Server-only: the table is ~450 KB, so the browser asks /api/airports.

type Row = [string, string, string, number, number, string];
const AIRPORTS = data as unknown as Record<string, Row>;

export type Airport = { code: string; name: string; city: string; country: string; lat: number; lng: number; tz: string };

const toAirport = (code: string, r: Row): Airport => ({ code, name: r[0], city: r[1], country: r[2], lat: r[3], lng: r[4], tz: r[5] });

export function airport(code: string): Airport | null {
  const c = code.trim().toUpperCase();
  const r = AIRPORTS[c];
  return r ? toAirport(c, r) : null;
}

/** Up to `limit` airports matching a code, city or name; exact code first, then cities, then names. */
export function searchAirports(q: string, limit = 8): Airport[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const exact = s.length === 3 ? airport(s) : null;
  const scored: [number, Airport][] = [];
  for (const [code, r] of Object.entries(AIRPORTS)) {
    if (exact && code === exact.code) continue;
    const city = r[1].toLowerCase();
    const name = r[0].toLowerCase();
    const score = code.toLowerCase().startsWith(s) ? 1 : city.startsWith(s) ? 2 : city.includes(s) ? 3 : name.includes(s) ? 4 : 0;
    if (score) scored.push([score, toAirport(code, r)]);
  }
  // Within a tier, bigger airports tend to be "Intl"; nudge them up.
  scored.sort((a, b) => a[0] - b[0] || Number(/Intl/.test(b[1].name)) - Number(/Intl/.test(a[1].name)));
  return [...(exact ? [exact] : []), ...scored.map((x) => x[1])].slice(0, limit);
}
