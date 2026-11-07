import { makeCrud } from "@/lib/crud";

const { PUT, DELETE } = makeCrud("estimates", [
  { name: "category", type: "string", required: true },
  { name: "cost", type: "number", required: true },
  { name: "whom", type: "string" },
]);
export { PUT, DELETE };
