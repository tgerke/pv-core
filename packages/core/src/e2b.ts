import type { Sql } from "@pv-core/db";
import { CoreError } from "./errors.js";

/**
 * E2B(R3)-shaped JSON export (ADR-0009): the case version keyed by ICH E2B(R3)
 * IG data-element IDs, with the IG's numeric codes for coded elements (value
 * sets verified against the IG source, ADR-0010). Not an XML message and not
 * schema-validated; XML lands when the ICH schema package is in the verified
 * source library.
 */

const REPORT_TYPE: Record<string, number> = { spontaneous: 1, study: 2, other: 3, unknown: 4 }; // C.1.3
const STUDY_TYPE: Record<string, number> = {
  clinical_trial: 1,
  individual_patient_use: 2,
  other_study: 3,
}; // C.5.4
const QUALIFICATION: Record<string, number> = {
  physician: 1,
  pharmacist: 2,
  other_health_professional: 3,
  lawyer: 4,
  consumer: 5,
}; // C.2.r.4
const SEX: Record<string, number> = { male: 1, female: 2 }; // D.5 (ISO 5218)
const AGE_UNIT: Record<string, string> = {
  years: "a",
  months: "mo",
  weeks: "wk",
  days: "d",
  hours: "h",
}; // D.2.2b UCUM
const AGE_GROUP: Record<string, number> = {
  foetus: 0,
  neonate: 1,
  infant: 2,
  child: 3,
  adolescent: 4,
  adult: 5,
  elderly: 6,
}; // D.2.3
const OUTCOME: Record<string, number> = {
  recovered: 1,
  recovering: 2,
  not_recovered: 3,
  recovered_with_sequelae: 4,
  fatal: 5,
  unknown: 0,
}; // E.i.7
const DRUG_ROLE: Record<string, number> = {
  suspect: 1,
  concomitant: 2,
  interacting: 3,
  not_administered: 4,
}; // G.k.1
const ACTION_TAKEN: Record<string, number> = {
  drug_withdrawn: 1,
  dose_reduced: 2,
  dose_increased: 3,
  dose_not_changed: 4,
  unknown: 0,
  not_applicable: 9,
}; // G.k.8
const RECHALLENGE: Record<string, number> = {
  recurred: 1,
  did_not_recur: 2,
  outcome_unknown: 3,
  not_rechallenged: 4,
}; // G.k.9.i.4

type Row = Record<string, unknown>;

export interface E2bExport {
  meta: {
    format: "pv-core/e2b-r3-json";
    schema_validated: false;
    generated_at: string;
    case_version_id: string;
    version_number: number;
    version_sha256: string;
    dictionary: { version: string; is_demo_subset: boolean };
  };
  // biome-ignore lint/suspicious/noExplicitAny: element values are heterogeneous JSON
  [element: string]: any;
}

