import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getTravelDb } from "@/lib/db";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// A new trip gets its calendar straight away: the 3 AM → midnight grid for
// every day in the range is drawn from the dates alone, so all that's stored
// is the trip itself.
export async function POST(request: NextRequest) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const b = await request.json();
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  if (!DATE.test(b.start_date) || !DATE.test(b.end_date) || b.end_date < b.start_date) {
    return Response.json({ error: "start and end dates are required, end on or after start" }, { status: 400 });
  }
  const db = await getTravelDb();
  const rs = await db.execute({
    sql: "INSERT INTO trips (name, start_date, end_date) VALUES (?, ?, ?) RETURNING id",
    args: [name, b.start_date, b.end_date],
  });
  return Response.json({ id: Number(rs.rows[0].id) }, { status: 201 });
}
