import { makeCrud } from "@/lib/crud";

const { POST } = makeCrud("trip_idea_items", [
  { name: "trip_id", type: "number", required: true },
  { name: "text", type: "string", required: true },
]);
export { POST };
