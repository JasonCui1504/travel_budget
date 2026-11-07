import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { failure } from "@/lib/crud";
import { getTravelDb } from "@/lib/db";

const FIELDS = [
  "accommodation",
  "accommodation_status",
  "notes",
  "breakfast",
  "lunch",
  "dinner",
  "cancellation_policy",
  "stay_link",
  "stay_address",
  "cancel_by",
  "non_refundable",
  "car",
  "car_status",
  "car_cancel_by",
  "car_non_refundable",
  "car_link",
  "car_notes",
] as const;

/** A field's stored value: cancel_by is a date or "", non_refundable 0/1, the rest trimmed text. */
function value(field: (typeof FIELDS)[number], v: unknown): string | number | null {
  if (field === "non_refundable" || field === "car_non_refundable") return v === true || v === 1 || v === "1" ? 1 : 0;
  const text = typeof v === "string" ? v.trim() : "";
  if (field === "cancel_by" || field === "car_cancel_by") return /^\d{4}-\d{2}-\d{2}$/.test(text) || text === "" ? text : null;
  return text;
}

/**
 * Updates one day's stay (confirmed, cancel-by date or non-refundable, link), meals or
 * notes. Only the fields sent are written, so two quick edits to different
 * boxes can't overwrite each other.
 */
export async function PUT(request: NextRequest) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const b = await request.json();
  const tripId = Number(b.trip_id);
  if (!Number.isInteger(tripId) || !/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? "")) {
    return Response.json({ error: "trip_id and date are required" }, { status: 400 });
  }
  const sent = FIELDS.filter((f) => f in b);
  if (sent.length === 0) return Response.json({ error: "Nothing to update" }, { status: 400 });
  const values = sent.map((f) => value(f, b[f]));
  if (values.includes(null)) return Response.json({ error: "cancel_by must be YYYY-MM-DD" }, { status: 400 });

  try {
    const db = await getTravelDb();
    await db.batch(
      [
        { sql: "INSERT OR IGNORE INTO trip_days (trip_id, date) VALUES (?, ?)", args: [tripId, b.date] },
        {
          sql: `UPDATE trip_days SET ${sent.map((f) => `${f} = ?`).join(", ")} WHERE trip_id = ? AND date = ?`,
          args: [...(values as (string | number)[]), tripId, b.date],
        },
      ],
      "write"
    );
  } catch (e) {
    return failure(`PUT trip_days ${tripId} ${b.date}`, e);
  }
  return Response.json({ ok: true });
}
