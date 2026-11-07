import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getTravelDb } from "@/lib/db";
import { suggestPlaces, tripCenter } from "@/lib/geo";

/** Place suggestions for the event Location box: ?q=text&trip=id (results near the trip come first). */
export async function GET(request: NextRequest) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 3) return Response.json({ places: [] });
  const trip = Number(request.nextUrl.searchParams.get("trip"));
  const db = await getTravelDb();
  try {
    const near = Number.isInteger(trip) && trip > 0 ? await tripCenter(db, trip) : null;
    return Response.json({ places: await suggestPlaces(db, q, near) });
  } catch {
    return Response.json({ places: [], error: "Place search is unavailable right now" });
  }
}
