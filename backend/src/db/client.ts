import "dotenv/config";
import path from "node:path";

// A minimal, driver-agnostic query interface. Every call site in this app
// uses `db.prepare(sql).get/all/run(...params)` with `?` placeholders,
// regardless of which database is actually behind it — this file is the
// only place that knows the difference.
//
// DB_DRIVER=sqlite (default) — Node's built-in node:sqlite, zero setup,
//   for local development.
// DB_DRIVER=postgres — real PostgreSQL, for staging/production. Set
//   DATABASE_URL to a standard postgres:// connection string.
export interface Statement {
  get(...params: any[]): Promise<any>;
  all(...params: any[]): Promise<any[]>;
  run(...params: any[]): Promise<{ changes: number }>;
}

export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
}

const driver = process.env.DB_DRIVER || "sqlite";

function makeSqliteDb(): Db {
  // Lazy require so the postgres path never touches node:sqlite and vice versa.
  const { DatabaseSync } = require("node:sqlite");
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../dev.db");
  const raw = new DatabaseSync(DB_PATH);
  raw.exec("PRAGMA foreign_keys = ON;");

  return {
    prepare(sql: string): Statement {
      const stmt = raw.prepare(sql);
      return {
        async get(...params: any[]) {
          return stmt.get(...params);
        },
        async all(...params: any[]) {
          return stmt.all(...params);
        },
        async run(...params: any[]) {
          const res = stmt.run(...params);
          return { changes: Number(res.changes ?? 0) };
        },
      };
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
  };
}

function makePostgresDb(): Db {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // This app writes every query with SQLite-style `?` placeholders; convert
  // to Postgres's `$1, $2, ...` once per prepare() call.
  function toPgSql(sql: string): string {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  return {
    prepare(sql: string): Statement {
      const pgSql = toPgSql(sql);
      return {
        async get(...params: any[]) {
          const res = await pool.query(pgSql, params);
          return res.rows[0];
        },
        async all(...params: any[]) {
          const res = await pool.query(pgSql, params);
          return res.rows;
        },
        async run(...params: any[]) {
          const res = await pool.query(pgSql, params);
          return { changes: res.rowCount ?? 0 };
        },
      };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
  };
}

export const db: Db = driver === "postgres" ? makePostgresDb() : makeSqliteDb();
