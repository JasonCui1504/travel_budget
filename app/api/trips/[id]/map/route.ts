import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getTravelDb } from "@/lib/db";
import { buildMap } from "@/lib/geo";

/** One trip's stops and legs; `pending` > 0 means ask again for the rest. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Invalid id" }, { status: 400 });
  const db = await getTravelDb();
  return Response.json(await buildMap(db, [id], { places: 4, routes: 8 }));
}
