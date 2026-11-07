import { makeCrud } from "@/lib/crud";

const { PUT } = makeCrud("people", [
  { name: "name", type: "string", required: true },
  { name: "contribution", type: "number", required: true },
]);
export { PUT };
