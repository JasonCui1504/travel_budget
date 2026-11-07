import { NextRequest } from "next/server";
import { airport } from "@/lib/airports";
import { requireUser } from "@/lib/auth";
import { failure } from "@/lib/crud";
import { getTravelDb } from "@/lib/db";
import { checkFlight, placement, type FlightInput } from "@/lib/flights";
import { validZone } from "@/lib/time";

/**
 * Replaces a transit event's flights ({ flights: [...] }, [] clears them) and
 * moves the event to cover them on the calendar, in the trip's time zone. A
 * trip with no time zone yet takes the first flight's arrival airport's.
 */
export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Invalid id" }, { status: 400 });
  const body = await request.json();
  const raw: unknown[] = Array.isArray(body.flights) ? body.flights : [];

  const flights: FlightInput[] = raw.map((f) => {
    const x = (f ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof x[k] === "string" ? (x[k] as string).trim() : "");
    return {
      person_id: Number(x.person_id),
      flight_no: s("flight_no").toUpperCase().slice(0, 12),
      from_code: s("from_code").toUpperCase(),
      to_code: s("to_code").toUpperCase(),
      depart: s("depart"),
      arrive: s("arrive"),
    };
  });
  const times = [];
  for (const f of flights) {
    if (!Number.isInteger(f.person_id)) return Response.json({ error: "Each flight needs a traveller" }, { status: 400 });
    const t = checkFlight(f);
    if (typeof t === "string") return Response.json({ error: t }, { status: 400 });
    times.push(t);
  }

  const db = await getTravelDb();
  const ev = await db.execute({
    sql: "SELECT e.trip_id, t.time_zone FROM trip_events e JOIN trips t ON t.id = e.trip_id WHERE e.id = ?",
    args: [id],
  });
  if (!ev.rows.length) return Response.json({ error: "Not found" }, { status: 404 });
  const tripId = Number(ev.rows[0].trip_id);
  let tz = String(ev.rows[0].time_zone ?? "");
  const setZone = !validZone(tz) && flights.length > 0;
  if (setZone) tz = airport(flights[0].to_code)!.tz;

  const writes = [
    { sql: "DELETE FROM trip_flights WHERE event_id = ?", args: [id] },
    ...flights.map((f) => ({
      sql: `INSERT INTO trip_flights (event_id, person_id, flight_no, from_code, to_code, depart, arrive) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, f.person_id, f.flight_no, f.from_code, f.to_code, f.depart, f.arrive],
    })),
  ];
  let placed = null;
  if (flights.length) {
    placed = placement(times, tz);
    writes.push({ sql: "UPDATE trip_events SET date = ?, start_hour = ?, end_hour = ? WHERE id = ?", args: [placed.date, placed.start_hour, placed.end_hour, id] });
    if (setZone) writes.push({ sql: "UPDATE trips SET time_zone = ? WHERE id = ?", args: [tz, tripId] });
  }
  try {
    await db.batch(writes, "write");
  } catch (e) {
    if (e instanceof Error && /FOREIGN KEY/.test(e.message)) return Response.json({ error: "That traveller doesn't exist" }, { status: 400 });
    return failure(`PUT flights for event ${id}`, e);
  }
  return Response.json({ ok: true, placed, time_zone: tz, time_zone_set: setZone });
}
