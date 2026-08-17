import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

let loaded = false;

/** Minimal .env loader: walks up from cwd, never overrides real env vars. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m?.[1] && process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2] ?? "";
        }
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function databaseUrl(): string {
  loadEnv();
  return process.env.DATABASE_URL ?? "postgres://pv:pv@localhost:5436/pv";
}

/**
 * Connection for the API runtime: the least-privilege pv_app role (DML only:
 * no TRUNCATE, no DDL, no trigger disablement, no direct audit_event writes;
 * migration 0002). Migrations and seed keep the owning role via DATABASE_URL.
 */
export function appDatabaseUrl(): string {
  loadEnv();
  if (process.env.DATABASE_URL_APP) return process.env.DATABASE_URL_APP;
  const url = new URL(databaseUrl());
  url.username = "pv_app";
  url.password = process.env.PV_APP_PASSWORD ?? "pv_app";
  return url.toString();
}

/**
 * Sponsor business time zone for regulatory clocks (ADR-0007): due dates are
 * calendar days, so every connection pins its session TimeZone here and
 * `sent_at::date` / CURRENT_DATE resolve consistently.
 */
export function pvTimeZone(): string {
  loadEnv();
  return process.env.PV_TIMEZONE ?? "UTC";
}
