import { createHash, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { getTravelDb } from "@/lib/db";
import { tripStarts } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Read-only trip dates for Llamabear (llamabear.jascui.com), which shows them
// as visits. Only names and dates — never expenses or docs. Authenticated by a
// shared secret (TRAVEL_FEED_SECRET) sent as a bearer token, server to server.
// Covers trips that ended in the last year plus everything upcoming.
// start_hour and time_zone let it count down to the same moment as the Trips
// page (tripStarts: the first flight's departure or first event on day one,
// else midnight): hours from the start of start_date in that zone ("" = the
// viewer's own), so a flight leaving the night before is negative.

function authorized(request: NextRequest): boolean {
  const secret = process.env.TRAVEL_FEED_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getTravelDb();
  const [rs, starts] = await Promise.all([
    db.execute(
      `SELECT t.id, t.name, t.start_date, t.end_date, t.time_zone
       FROM trips t
       WHERE t.end_date >= date('now', '-365 days')
       ORDER BY t.start_date, t.id`
    ),
    tripStarts(),
  ]);
  const trips = rs.rows.map((r) => {
    const startDate = String(r.start_date);
    const s = starts[Number(r.id)];
    return {
      id: Number(r.id),
      name: String(r.name),
      start_date: startDate,
      end_date: String(r.end_date),
      start_hour: s ? (Date.parse(s.date) - Date.parse(startDate)) / 3_600_000 + s.hour : 0,
      time_zone: s ? s.tz : String(r.time_zone ?? ""),
    };
  });
  return Response.json({ trips }, { headers: { "Cache-Control": "no-store" } });
}
