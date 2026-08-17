import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseUrl } from "./env.js";

const sql = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
await migrate(drizzle(sql), {
  migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
});
await sql.end();
console.log("migrations applied");
