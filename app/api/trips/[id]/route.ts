import { makeCrud } from "@/lib/crud";

const { PUT, DELETE } = makeCrud("trips", [
  { name: "name", type: "string", required: true },
  { name: "start_date", type: "date", required: true },
  { name: "end_date", type: "date", required: true },
  { name: "done", type: "bool" },
  { name: "notes", type: "string" },
  { name: "doc", type: "string" },
  { name: "view_start_hour", type: "number", nullable: true },
  { name: "view_end_hour", type: "number", nullable: true },
  { name: "time_zone", type: "string" },
  { name: "show_route", type: "bool" },
  { name: "hide_map", type: "bool" },
]);
export { PUT, DELETE };
