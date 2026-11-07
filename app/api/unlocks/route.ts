import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getTravelDb } from "@/lib/db";
import { getCycle, listPeople, monthsBetween } from "@/lib/queries";

/**
 * Unlocks every month of the cycle up to and including `through` (YYYY-MM)
 * for everyone, and locks the rest. An empty `through` locks every month.
 */
export async function PUT(request: NextRequest) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const b = await request.json();
  const through = typeof b.through === "string" ? b.through : "";
  if (through && !/^\d{4}-(0[1-9]|1[0-2])$/.test(through)) {
    return Response.json({ error: "through must be YYYY-MM" }, { status: 400 });
  }
  const [cycle, people] = await Promise.all([getCycle(), listPeople()]);
  const db = await getTravelDb();
  await db.batch(
    people.flatMap((p) =>
      monthsBetween(cycle.start_month, cycle.end_month).map((month) => ({
        sql: `INSERT INTO month_unlocks (person_id, month, unlocked) VALUES (?, ?, ?)
              ON CONFLICT(person_id, month) DO UPDATE SET unlocked = excluded.unlocked`,
        args: [p.id, month, through && month <= through ? 1 : 0],
      }))
    ),
    "write"
  );
  return Response.json({ ok: true });
}
