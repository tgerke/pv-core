/**
 * Installation Qualification (IQ, ADR-0017): one command that checks a live
 * environment against the installed controls the compliance mapping claims
 * (migrations, immutability and lock triggers, role privileges, the audit
 * hash chain, storage and auth posture) and writes a signed-off-able report.
 * Exit code 1 on any FAIL.
 *
 * Usage: pnpm validation:iq [--report docs/validation/iq-report.md]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "./client.js";
import { loadEnv } from "./env.js";

type Level = "PASS" | "FAIL" | "WARN";
const results: { level: Level; check: string; detail: string }[] = [];
const record = (level: Level, check: string, detail: string) =>
  results.push({ level, check, detail });
const ok = (cond: boolean, check: string, detail: string) =>
  record(cond ? "PASS" : "FAIL", check, detail);

// dictionary_term is reloadable licensed reference data (ADR-0005);
// audit_event cannot audit itself.
const AUDIT_EXEMPT = new Set(["dictionary_term", "audit_event"]);
const IMMUTABLE = [
  "audit_event",
  "signature",
  "submission",
  "submission_acknowledgement",
  "case_attachment",
  "case_transition",
  "case_unblinding",
  "case_nullification",
  "rsi_listed_term",
  "study_anticipated_event_term",
  "dictionary_term",
];
const LOCKED = [
  "case_version",
  "case_patient",
  "case_source",
  "case_event",
  "case_drug",
  "case_assessment",
  "case_event_designation",
  "case_test",
  "case_narrative",
];

async function main() {
  loadEnv();
  const { sql } = createDb();

  const journalPath = fileURLToPath(new URL("../migrations/meta/_journal.json", import.meta.url));
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  const [migrations] = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
  ok(
    migrations!.n === journal.entries.length,
    "migrations applied",
    `${migrations!.n} applied, ${journal.entries.length} in journal`,
  );

  // immutability triggers (§11.10(c))
  for (const table of IMMUTABLE) {
    const [trigger] = await sql`
      SELECT count(*)::int AS n FROM pg_trigger
      WHERE tgname = ${`${table}_immutable`} AND NOT tgisinternal`;
    ok(
      trigger!.n === 1,
      `immutability trigger on ${table}`,
      trigger!.n === 1 ? "present" : "MISSING",
    );
  }
  // signature lock triggers (ADR-0006)
  for (const table of LOCKED) {
    const [trigger] = await sql`
      SELECT count(*)::int AS n FROM pg_trigger
      WHERE tgname = ${`${table}_lock`} AND NOT tgisinternal`;
    ok(
      trigger!.n === 1,
      `signature lock trigger on ${table}`,
      trigger!.n === 1 ? "present" : "MISSING",
    );
  }
  for (const [name, why] of [
    ["case_identity_guard", "case identity immutable (C.1.8.1)"],
    ["case_version_after_nullification", "no versions after nullification (C.1.11)"],
    ["submission_requires_approval", "submission needs an approval signature bound to the hash"],
    ["signature_requires_valid_icsr", "no signature before a valid ICSR (E2B(R3) §3.3.1)"],
  ] as const) {
    const [t] =
      await sql`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = ${name} AND NOT tgisinternal`;
    ok(t!.n === 1, why, t!.n === 1 ? "present" : "MISSING");
  }

  // every domain table carries the audit trigger (§11.10(e))
  const unaudited = await sql`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = c.oid AND p.proname = 'pv_audit' AND NOT t.tgisinternal)
    ORDER BY c.relname`;
  const missing = unaudited.map((r) => r.relname as string).filter((t) => !AUDIT_EXEMPT.has(t));
  ok(
    missing.length === 0,
    "audit trigger on every domain table",
    missing.length
      ? `missing on: ${missing.join(", ")}`
      : `all audited (exempt by design: ${[...AUDIT_EXEMPT].join(", ")})`,
  );

  const [prosecdef] = await sql`SELECT prosecdef FROM pg_proc WHERE proname = 'pv_audit'`;
  ok(Boolean(prosecdef?.prosecdef), "pv_audit() is SECURITY DEFINER", String(prosecdef?.prosecdef));

  // roles and privilege ceilings (§11.10(d))
  for (const role of ["pv_app", "pv_readonly"]) {
    const [row] = await sql`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ${role}`;
    ok(row!.n === 1, `role ${role} exists`, row!.n === 1 ? "present" : "MISSING");
  }
  const [privileges] = await sql`
    SELECT has_schema_privilege('pv_app', 'public', 'CREATE') AS can_create,
           has_table_privilege('pv_app', 'audit_event', 'INSERT') AS can_forge,
           has_table_privilege('pv_app', 'person', 'TRUNCATE') AS can_truncate,
           has_column_privilege('pv_readonly', 'case_unblinding', 'arm_label', 'SELECT') AS ro_sees_arm`;
  ok(!privileges!.can_create, "pv_app cannot CREATE in schema", String(privileges!.can_create));
  ok(
    !privileges!.can_forge,
    "pv_app cannot INSERT audit_event directly",
    String(privileges!.can_forge),
  );
  ok(!privileges!.can_truncate, "pv_app cannot TRUNCATE", String(privileges!.can_truncate));
  ok(
    !privileges!.ro_sees_arm,
    "pv_readonly cannot read arms at rest (ADR-0008)",
    String(privileges!.ro_sees_arm),
  );

  // §11.200 manifestation required for every signature
  const [reauth] = await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'signature' AND column_name IN ('reauth_method', 'reauth_at') AND is_nullable = 'NO'`;
  ok(
    reauth!.n === 2,
    "signature re-authentication columns NOT NULL (§11.200)",
    `${reauth!.n} of 2`,
  );

  // audit hash chain verifies end to end (§11.10(e))
  const problems = await sql`SELECT * FROM pv_verify_audit_chain()`;
  const [events] = await sql`SELECT count(*)::int AS n FROM audit_event`;
  ok(
    problems.length === 0,
    "audit hash chain verifies",
    `${events!.n} events, ${problems.length} problems`,
  );

  // every signature still binds to its version (§11.70)
  const [integrity] =
    await sql`SELECT count(*)::int AS n FROM v_signature_integrity WHERE NOT hash_matches`;
  ok(
    integrity!.n === 0,
    "every signature hash matches its version (§11.70)",
    `${integrity!.n} mismatches`,
  );

  // dictionary posture (ADR-0005)
  const [dict] = await sql`
    SELECT count(*) FILTER (WHERE NOT is_demo_subset)::int AS real, count(*) FILTER (WHERE is_demo_subset)::int AS demo
    FROM dictionary WHERE type = 'MedDRA'`;
  if (dict!.real > 0)
    record(
      "PASS",
      "MedDRA release loaded",
      `${dict!.real} verbatim release(s), ${dict!.demo} demo subset(s)`,
    );
  else
    record(
      "WARN",
      "MedDRA release loaded",
      "only the labeled demo subset is present; load a licensed release with pnpm db:import-meddra",
    );

  // storage posture (§11.10(b)/(c) for the bytes, ADR-0013)
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") {
    const { GetObjectLockConfigurationCommand } = await import("@aws-sdk/client-s3");
    const { makeS3Store, s3ConfigFromEnv } = await import("./storage.js");
    const config = s3ConfigFromEnv();
    try {
      const lock = await makeS3Store(config).client.send(
        new GetObjectLockConfigurationCommand({ Bucket: config.bucket }),
      );
      ok(
        lock.ObjectLockConfiguration?.ObjectLockEnabled === "Enabled",
        "S3 bucket Object Lock enabled (WORM)",
        lock.ObjectLockConfiguration?.ObjectLockEnabled ?? "not configured",
      );
    } catch (e) {
      record(
        "FAIL",
        "S3 bucket Object Lock enabled (WORM)",
        e instanceof Error ? e.message : String(e),
      );
    }
  } else {
    record("WARN", "storage driver", `'${driver}': local directory store is dev-only, not WORM`);
  }

  // auth and clock posture
  const mode = process.env.AUTH_MODE;
  if (mode === "oidc") record("PASS", "AUTH_MODE", "oidc");
  else
    record(
      "WARN",
      "AUTH_MODE",
      `'${mode ?? "unset"}': dev tokens are not a Part 11 access-control posture`,
    );
  const [tz] = await sql`SHOW TimeZone`;
  record(
    process.env.PV_TIMEZONE ? "PASS" : "WARN",
    "PV_TIMEZONE for calendar-day clocks (ADR-0007)",
    `session TimeZone ${String(tz!.TimeZone)}${process.env.PV_TIMEZONE ? "" : " (PV_TIMEZONE unset, defaulting)"}`,
  );

  await sql.end();

  const lines = results.map((r) => `[${r.level}] ${r.check}: ${r.detail}`);
  console.log(lines.join("\n"));
  const failures = results.filter((r) => r.level === "FAIL").length;
  const warnings = results.filter((r) => r.level === "WARN").length;
  console.log(`\nIQ: ${results.length} checks, ${failures} failed, ${warnings} warnings`);

  const reportFlag = process.argv.indexOf("--report");
  const path =
    reportFlag !== -1 && process.argv[reportFlag + 1]
      ? process.argv[reportFlag + 1]!
      : fileURLToPath(new URL("../../../docs/validation/iq-report.md", import.meta.url));
  writeFileSync(
    path,
    [
      "# Installation Qualification report",
      "",
      `Generated ${new Date().toISOString()} against \`${(process.env.DATABASE_URL ?? "default DATABASE_URL").replace(/:[^:@/]+@/, ":***@")}\`.`,
      "Generated by `pnpm validation:iq` (ADR-0017); never edited by hand.",
      "",
      "| Result | Check | Detail |",
      "| --- | --- | --- |",
      ...results.map((r) => `| ${r.level} | ${r.check} | ${r.detail} |`),
      "",
      `**${failures === 0 ? "IQ PASSED" : "IQ FAILED"}**: ${results.length} checks, ${failures} failed, ${warnings} warnings.`,
      "",
      "Reviewed by: ______________________  Date: ____________",
      "",
    ].join("\n"),
  );
  console.log(`report written to ${path}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
