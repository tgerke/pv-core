import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl, pvTimeZone } from "./env.js";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];
export type Sql = ReturnType<typeof postgres>;

export function createDb(url: string = databaseUrl()) {
  const sql = postgres(url, {
    onnotice: () => {},
    // Calendar-day clocks (ADR-0007): the sponsor's business zone, not the
    // container's.
    connection: { TimeZone: pvTimeZone() },
  });
  const db = drizzle(sql, { schema });
  return { sql, db };
}
