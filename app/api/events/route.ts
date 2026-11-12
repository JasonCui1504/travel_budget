import { makeCrud } from "@/lib/crud";

const { POST } = makeCrud("trip_events", [
  { name: "trip_id", type: "number", required: true },
  { name: "date", type: "date", required: true },
  { name: "start_hour", type: "number", required: true },
  { name: "end_hour", type: "number", required: true },
  { name: "title", type: "string", required: true },
  { name: "status", type: "enum", values: ["none", "unnecessary", "not_booked", "booked", "transit"] },
  { name: "notes", type: "string" },
  { name: "location", type: "string" },
  { name: "map_link", type: "string" },
  { name: "reservation_link", type: "string" },
  { name: "other_link", type: "string" },
  { name: "lat", type: "number", nullable: true },
  { name: "lng", type: "number", nullable: true },
]);
export { POST };
