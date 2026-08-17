import type { Sql } from "@pv-core/db";
import { CoreError } from "./errors.js";

/**
 * Everything a rendering of a case version needs, loaded once. Used by the
 * CIOMS I and MedWatch 3500A renderers (ADR-0012); the E2B(R3) JSON export
 * carries its own reportability joins.
 */

type Row = Record<string, unknown>;

export interface VersionSnapshot {
  version: Row;
  case: Row;
  study: Row | null;
  sponsor: Row | null;
  reportability: Row;
  patient: Row | null;
  site: Row | null;
  sources: Row[];
  events: Row[];
  drugs: Row[];
  assessments: Row[];
  tests: Row[];
  narrative: Row | null;
  nullification: Row | null;
  versionSha256: string;
}

export async function loadVersionSnapshot(sql: Sql, versionId: string): Promise<VersionSnapshot> {
  const [version] =
    (await sql`SELECT cv.*, d.version AS dictionary_version, d.is_demo_subset FROM case_version cv JOIN dictionary d ON d.id = cv.dictionary_id WHERE cv.id = ${versionId}`) as Row[];
  if (!version) throw new CoreError("not_found", "case version not found");
  const [c] = (await sql`SELECT * FROM "case" WHERE id = ${version.case_id as string}`) as Row[];
  const [study] = c!.study_id
    ? ((await sql`SELECT * FROM study WHERE id = ${c!.study_id as string}`) as Row[])
    : [null];
  const [product] =
    (await sql`SELECT * FROM product WHERE id = ${c!.product_id as string}`) as Row[];
  const [sponsor] =
    (await sql`SELECT * FROM organization WHERE id = ${(study?.sponsor_org_id ?? product?.sponsor_org_id) as string}`) as Row[];
  const [reportability] =
    (await sql`SELECT * FROM v_case_reportability WHERE case_version_id = ${versionId}`) as Row[];
  const [patient] =
    (await sql`SELECT * FROM case_patient WHERE case_version_id = ${versionId}`) as Row[];
  const [site] = patient?.study_site_id
    ? ((await sql`SELECT ss.site_number, s.name, s.city, s.country FROM study_site ss JOIN site s ON s.id = ss.site_id WHERE ss.id = ${patient.study_site_id as string}`) as Row[])
    : [null];
  const sources =
    (await sql`SELECT * FROM case_source WHERE case_version_id = ${versionId} ORDER BY is_primary_for_regulatory DESC, seq`) as Row[];
  const events = (await sql`
    SELECT e.*, er.serious, er.fatal_or_life_threatening, er.expectedness, er.expectedness_basis, er.rsi_label,
      er.reporter_related, er.sponsor_related, er.related_either
    FROM case_event e JOIN v_case_event_reportability er ON er.case_event_id = e.id
    WHERE e.case_version_id = ${versionId} ORDER BY e.seq`) as Row[];
  const drugs =
    (await sql`SELECT d.*, p.name AS product_name FROM case_drug d LEFT JOIN product p ON p.id = d.product_id WHERE d.case_version_id = ${versionId} ORDER BY d.seq`) as Row[];
  const assessments = (await sql`
    SELECT a.*, d.seq AS drug_seq, e.seq AS event_seq FROM case_assessment a
    JOIN case_drug d ON d.id = a.case_drug_id JOIN case_event e ON e.id = a.case_event_id
    WHERE a.case_version_id = ${versionId} ORDER BY d.seq, e.seq, a.assessor`) as Row[];
  const tests =
    (await sql`SELECT * FROM case_test WHERE case_version_id = ${versionId} ORDER BY seq`) as Row[];
  const [narrative] =
    (await sql`SELECT * FROM case_narrative WHERE case_version_id = ${versionId}`) as Row[];
  const [nullification] =
    (await sql`SELECT * FROM case_nullification WHERE case_id = ${c!.id as string}`) as Row[];
  const [h] = (await sql`SELECT pv_case_version_sha256(${versionId}::uuid) AS h`) as {
    h: string;
  }[];
  return {
    version,
    case: c!,
    study: study ?? null,
    sponsor: sponsor ?? null,
    reportability: reportability!,
    patient: patient ?? null,
    site: site ?? null,
    sources,
    events,
    drugs,
    assessments,
    tests,
    narrative: narrative ?? null,
    nullification: nullification ?? null,
    versionSha256: h!.h,
  };
}

