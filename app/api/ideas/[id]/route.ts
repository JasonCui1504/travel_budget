import { makeCrud } from "@/lib/crud";

const { PUT, DELETE } = makeCrud("trip_idea_items", [
  { name: "trip_id", type: "number", required: true },
  { name: "text", type: "string", required: true },
]);
export { PUT, DELETE };
