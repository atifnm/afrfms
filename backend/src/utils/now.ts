/**
 * Returns the current UTC timestamp as "YYYY-MM-DD HH:MM:SS" — the same
 * string format both schema.sqlite.sql's `datetime('now')` and
 * schema.postgres.sql's `to_char(now() AT TIME ZONE 'UTC', ...)` defaults
 * produce. Application code passes this as a parameter instead of relying
 * on a SQL dialect-specific "now" function inline in a query, so the same
 * UPDATE/INSERT statement works unchanged against either database.
 */
export function nowSql(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}
