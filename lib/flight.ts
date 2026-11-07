// Shared by the browser forms and the API, so it has no server imports.

/** Whether an expense type counts as a flight (so it carries a route). */
export function isFlight(category: string): boolean {
  return /flight/i.test(category);
}