export async function buildE2bJson(sql: Sql, versionId: string): Promise<E2bExport> {
  const [v] = (await sql`
    SELECT cv.*, c.worldwide_unique_id, c.sender_case_id, c.report_type, c.first_received_date, c.study_id,
      st.protocol_number, st.title AS study_title, st.ind_number, st.eu_ct_number, st.study_type,
      org.name AS sponsor_name, d.version AS dictionary_version, d.is_demo_subset,
      pv_case_version_sha256(cv.id) AS version_sha256,
      r.expedited_class,
      n.reason AS nullification_reason
    FROM case_version cv
    JOIN "case" c ON c.id = cv.case_id
    LEFT JOIN study st ON st.id = c.study_id
    LEFT JOIN product pr ON pr.id = c.product_id
    LEFT JOIN organization org ON org.id = coalesce(st.sponsor_org_id, pr.sponsor_org_id)
    JOIN dictionary d ON d.id = cv.dictionary_id
    JOIN v_case_reportability r ON r.case_version_id = cv.id
    LEFT JOIN case_nullification n ON n.case_id = c.id
    WHERE cv.id = ${versionId}`) as Row[];
  if (!v) throw new CoreError("not_found", "case version not found");

  const [patient] =
    (await sql`SELECT * FROM case_patient WHERE case_version_id = ${versionId}`) as Row[];
  const sources =
    (await sql`SELECT * FROM case_source WHERE case_version_id = ${versionId} ORDER BY seq`) as Row[];
  const events =
    (await sql`SELECT * FROM case_event WHERE case_version_id = ${versionId} ORDER BY seq`) as Row[];
  const drugs =
    (await sql`SELECT * FROM case_drug WHERE case_version_id = ${versionId} ORDER BY seq`) as Row[];
  const assessments = (await sql`
    SELECT a.*, d.seq AS drug_seq, e.seq AS event_seq FROM case_assessment a
    JOIN case_drug d ON d.id = a.case_drug_id JOIN case_event e ON e.id = a.case_event_id
    WHERE a.case_version_id = ${versionId} ORDER BY d.seq, e.seq, a.assessor`) as Row[];
  const tests =
    (await sql`SELECT * FROM case_test WHERE case_version_id = ${versionId} ORDER BY seq`) as Row[];
  const [narrative] =
    (await sql`SELECT * FROM case_narrative WHERE case_version_id = ${versionId}`) as Row[];

  const s = (x: unknown) => (x == null ? null : String(x));
  const registrations: Row[] = [];
  if (v.ind_number) registrations.push({ "C.5.1.r.1": v.ind_number, "C.5.1.r.2": "US" });
  if (v.eu_ct_number) registrations.push({ "C.5.1.r.1": v.eu_ct_number, "C.5.1.r.2": "EU" });

  const doc: E2bExport = {
    meta: {
      format: "pv-core/e2b-r3-json",
      schema_validated: false,
      generated_at: new Date().toISOString(),
      case_version_id: versionId,
      version_number: Number(v.version_number),
      version_sha256: String(v.version_sha256),
      dictionary: {
        version: String(v.dictionary_version),
        is_demo_subset: Boolean(v.is_demo_subset),
      },
    },
    // C.1 Identification of the case safety report
    "C.1.1": v.sender_case_id,
    "C.1.2": new Date().toISOString(),
    "C.1.3": REPORT_TYPE[String(v.report_type)],
    "C.1.4": s(v.first_received_date),
    "C.1.5": s(v.info_received_date),
    "C.1.7": v.expedited_class !== "none",
    "C.1.8.1": v.worldwide_unique_id,
    "C.1.8.2": 2, // first sender: other (sponsor)
    ...(v.nullification_reason
      ? { "C.1.11.1": 1, "C.1.11.2": v.nullification_reason }
      : v.kind === "amendment"
        ? { "C.1.11.1": 2, "C.1.11.2": "Amendment" }
        : {}),
    // C.2.r Primary source(s)
    "C.2.r": sources.map((r) => ({
      "C.2.r.1.2": r.given_name,
      "C.2.r.1.4": r.family_name,
      "C.2.r.2.1": r.organization,
      "C.2.r.3": r.country,
      "C.2.r.4": r.qualification ? QUALIFICATION[String(r.qualification)] : null,
      ...(r.is_primary_for_regulatory ? { "C.2.r.5": 1 } : {}),
    })),
    // C.3 Sender
    "C.3.1": 1, // pharmaceutical company (the sponsor)
    "C.3.2": v.sponsor_name,
    // C.5 Study identification
    ...(v.study_id
      ? {
          "C.5.1.r": registrations,
          "C.5.2": v.study_title,
          "C.5.3": v.protocol_number,
          "C.5.4": STUDY_TYPE[String(v.study_type)],
        }
      : {}),
    // D Patient characteristics
    D: patient
      ? {
          "D.1": patient.initials,
          "D.1.1.4": patient.subject_number,
          ...(patient.age_value != null
            ? {
                "D.2.2a": Number(patient.age_value),
                "D.2.2b": AGE_UNIT[String(patient.age_unit)] ?? null,
              }
            : {}),
          ...(patient.age_group ? { "D.2.3": AGE_GROUP[String(patient.age_group)] } : {}),
          "D.3": patient.weight_kg == null ? null : Number(patient.weight_kg),
          "D.4": patient.height_cm == null ? null : Number(patient.height_cm),
          "D.5":
            patient.sex && SEX[String(patient.sex)] !== undefined ? SEX[String(patient.sex)] : null,
          "D.7.2": patient.medical_history_text,
          "D.9.1": s(patient.death_date),
          ...(patient.death_cause_text
            ? { "D.9.2.r": [{ "D.9.2.r.2": patient.death_cause_text }] }
            : {}),
        }
      : null,
    // E.i Reaction(s) / event(s)
    "E.i": events.map((e) => ({
      "E.i.1.1a": e.reported_term,
      "E.i.2.1a": v.dictionary_version,
      "E.i.2.1b": e.llt_code,
      "E.i.3.2a": e.serious_death,
      "E.i.3.2b": e.serious_life_threatening,
      "E.i.3.2c": e.serious_hospitalization,
      "E.i.3.2d": e.serious_disabling,
      "E.i.3.2e": e.serious_congenital_anomaly,
      "E.i.3.2f": e.serious_other_medically_important,
      "E.i.4": s(e.onset_date),
      "E.i.5": s(e.end_date),
      "E.i.7": OUTCOME[String(e.outcome)],
      "E.i.8": e.medically_confirmed,
      "E.i.9": e.occur_country,
    })),
    // F.r Results of tests and procedures
    "F.r": tests.map((t) => ({
      "F.r.1": s(t.test_date),
      "F.r.2.1": t.test_name,
      "F.r.3.4": [t.result_text, t.unit].filter(Boolean).join(" ") || null,
      "F.r.6": t.comments,
    })),
    // G.k Drug(s) information, with the G.k.9.i drug-reaction matrix
    "G.k": drugs.map((d) => ({
      "G.k.1": DRUG_ROLE[String(d.role)],
      "G.k.2.2": d.name_as_reported,
      "G.k.2.5": d.is_blinded,
      "G.k.4.r": [
        {
          "G.k.4.r.1a": d.dose_value == null ? null : Number(d.dose_value),
          "G.k.4.r.1b": d.dose_unit,
          "G.k.4.r.4": s(d.start_date),
          "G.k.4.r.5": s(d.end_date),
          "G.k.4.r.7": d.lot_number,
          "G.k.4.r.8": d.dose_text,
          "G.k.4.r.10": d.route,
        },
      ],
      "G.k.7.r":
        d.indication_pt_code || d.indication_pt_term
          ? [{ "G.k.7.r.1": d.indication_pt_term, "G.k.7.r.2": d.indication_pt_code }]
          : [],
      "G.k.8": d.action_taken ? ACTION_TAKEN[String(d.action_taken)] : null,
      "G.k.9.i": assessments
        .filter((a) => a.drug_seq === d.seq)
        .map((a) => ({
          "G.k.9.i.1": `E.${a.event_seq}`,
          "G.k.9.i.2.r": [
            {
              "G.k.9.i.2.r.1": a.assessor,
              "G.k.9.i.2.r.2": a.causality_method,
              "G.k.9.i.2.r.3":
                a.causality_result ?? (a.reasonable_possibility ? "Related" : "Not related"),
              reasonable_possibility: a.reasonable_possibility,
            },
          ],
          "G.k.9.i.4": a.rechallenge ? RECHALLENGE[String(a.rechallenge)] : null,
        })),
    })),
    // H Narrative case summary and further information
    H: {
      "H.1": narrative?.narrative ?? null,
      "H.2": narrative?.reporter_comments ?? null,
      ...(narrative?.sender_diagnosis_pt_code
        ? {
            "H.3.r": [
              { "H.3.r.1a": v.dictionary_version, "H.3.r.1b": narrative.sender_diagnosis_pt_code },
            ],
          }
        : {}),
      "H.4": narrative?.sender_comments ?? null,
    },
  };
  return doc;
}
