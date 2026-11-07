import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getTravelDb } from "@/lib/db";
import { buildMap, type Point } from "@/lib/geo";
import { forecast, FORECAST_DAYS, type DayWeather } from "@/lib/weather";

/**
 * The forecast for each day of a trip, at that day's first located event (or
 * the nearest earlier day's, else the trip's first). Days past the forecast
 * window get `later` with the date the forecast becomes available.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Invalid id" }, { status: 400 });
  const db = await getTravelDb();
  const t = await db.execute({ sql: "SELECT start_date, end_date FROM trips WHERE id = ?", args: [id] });
  if (!t.rows.length) return Response.json({ error: "Not found" }, { status: 404 });
  const start = String(t.rows[0].start_date);
  const end = String(t.rows[0].end_date);

  const { stops, pending } = await buildMap(db, [id], { places: 4, routes: 0 });
  const today = new Date().toISOString().slice(0, 10);
  const last = new Date(Date.parse(today) + (FORECAST_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);

  const days: Record<string, { place: string; weather?: DayWeather; later?: string } | null> = {};
  const fetches = new Map<string, Promise<Awaited<ReturnType<typeof forecast>>>>();
  let timezone = "";
  let here: (Point & { location: string }) | null = stops[0] ?? null;
  for (let d = start; d <= end; d = new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10)) {
    const first = stops.find((s) => s.date === d);
    if (first) here = first;
    if (!here || d < today) {
      days[d] = null;
      continue;
    }
    if (d > last) {
      const from = new Date(Date.parse(d) - (FORECAST_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
      days[d] = { place: here.location, later: from };
      continue;
    }
    const k = `${here.lat.toFixed(2)},${here.lng.toFixed(2)}`;
    if (!fetches.has(k)) fetches.set(k, forecast(here));
    const f = await fetches.get(k)!;
    if (f && !timezone) timezone = f.timezone;
    days[d] = { place: here.location, weather: f?.days[d] };
  }
  return Response.json({ days, timezone, pending, located: stops.length > 0 });
}
