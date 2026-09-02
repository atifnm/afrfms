import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db } from "./client";

const driver = process.env.DB_DRIVER || "sqlite";
const schemaFile = driver === "postgres" ? "schema.postgres.sql" : "schema.sqlite.sql";
const schema = fs.readFileSync(path.join(__dirname, schemaFile), "utf-8");

db.exec(schema).then(() => {
  console.log(`Migration applied (${driver}) — schema is up to date.`);
  process.exit(0);
});
