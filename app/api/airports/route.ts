import { NextRequest } from "next/server";
import { searchAirports } from "@/lib/airports";
import { requireUser } from "@/lib/auth";

/** Airport suggestions for the flight fields: ?q=code, city or name. */
export async function GET(request: NextRequest) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 60);
  return Response.json({ airports: searchAirports(q).map(({ code, name, city, country, tz }) => ({ code, name, city, country, tz })) });
}
