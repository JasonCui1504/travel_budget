/** Writable estimated-expense columns, shared by the create and update routes. */
export const ESTIMATED_FIELDS = [
  { name: "trip_id", type: "number", required: true },
  { name: "item", type: "string", required: true },
  { name: "category", type: "string" },
  { name: "amount", type: "number", required: true },
] as const;
