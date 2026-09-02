let counter = 0;

// A client-side-only identifier for a row that doesn't have a server id yet
// (e.g. a new checklist item before it's saved). Never sent to the API —
// callers should omit `id` entirely when submitting a "new" row.
export function newLocalId(): string {
  counter += 1;
  return `local-${Date.now()}-${counter}`;
}
