import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getTravelDb } from "@/lib/db";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Starts a new budget year. Expenses keep their months, so old ones stay visible by filter. */
export async function POST(request: NextRequest) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const b = await request.json();
  if (!MONTH.test(b.start_month) || !MONTH.test(b.end_month) || b.end_month <= b.start_month) {
    return Response.json({ error: "start_month and end_month (YYYY-MM) are required" }, { status: 400 });
  }
  const db = await getTravelDb();
  const rs = await db.execute({
    sql: "INSERT INTO cycles (start_month, end_month) VALUES (?, ?) RETURNING id",
    args: [b.start_month, b.end_month],
  });
  return Response.json({ id: Number(rs.rows[0].id) }, { status: 201 });
}
