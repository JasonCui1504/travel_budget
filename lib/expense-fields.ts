import { isFlight } from "./flight";

/** Writable expense columns, shared by the create and update routes. */
export const EXPENSE_FIELDS = [
  { name: "person_id", type: "number", required: true },
  { name: "month", type: "month", required: true },
  { name: "category", type: "string" },
  { name: "kind", type: "enum", values: ["travel", "visiting"], required: true },
  { name: "amount", type: "number", required: true },
  { name: "notes", type: "string" },
  { name: "trip_id", type: "number", nullable: true },
  { name: "flight_from", type: "string" },
  { name: "flight_to", type: "string" },
  { name: "round_trip", type: "number", nullable: true },
] as const;

/** A new flight must say where from, where to, and whether it's a round trip. */
export function validateNewExpense(b: Record<string, unknown>): string | null {
  if (!isFlight(String(b.category ?? ""))) return null;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (!s(b.flight_from) || !s(b.flight_to)) return "Flights need where from and where to";
  if (b.round_trip !== 0 && b.round_trip !== 1 && b.round_trip !== "0" && b.round_trip !== "1") {
    return "Flights need round trip or one way";
  }
  return null;
}
