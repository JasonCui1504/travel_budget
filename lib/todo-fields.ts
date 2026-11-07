/** Writable to-do columns, shared by the create and update routes. */
export const TODO_FIELDS = [
  { name: "text", type: "string", required: true },
  { name: "cost", type: "number", nullable: true },
  { name: "trip_id", type: "number", nullable: true },
  { name: "done", type: "bool" },
] as const;
