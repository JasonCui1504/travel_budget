import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getTravelDb } from "@/lib/db";
import { buildMap } from "@/lib/geo";

/** Every trip's stops (and legs for trips marked show_route), for the map on the Trips page. */
export async function GET(request: NextRequest) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const db = await getTravelDb();
  const rs = await db.execute("SELECT id, show_route FROM trips");
  // Routes only for trips marked to show them here; the rest are just places.
  const routed = new Set(rs.rows.filter((r) => Number(r.show_route) === 1).map((r) => Number(r.id)));
  return Response.json(await buildMap(db, rs.rows.map((r) => Number(r.id)), { places: 4, routes: 8 }, routed));
}
