/**
 * Reminders digest (ADR-0014): query the derived views, compose one plain-text
 * email per study, and send it to everyone holding an admin, case processor,
 * or medical reviewer grant that covers the study. Stateless by design: there
 * is no notification table and nothing to sync; run it from cron (or any
 * scheduler) as often as the team wants the summary.
 *
 *   pnpm digest                      # every study, send via SMTP_URL
 *   pnpm digest -- --study CORC-2201 # one study, by protocol number or id
 *   pnpm digest -- --dry-run         # print to stdout, send nothing
 *
 * Env: SMTP_URL (e.g. smtp://localhost:1026, mailpit from docker-compose),
 * DIGEST_FROM, DIGEST_TO (optional comma-separated override of the derived
 * recipient list). Without SMTP_URL the run behaves like --dry-run.
 */
import { attentionCount, collectDigest, digestRecipients, renderDigest } from "@pv-core/core";
import { appDatabaseUrl, createDb, loadEnv } from "@pv-core/db";
import nodemailer from "nodemailer";

loadEnv();

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args[i + 1] ?? true);
};
const studyFilter = flag("--study") as string | undefined;
const dryRun = args.includes("--dry-run") || !process.env.SMTP_URL;

// Reads derived views only: run as the least-privilege role, same as the api.
const { sql } = createDb(appDatabaseUrl());

const studies = (await sql`
  SELECT id, protocol_number FROM study
  WHERE ${studyFilter ?? null}::text IS NULL
     OR protocol_number = ${studyFilter ?? null}
     OR id::text = ${studyFilter ?? null}
  ORDER BY protocol_number`) as unknown as { id: string; protocol_number: string }[];
if (studies.length === 0) {
  console.error(studyFilter ? `no study matches '${studyFilter}'` : "no studies");
  await sql.end();
  process.exit(1);
}

const transport = dryRun ? null : nodemailer.createTransport(process.env.SMTP_URL);
const from = process.env.DIGEST_FROM ?? "pv-core digest <digest@localhost>";

for (const study of studies) {
  const data = await collectDigest(sql, study.id);
  const { subject, text } = renderDigest(data);
  const to = process.env.DIGEST_TO
    ? process.env.DIGEST_TO.split(",").map((s) => s.trim())
    : (await digestRecipients(sql, study.id)).map((r) => r.email);

  if (to.length === 0) {
    console.warn(
      `${study.protocol_number}: no recipients (no covering admin/processor/reviewer grants); skipped`,
    );
    continue;
  }
  if (transport) {
    await transport.sendMail({ from, to, subject, text });
    console.log(
      `${study.protocol_number}: sent to ${to.join(", ")} (${attentionCount(data)} attention items)`,
    );
  } else {
    console.log(`--- ${subject}`);
    console.log(`--- to: ${to.join(", ")}${process.env.SMTP_URL ? "" : " (no SMTP_URL, dry run)"}`);
    console.log(text);
    console.log("");
  }
}

await sql.end();