// --- shared derivations -----------------------------------------------------------

export const str = (v: unknown): string => (v == null ? "" : String(v));

/** Suspect and interacting drugs (E2B(R3) G.k.1 = 1 or 3). */
export const suspectDrugs = (s: VersionSnapshot) =>
  s.drugs.filter((d) => d.role === "suspect" || d.role === "interacting");
export const concomitantDrugs = (s: VersionSnapshot) =>
  s.drugs.filter((d) => d.role === "concomitant");

/** The most serious event first (death > life-threatening > hospitalisation > disability > congenital > other). */
export function primaryEvent(s: VersionSnapshot): Row | null {
  const rank = (e: Row) =>
    e.serious_death
      ? 1
      : e.serious_life_threatening
        ? 2
        : e.serious_hospitalization
          ? 3
          : e.serious_disabling
            ? 4
            : e.serious_congenital_anomaly
              ? 5
              : e.serious_other_medically_important
                ? 6
                : 7;
  return (
    [...s.events].sort((a, b) => rank(a) - rank(b) || Number(a.seq) - Number(b.seq))[0] ?? null
  );
}

export function anyEvent(s: VersionSnapshot, key: string): boolean {
  return s.events.some((e) => e[key] === true);
}

/** Dechallenge: did the reaction abate after the drug was withdrawn or reduced? YES / NO / NA. */
export function dechallenge(s: VersionSnapshot): "YES" | "NO" | "NA" {
  const withdrawn = suspectDrugs(s).some(
    (d) => d.action_taken === "drug_withdrawn" || d.action_taken === "dose_reduced",
  );
  if (!withdrawn) return "NA";
  const outcomes = s.events.map((e) => String(e.outcome));
  if (
    outcomes.every(
      (o) => o === "recovered" || o === "recovering" || o === "recovered_with_sequelae",
    )
  )
    return "YES";
  if (outcomes.some((o) => o === "not_recovered" || o === "fatal")) return "NO";
  return "NA";
}

/** Rechallenge (E2B(R3) G.k.9.i.4): recurred = YES, did not recur = NO, else NA. */
export function rechallenge(s: VersionSnapshot): "YES" | "NO" | "NA" {
  const values = s.assessments.map((a) => a.rechallenge);
  if (values.includes("recurred")) return "YES";
  if (values.includes("did_not_recur")) return "NO";
  return "NA";
}

export function describeReactions(s: VersionSnapshot): string {
  const lines = s.events.map((e) => {
    const bits = [
      `${str(e.reported_term)}${e.pt_term ? ` [MedDRA PT: ${str(e.pt_term)}${s.version.is_demo_subset ? " (demo dictionary)" : ""}]` : ""}`,
      e.onset_date ? `onset ${str(e.onset_date)}` : null,
      e.end_date ? `end ${str(e.end_date)}` : null,
      `outcome: ${str(e.outcome).replace(/_/g, " ")}`,
    ].filter(Boolean);
    return `- ${bits.join("; ")}`;
  });
  const tests = s.tests.map(
    (t) =>
      `- ${str(t.test_name)}: ${[t.result_text, t.unit].filter(Boolean).join(" ")}${t.test_date ? ` (${str(t.test_date)})` : ""}`,
  );
  return [
    lines.join("\n"),
    s.narrative?.narrative ? `\n${str(s.narrative.narrative)}` : "",
    tests.length ? `\nRelevant tests:\n${tests.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function therapyDuration(d: Row): string {
  if (!d.start_date) return "";
  const start = new Date(`${str(d.start_date)}T00:00:00Z`);
  const end = d.end_date ? new Date(`${str(d.end_date)}T00:00:00Z`) : null;
  if (!end) return "ongoing";
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"}`;
}
