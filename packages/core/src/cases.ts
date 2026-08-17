import type { Db } from "@pv-core/db";
import {
  caseAssessment,
  caseDrug,
  caseEvent,
  caseEventDesignation,
  caseNarrative,
  caseNullification,
  casePatient,
  caseSource,
  caseTest,
  caseTransition,
  caseUnblinding,
  caseVersion,
  pvCase,
  signature,
} from "@pv-core/db";
import { and, eq, sql } from "drizzle-orm";
import { type Actor, type Tx, withActor } from "./actor.js";
import { CoreError, fromPgError } from "./errors.js";

// ---------------------------------------------------------------------------
// Input shapes (the API's zod schemas mirror these). Element IDs are E2B(R3).
// ---------------------------------------------------------------------------

export type Sex = "male" | "female" | "unknown";
export type AgeUnit = "years" | "months" | "weeks" | "days" | "hours";
export type AgeGroup =
  | "foetus"
  | "neonate"
  | "infant"
  | "child"
  | "adolescent"
  | "adult"
  | "elderly";
export type Qualification =
  | "physician"
  | "pharmacist"
  | "other_health_professional"
  | "lawyer"
  | "consumer";
export type Outcome =
  | "recovered"
  | "recovering"
  | "not_recovered"
  | "recovered_with_sequelae"
  | "fatal"
  | "unknown";
export type DrugRole = "suspect" | "concomitant" | "interacting" | "not_administered";
export type ActionTaken =
  | "drug_withdrawn"
  | "dose_reduced"
  | "dose_increased"
  | "dose_not_changed"
  | "unknown"
  | "not_applicable";
export type Rechallenge = "recurred" | "did_not_recur" | "outcome_unknown" | "not_rechallenged";
export type Assessor = "reporter" | "sponsor";
export type Expectedness = "expected" | "unexpected";
export type VersionKind = "initial" | "follow_up" | "amendment";
export type WorkflowState = "data_entry" | "medical_review" | "closed";
export type SignatureMeaning = "medical_review" | "approval";
export type ReauthMethod = "oidc_fresh_token" | "dev_token" | "seed_fixture";
export type ReceiptChannel = "email" | "fax" | "phone" | "edc_push" | "other";

export interface PatientInput {
  initials?: string | null;
  subjectNumber?: string | null;
  studySiteId?: string | null;
  ageValue?: number | null;
  ageUnit?: AgeUnit | null;
  ageGroup?: AgeGroup | null;
  sex?: Sex | null;
  weightKg?: number | null;
  heightCm?: number | null;
  medicalHistoryText?: string | null;
  deathDate?: string | null;
  deathCauseText?: string | null;
}

export interface SourceInput {
  seq: number;
  givenName?: string | null;
  familyName?: string | null;
  organization?: string | null;
  country?: string | null;
  qualification?: Qualification | null;
  isPrimaryForRegulatory?: boolean;
  personId?: string | null;
}

export interface EventInput {
  seq: number;
  reportedTerm: string;
  /** LLT code in the version's dictionary; the hierarchy is snapshotted. */
  lltCode?: string | null;
  seriousDeath?: boolean;
  seriousLifeThreatening?: boolean;
  seriousHospitalization?: boolean;
  seriousDisabling?: boolean;
  seriousCongenitalAnomaly?: boolean;
  seriousOtherMedicallyImportant?: boolean;
  onsetDate?: string | null;
  endDate?: string | null;
  outcome?: Outcome;
  medicallyConfirmed?: boolean | null;
  occurCountry?: string | null;
}

export interface DrugInput {
  seq: number;
  role: DrugRole;
  productId?: string | null;
  nameAsReported: string;
  isBlinded?: boolean;
  lotNumber?: string | null;
  indicationPtCode?: string | null;
  indicationPtTerm?: string | null;
  doseText?: string | null;
  doseValue?: number | null;
  doseUnit?: string | null;
  route?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  actionTaken?: ActionTaken | null;
}

export interface AssessmentInput {
  drugSeq: number;
  eventSeq: number;
  assessor: Assessor;
  reasonablePossibility: boolean;
  causalityMethod?: string | null;
  causalityResult?: string | null;
  rechallenge?: Rechallenge | null;
  expectednessOverride?: Expectedness | null;
  expectednessRationale?: string | null;
  rsiVersionId?: string | null;
}

export interface TestInput {
  seq: number;
  testDate?: string | null;
  testName: string;
  resultText?: string | null;
  unit?: string | null;
  comments?: string | null;
}

export interface NarrativeInput {
  narrative?: string | null;
  reporterComments?: string | null;
  senderDiagnosisPtCode?: string | null;
  senderDiagnosisPtTerm?: string | null;
  senderComments?: string | null;
}

/**
 * The sponsor's designation of an event as anticipated in the study population
 * (FDA IND safety reporting guidance, December 2025, §V.A / §VI.A). Anticipated
 * designations name a concept on the study's list; a "not anticipated"
 * designation records that the question was considered.
 */
export interface DesignationInput {
  eventSeq: number;
  anticipated: boolean;
  anticipatedEventId?: string | null;
  rationale?: string | null;
}

export interface CaseSections {
  patient?: PatientInput;
  sources?: SourceInput[];
  events?: EventInput[];
  drugs?: DrugInput[];
  assessments?: AssessmentInput[];
  tests?: TestInput[];
  narrative?: NarrativeInput;
  /** Sponsor-only (the API gates it with `assess`); replace semantics. */
  designations?: DesignationInput[];
}

export interface CreateCaseInput extends CaseSections {
  studyId?: string | null;
  productId: string;
  reportType?: "spontaneous" | "study" | "other" | "unknown";
  firstReceivedDate: string;
  infoReceivedDate?: string;
  awarenessDate?: string;
  awarenessRationale?: string | null;
  dictionaryId?: string;
  senderCaseId?: string;
  worldwideUniqueId?: string;
  replacesCaseId?: string | null;
  /** How the report reached the safety database and the reference it carried. */
  receivedVia?: ReceiptChannel | null;
  receivedRef?: string | null;
  source?: { system: string; ref: string; payload?: unknown } | null;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const mapped = fromPgError(err);
    if (mapped) throw mapped;
    throw err;
  }
}

/** The MedDRA path for an LLT in the given dictionary (snapshotted onto events). */
async function resolveTerm(tx: Tx, dictionaryId: string, lltCode: string) {
  const rows = await tx.execute(sql`
    SELECT code, term, pt_code, pt_term, hlt_code, hlt_term, hlgt_code, hlgt_term, soc_code, soc_term
    FROM dictionary_term WHERE dictionary_id = ${dictionaryId} AND code = ${lltCode}`);
  const r = rows[0];
  if (!r) throw new CoreError("invalid", `LLT ${lltCode} is not in the version's dictionary`);
  return {
    lltCode: r.code as string,
    lltTerm: r.term as string,
    ptCode: r.pt_code as string,
    ptTerm: r.pt_term as string,
    hltCode: (r.hlt_code as string | null) ?? null,
    hltTerm: (r.hlt_term as string | null) ?? null,
    hlgtCode: (r.hlgt_code as string | null) ?? null,
    hlgtTerm: (r.hlgt_term as string | null) ?? null,
    socCode: r.soc_code as string,
    socTerm: r.soc_term as string,
  };
}

async function defaultDictionaryId(tx: Tx): Promise<string> {
  const rows = await tx.execute(
    sql`SELECT value FROM app_meta WHERE key = 'meddra_default_dictionary_id'`,
  );
  const v = rows[0]?.value as string | undefined;
  if (v) return v;
  const any = await tx.execute(
    sql`SELECT id FROM dictionary WHERE type = 'MedDRA' ORDER BY is_demo_subset, created_at DESC LIMIT 1`,
  );
  const id = any[0]?.id as string | undefined;
  if (!id)
    throw new CoreError(
      "invalid",
      "no MedDRA dictionary loaded; run pnpm db:import-meddra or seed",
    );
  return id;
}

async function versionRow(tx: Tx, versionId: string) {
  const [v] = await tx.select().from(caseVersion).where(eq(caseVersion.id, versionId)).limit(1);
  if (!v) throw new CoreError("not_found", "case version not found");
  return v;
}

export async function syncVersion(tx: Tx, versionId: string): Promise<number> {
  const rows = await tx.execute(sql`SELECT pv_sync_expected_submissions(${versionId}::uuid) AS n`);
  return Number(rows[0]?.n ?? 0);
}

export async function versionHash(tx: Tx, versionId: string): Promise<string> {
  const rows = await tx.execute(sql`SELECT pv_case_version_sha256(${versionId}::uuid) AS h`);
  return rows[0]?.h as string;
}

/** Word initials of an organization name: "Cascade Oncology Research Consortium" -> CORC. */
function orgCode(name: string): string {
  const code = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return code.slice(0, 8) || "ORG";
}

/** C.1.1 sender case id: CC-org-number, numbered per sponsor and year. */
async function nextSenderCaseId(tx: Tx, sponsorOrgId: string, country: string): Promise<string> {
  const [org] = await tx.execute(sql`SELECT name FROM organization WHERE id = ${sponsorOrgId}`);
  const code = orgCode((org?.name as string | undefined) ?? "ORG");
  const year = new Date().getUTCFullYear();
  const prefix = `${country}-${code}-${year}-`;
  const [row] = await tx.execute(sql`
    SELECT count(*)::int AS n FROM "case" WHERE sender_case_id LIKE ${`${prefix}%`}`);
  const n = Number(row?.n ?? 0) + 1;
  return `${prefix}${String(n).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Section writers (mutable until signed; every change is audited)
// ---------------------------------------------------------------------------

async function writePatient(tx: Tx, versionId: string, p: PatientInput) {
  const values = {
    caseVersionId: versionId,
    initials: p.initials ?? null,
    subjectNumber: p.subjectNumber ?? null,
    studySiteId: p.studySiteId ?? null,
    ageValue: p.ageValue ?? null,
    ageUnit: p.ageUnit ?? null,
    ageGroup: p.ageGroup ?? null,
    sex: p.sex ?? null,
    weightKg: p.weightKg == null ? null : String(p.weightKg),
    heightCm: p.heightCm == null ? null : String(p.heightCm),
    medicalHistoryText: p.medicalHistoryText ?? null,
    deathDate: p.deathDate ?? null,
    deathCauseText: p.deathCauseText ?? null,
  };
  const existing = await tx
    .select({ id: casePatient.id })
    .from(casePatient)
    .where(eq(casePatient.caseVersionId, versionId));
  if (existing[0])
    await tx.update(casePatient).set(values).where(eq(casePatient.id, existing[0].id));
  else await tx.insert(casePatient).values(values);
}

async function writeSources(tx: Tx, versionId: string, rows: SourceInput[]) {
  await tx.delete(caseSource).where(eq(caseSource.caseVersionId, versionId));
  if (rows.length === 0) return;
  await tx.insert(caseSource).values(
    rows.map((r) => ({
      caseVersionId: versionId,
      seq: r.seq,
      givenName: r.givenName ?? null,
      familyName: r.familyName ?? null,
      organization: r.organization ?? null,
      country: r.country ?? null,
      qualification: r.qualification ?? null,
      isPrimaryForRegulatory: r.isPrimaryForRegulatory ?? false,
      personId: r.personId ?? null,
    })),
  );
}

async function writeEvents(tx: Tx, versionId: string, dictionaryId: string, rows: EventInput[]) {
  const existing = await tx
    .select({ id: caseEvent.id, seq: caseEvent.seq })
    .from(caseEvent)
    .where(eq(caseEvent.caseVersionId, versionId));
  const keep = new Set(rows.map((r) => r.seq));
  for (const e of existing.filter((e) => !keep.has(e.seq))) {
    await tx.delete(caseAssessment).where(eq(caseAssessment.caseEventId, e.id));
    await tx.delete(caseEventDesignation).where(eq(caseEventDesignation.caseEventId, e.id));
    await tx.delete(caseEvent).where(eq(caseEvent.id, e.id));
  }
  for (const r of rows) {
    const term = r.lltCode ? await resolveTerm(tx, dictionaryId, r.lltCode) : null;
    const values = {
      caseVersionId: versionId,
      seq: r.seq,
      reportedTerm: r.reportedTerm,
      dictionaryId: term ? dictionaryId : null,
      lltCode: term?.lltCode ?? null,
      lltTerm: term?.lltTerm ?? null,
      ptCode: term?.ptCode ?? null,
      ptTerm: term?.ptTerm ?? null,
      hltCode: term?.hltCode ?? null,
      hltTerm: term?.hltTerm ?? null,
      hlgtCode: term?.hlgtCode ?? null,
      hlgtTerm: term?.hlgtTerm ?? null,
      socCode: term?.socCode ?? null,
      socTerm: term?.socTerm ?? null,
      seriousDeath: r.seriousDeath ?? false,
      seriousLifeThreatening: r.seriousLifeThreatening ?? false,
      seriousHospitalization: r.seriousHospitalization ?? false,
      seriousDisabling: r.seriousDisabling ?? false,
      seriousCongenitalAnomaly: r.seriousCongenitalAnomaly ?? false,
      seriousOtherMedicallyImportant: r.seriousOtherMedicallyImportant ?? false,
      onsetDate: r.onsetDate ?? null,
      endDate: r.endDate ?? null,
      outcome: r.outcome ?? "unknown",
      medicallyConfirmed: r.medicallyConfirmed ?? null,
      occurCountry: r.occurCountry ?? null,
    };
    const cur = existing.find((e) => e.seq === r.seq);
    if (cur) await tx.update(caseEvent).set(values).where(eq(caseEvent.id, cur.id));
    else await tx.insert(caseEvent).values(values);
  }
}

async function writeDrugs(tx: Tx, versionId: string, rows: DrugInput[]) {
  const existing = await tx
    .select({ id: caseDrug.id, seq: caseDrug.seq })
    .from(caseDrug)
    .where(eq(caseDrug.caseVersionId, versionId));
  const keep = new Set(rows.map((r) => r.seq));
  for (const d of existing.filter((d) => !keep.has(d.seq))) {
    await tx.delete(caseAssessment).where(eq(caseAssessment.caseDrugId, d.id));
    await tx.delete(caseDrug).where(eq(caseDrug.id, d.id));
  }
  for (const r of rows) {
    const values = {
      caseVersionId: versionId,
      seq: r.seq,
      role: r.role,
      productId: r.productId ?? null,
      nameAsReported: r.nameAsReported,
      isBlinded: r.isBlinded ?? false,
      lotNumber: r.lotNumber ?? null,
      indicationPtCode: r.indicationPtCode ?? null,
      indicationPtTerm: r.indicationPtTerm ?? null,
      doseText: r.doseText ?? null,
      doseValue: r.doseValue == null ? null : String(r.doseValue),
      doseUnit: r.doseUnit ?? null,
      route: r.route ?? null,
      startDate: r.startDate ?? null,
      endDate: r.endDate ?? null,
      actionTaken: r.actionTaken ?? null,
    };
    const cur = existing.find((d) => d.seq === r.seq);
    if (cur) await tx.update(caseDrug).set(values).where(eq(caseDrug.id, cur.id));
    else await tx.insert(caseDrug).values(values);
  }
}

async function writeAssessments(tx: Tx, versionId: string, rows: AssessmentInput[]) {
  await tx.delete(caseAssessment).where(eq(caseAssessment.caseVersionId, versionId));
  if (rows.length === 0) return;
  const drugs = await tx
    .select({ id: caseDrug.id, seq: caseDrug.seq })
    .from(caseDrug)
    .where(eq(caseDrug.caseVersionId, versionId));
  const events = await tx
    .select({ id: caseEvent.id, seq: caseEvent.seq })
    .from(caseEvent)
    .where(eq(caseEvent.caseVersionId, versionId));
  await tx.insert(caseAssessment).values(
    rows.map((r) => {
      const d = drugs.find((x) => x.seq === r.drugSeq);
      const e = events.find((x) => x.seq === r.eventSeq);
      if (!d)
        throw new CoreError(
          "invalid",
          `assessment references drug seq ${r.drugSeq}, which does not exist`,
        );
      if (!e)
        throw new CoreError(
          "invalid",
          `assessment references event seq ${r.eventSeq}, which does not exist`,
        );
      return {
        caseVersionId: versionId,
        caseDrugId: d.id,
        caseEventId: e.id,
        assessor: r.assessor,
        reasonablePossibility: r.reasonablePossibility,
        causalityMethod: r.causalityMethod ?? null,
        causalityResult: r.causalityResult ?? null,
        rechallenge: r.rechallenge ?? null,
        expectednessOverride: r.expectednessOverride ?? null,
        expectednessRationale: r.expectednessRationale ?? null,
        rsiVersionId: r.rsiVersionId ?? null,
      };
    }),
  );
}

/**
 * Replace the version's designations. An anticipated designation must name a
 * concept on the case's study list that is in effect on the version's
 * awareness date; the DB guard checks the study, this checks the window so a
 * later clone never fails on a concept that has since ended.
 */
async function writeDesignations(tx: Tx, versionId: string, rows: DesignationInput[]) {
  await tx.delete(caseEventDesignation).where(eq(caseEventDesignation.caseVersionId, versionId));
  if (rows.length === 0) return;
  const events = await tx
    .select({ id: caseEvent.id, seq: caseEvent.seq })
    .from(caseEvent)
    .where(eq(caseEvent.caseVersionId, versionId));
  const values = [];
  for (const r of rows) {
    const e = events.find((x) => x.seq === r.eventSeq);
    if (!e)
      throw new CoreError(
        "invalid",
        `designation references event seq ${r.eventSeq}, which does not exist`,
      );
    if (r.anticipated) {
      if (!r.anticipatedEventId)
        throw new CoreError(
          "invalid",
          `designation for event seq ${r.eventSeq}: an anticipated designation names a concept on the study's list`,
        );
      const [ok] = await tx.execute(sql`
        SELECT 1 FROM study_anticipated_event ae
        JOIN case_version cv ON cv.id = ${versionId}
        JOIN "case" c ON c.id = cv.case_id AND c.study_id = ae.study_id
        WHERE ae.id = ${r.anticipatedEventId}
          AND ae.effective_from <= cv.awareness_date
          AND (ae.effective_to IS NULL OR ae.effective_to >= cv.awareness_date)`);
      if (!ok)
        throw new CoreError(
          "invalid",
          `designation for event seq ${r.eventSeq}: the concept is not on this study's anticipated-event list in effect on the awareness date`,
        );
    } else if (r.anticipatedEventId) {
      throw new CoreError(
        "invalid",
        `designation for event seq ${r.eventSeq}: a "not anticipated" designation names no concept`,
      );
    }
    values.push({
      caseVersionId: versionId,
      caseEventId: e.id,
      anticipated: r.anticipated,
      anticipatedEventId: r.anticipated ? (r.anticipatedEventId ?? null) : null,
      rationale: r.rationale ?? null,
    });
  }
  await tx.insert(caseEventDesignation).values(values);
}

async function writeTests(tx: Tx, versionId: string, rows: TestInput[]) {
  await tx.delete(caseTest).where(eq(caseTest.caseVersionId, versionId));
  if (rows.length === 0) return;
  await tx.insert(caseTest).values(
    rows.map((r) => ({
      caseVersionId: versionId,
      seq: r.seq,
      testDate: r.testDate ?? null,
      testName: r.testName,
      resultText: r.resultText ?? null,
      unit: r.unit ?? null,
      comments: r.comments ?? null,
    })),
  );
}

async function writeNarrative(tx: Tx, versionId: string, n: NarrativeInput) {
  const values = {
    caseVersionId: versionId,
    narrative: n.narrative ?? null,
    reporterComments: n.reporterComments ?? null,
    senderDiagnosisPtCode: n.senderDiagnosisPtCode ?? null,
    senderDiagnosisPtTerm: n.senderDiagnosisPtTerm ?? null,
    senderComments: n.senderComments ?? null,
  };
  const existing = await tx
    .select({ id: caseNarrative.id })
    .from(caseNarrative)
    .where(eq(caseNarrative.caseVersionId, versionId));
  if (existing[0])
    await tx.update(caseNarrative).set(values).where(eq(caseNarrative.id, existing[0].id));
  else await tx.insert(caseNarrative).values(values);
}

async function writeSections(
  tx: Tx,
  versionId: string,
  dictionaryId: string,
  sections: CaseSections,
) {
  if (sections.patient) await writePatient(tx, versionId, sections.patient);
  if (sections.sources) await writeSources(tx, versionId, sections.sources);
  if (sections.events) await writeEvents(tx, versionId, dictionaryId, sections.events);
  if (sections.drugs) await writeDrugs(tx, versionId, sections.drugs);
  if (sections.assessments) await writeAssessments(tx, versionId, sections.assessments);
  if (sections.designations) await writeDesignations(tx, versionId, sections.designations);
  if (sections.tests) await writeTests(tx, versionId, sections.tests);
  if (sections.narrative) await writeNarrative(tx, versionId, sections.narrative);
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

export interface CaseCreated {
  caseId: string;
  caseVersionId: string;
  senderCaseId: string;
  worldwideUniqueId: string;
}

/** Create a case with its initial version and whatever sections arrived. */
export async function createCase(
  db: Db,
  actor: Actor,
  input: CreateCaseInput,
): Promise<CaseCreated> {
  return guarded(() =>
    withActor(db, actor, async (tx) => {
      const [prod] = await tx.execute(
        sql`SELECT sponsor_org_id FROM product WHERE id = ${input.productId}`,
      );
      if (!prod) throw new CoreError("invalid", "product not found");
      if (input.studyId) {
        const [st] = await tx.execute(
          sql`SELECT sponsor_org_id FROM study WHERE id = ${input.studyId}`,
        );
        if (!st) throw new CoreError("invalid", "study not found");
      }
      // C.1.1 country: the primary source's, else the reporting site's, else
      // the study's first site (a machine intake often arrives without a
      // reporter), else XX.
      let country =
        (input.sources?.find((s) => s.isPrimaryForRegulatory) ?? input.sources?.[0])?.country ??
        null;
      if (!country && input.patient?.studySiteId) {
        const [ss] = await tx.execute(
          sql`SELECT s.country FROM study_site ss JOIN site s ON s.id = ss.site_id WHERE ss.id = ${input.patient.studySiteId}`,
        );
        country = (ss?.country as string | undefined) ?? null;
      }
      if (!country && input.studyId) {
        const [ss] = await tx.execute(
          sql`SELECT s.country FROM study_site ss JOIN site s ON s.id = ss.site_id WHERE ss.study_id = ${input.studyId} ORDER BY ss.site_number LIMIT 1`,
        );
        country = (ss?.country as string | undefined) ?? null;
      }
      country = country ?? "XX";
      const senderCaseId =
        input.senderCaseId ?? (await nextSenderCaseId(tx, prod.sponsor_org_id as string, country));
      const worldwideUniqueId = input.worldwideUniqueId ?? senderCaseId;
      const dictionaryId = input.dictionaryId ?? (await defaultDictionaryId(tx));
      const payloadJson =
        input.source?.payload === undefined ? null : JSON.stringify(input.source.payload);
      const [c] = await tx
        .insert(pvCase)
        .values({
          worldwideUniqueId,
          senderCaseId,
          reportType: input.reportType ?? "study",
          studyId: input.studyId ?? null,
          productId: input.productId,
          firstReceivedDate: input.firstReceivedDate,
          receivedVia: input.receivedVia ?? null,
          receivedRef: input.receivedRef ?? null,
          sourceSystem: input.source?.system ?? null,
          sourceRef: input.source?.ref ?? null,
          intakePayload: input.source?.payload ?? null,
          intakePayloadSha256: payloadJson
            ? ((
                await tx.execute(sql`SELECT encode(digest(${payloadJson}, 'sha256'), 'hex') AS h`)
              )[0]?.h as string)
            : null,
          replacesCaseId: input.replacesCaseId ?? null,
          createdBy: input.createdBy,
        })
        .returning({ id: pvCase.id });
      const infoReceived = input.infoReceivedDate ?? input.firstReceivedDate;
      const [v] = await tx
        .insert(caseVersion)
        .values({
          caseId: c!.id,
          versionNumber: 1,
          kind: "initial",
          infoReceivedDate: infoReceived,
          awarenessDate: input.awarenessDate ?? infoReceived,
          awarenessRationale: input.awarenessRationale ?? null,
          dictionaryId,
          createdBy: input.createdBy,
        })
        .returning({ id: caseVersion.id });
      await writeSections(tx, v!.id, dictionaryId, input);
      await syncVersion(tx, v!.id);
      return { caseId: c!.id, caseVersionId: v!.id, senderCaseId, worldwideUniqueId };
    }),
  );
}

export interface OpenVersionInput {
  caseId: string;
  kind: Exclude<VersionKind, "initial">;
  infoReceivedDate: string;
  awarenessDate?: string;
  awarenessRationale?: string | null;
  dictionaryId?: string;
  createdBy: string;
}

/**
 * Open a follow-up or amendment: a new version cloned from the latest one
 * (ADR-0006). The clone is editable until signed; the clock syncs at once.
 */
export async function openVersion(
  db: Db,
  actor: Actor,
  input: OpenVersionInput,
): Promise<{ caseVersionId: string; versionNumber: number }> {
  return guarded(() =>
    withActor(db, actor, async (tx) => {
      // Serialize version numbering per case.
      await tx.execute(sql`SELECT id FROM "case" WHERE id = ${input.caseId} FOR UPDATE`);
      const [latest] = await tx
        .select()
        .from(caseVersion)
        .where(eq(caseVersion.caseId, input.caseId))
        .orderBy(sql`${caseVersion.versionNumber} DESC`)
        .limit(1);
      if (!latest) throw new CoreError("not_found", "case not found");
      const locked = await tx
        .select({ id: signature.id })
        .from(signature)
        .where(eq(signature.caseVersionId, latest.id))
        .limit(1);
      if (!locked[0]) {
        throw new CoreError(
          "conflict",
          `version ${latest.versionNumber} is still open (unsigned); edit it instead of opening a new one`,
        );
      }
      const versionNumber = latest.versionNumber + 1;
      const [v] = await tx
        .insert(caseVersion)
        .values({
          caseId: input.caseId,
          versionNumber,
          kind: input.kind,
          infoReceivedDate: input.infoReceivedDate,
          awarenessDate: input.awarenessDate ?? input.infoReceivedDate,
          awarenessRationale: input.awarenessRationale ?? null,
          dictionaryId: input.dictionaryId ?? latest.dictionaryId,
          createdBy: input.createdBy,
        })
        .returning({ id: caseVersion.id });
      const newId = v!.id;
      const from = latest.id;
      await tx.execute(sql`
        INSERT INTO case_patient (case_version_id, initials, subject_number, study_site_id, age_value, age_unit, age_group, sex,
          weight_kg, height_cm, medical_history_text, death_date, death_cause_text)
        SELECT ${newId}, initials, subject_number, study_site_id, age_value, age_unit, age_group, sex,
          weight_kg, height_cm, medical_history_text, death_date, death_cause_text
        FROM case_patient WHERE case_version_id = ${from}`);
      await tx.execute(sql`
        INSERT INTO case_source (case_version_id, seq, given_name, family_name, organization, country, qualification, is_primary_for_regulatory, person_id)
        SELECT ${newId}, seq, given_name, family_name, organization, country, qualification, is_primary_for_regulatory, person_id
        FROM case_source WHERE case_version_id = ${from}`);
      await tx.execute(sql`
        INSERT INTO case_event (case_version_id, seq, reported_term, dictionary_id, llt_code, llt_term, pt_code, pt_term, hlt_code, hlt_term,
          hlgt_code, hlgt_term, soc_code, soc_term, serious_death, serious_life_threatening, serious_hospitalization, serious_disabling,
          serious_congenital_anomaly, serious_other_medically_important, onset_date, end_date, outcome, medically_confirmed, occur_country)
        SELECT ${newId}, seq, reported_term, dictionary_id, llt_code, llt_term, pt_code, pt_term, hlt_code, hlt_term,
          hlgt_code, hlgt_term, soc_code, soc_term, serious_death, serious_life_threatening, serious_hospitalization, serious_disabling,
          serious_congenital_anomaly, serious_other_medically_important, onset_date, end_date, outcome, medically_confirmed, occur_country
        FROM case_event WHERE case_version_id = ${from}`);
      await tx.execute(sql`
        INSERT INTO case_drug (case_version_id, seq, role, product_id, name_as_reported, is_blinded, lot_number, indication_pt_code,
          indication_pt_term, dose_text, dose_value, dose_unit, route, start_date, end_date, action_taken)
        SELECT ${newId}, seq, role, product_id, name_as_reported, is_blinded, lot_number, indication_pt_code,
          indication_pt_term, dose_text, dose_value, dose_unit, route, start_date, end_date, action_taken
        FROM case_drug WHERE case_version_id = ${from}`);
      await tx.execute(sql`
        INSERT INTO case_assessment (case_version_id, case_drug_id, case_event_id, assessor, reasonable_possibility, causality_method,
          causality_result, rechallenge, expectedness_override, expectedness_rationale, rsi_version_id)
        SELECT ${newId}, nd.id, ne.id, a.assessor, a.reasonable_possibility, a.causality_method,
          a.causality_result, a.rechallenge, a.expectedness_override, a.expectedness_rationale, a.rsi_version_id
        FROM case_assessment a
        JOIN case_drug od ON od.id = a.case_drug_id
        JOIN case_event oe ON oe.id = a.case_event_id
        JOIN case_drug nd ON nd.case_version_id = ${newId} AND nd.seq = od.seq
        JOIN case_event ne ON ne.case_version_id = ${newId} AND ne.seq = oe.seq
        WHERE a.case_version_id = ${from}`);
      await tx.execute(sql`
        INSERT INTO case_event_designation (case_version_id, case_event_id, anticipated, anticipated_event_id, rationale)
        SELECT ${newId}, ne.id, g.anticipated, g.anticipated_event_id, g.rationale
        FROM case_event_designation g
        JOIN case_event oe ON oe.id = g.case_event_id
        JOIN case_event ne ON ne.case_version_id = ${newId} AND ne.seq = oe.seq
        WHERE g.case_version_id = ${from}`);
      await tx.execute(sql`
        INSERT INTO case_test (case_version_id, seq, test_date, test_name, result_text, unit, comments)
        SELECT ${newId}, seq, test_date, test_name, result_text, unit, comments FROM case_test WHERE case_version_id = ${from}`);
      await tx.execute(sql`
        INSERT INTO case_narrative (case_version_id, narrative, reporter_comments, sender_diagnosis_pt_code, sender_diagnosis_pt_term, sender_comments)
        SELECT ${newId}, narrative, reporter_comments, sender_diagnosis_pt_code, sender_diagnosis_pt_term, sender_comments
        FROM case_narrative WHERE case_version_id = ${from}`);
      await syncVersion(tx, newId);
      return { caseVersionId: newId, versionNumber };
    }),
  );
}

/** Replace one or more sections of an open version; the clock resyncs. */
export async function updateSections(
  db: Db,
  actor: Actor,
  versionId: string,
  sections: CaseSections,
): Promise<void> {
  await guarded(() =>
    withActor(db, actor, async (tx) => {
      const v = await versionRow(tx, versionId);
      await writeSections(tx, versionId, v.dictionaryId, sections);
      await syncVersion(tx, versionId);
    }),
  );
}

export interface VersionHeaderInput {
  infoReceivedDate?: string;
  awarenessDate?: string;
  awarenessRationale?: string | null;
}

/** Day zero and receipt date of an open version (ADR-0007). */
export async function updateVersionHeader(
  db: Db,
  actor: Actor,
  versionId: string,
  input: VersionHeaderInput,
): Promise<void> {
  await guarded(() =>
    withActor(db, actor, async (tx) => {
      await versionRow(tx, versionId);
      await tx
        .update(caseVersion)
        .set({
          ...(input.infoReceivedDate ? { infoReceivedDate: input.infoReceivedDate } : {}),
          ...(input.awarenessDate ? { awarenessDate: input.awarenessDate } : {}),
          ...(input.awarenessRationale !== undefined
            ? { awarenessRationale: input.awarenessRationale }
            : {}),
        })
        .where(eq(caseVersion.id, versionId));
      await syncVersion(tx, versionId);
    }),
  );
}

export interface TransitionInput {
  versionId: string;
  toState: WorkflowState;
  by: string;
  note?: string | null;
}

export async function transitionVersion(
  db: Db,
  actor: Actor,
  input: TransitionInput,
): Promise<void> {
  await guarded(() =>
    withActor(db, actor, async (tx) => {
      const v = await versionRow(tx, input.versionId);
      await tx.insert(caseTransition).values({
        caseId: v.caseId,
        caseVersionId: v.id,
        toState: input.toState,
        transitionedBy: input.by,
        note: input.note ?? null,
      });
    }),
  );
}

export interface SignInput {
  versionId: string;
  signerPersonId: string;
  meaning: SignatureMeaning;
  reauthMethod: ReauthMethod;
  reauthAt: Date;
}

/**
 * Sign a version (§11.50, §11.70, §11.200): the signature copies the version
 * hash; the first signature locks the version (ADR-0006).
 */
export async function signVersion(
  db: Db,
  actor: Actor,
  input: SignInput,
): Promise<{ signatureId: string; signedSha256: string }> {
  return guarded(() =>
    withActor(db, actor, async (tx) => {
      const v = await versionRow(tx, input.versionId);
      const nullified = await tx
        .select({ id: caseNullification.id })
        .from(caseNullification)
        .where(eq(caseNullification.caseId, v.caseId))
        .limit(1);
      if (nullified[0]) throw new CoreError("conflict", "case is nullified");
      const hash = await versionHash(tx, v.id);
      const [row] = await tx
        .insert(signature)
        .values({
          caseVersionId: v.id,
          signerPersonId: input.signerPersonId,
          meaning: input.meaning,
          signedSha256: hash,
          reauthMethod: input.reauthMethod,
          reauthAt: input.reauthAt,
        })
        .returning({ id: signature.id });
      return { signatureId: row!.id, signedSha256: hash };
    }),
  );
}

export interface NullifyInput {
  caseId: string;
  reason: string;
  by: string;
}

/** Nullify a case (C.1.11.1 = 1). A trigger rejects further versions. */
export async function nullifyCase(db: Db, actor: Actor, input: NullifyInput): Promise<void> {
  await guarded(() =>
    withActor(db, actor, async (tx) => {
      const [latest] = await tx
        .select({ id: caseVersion.id })
        .from(caseVersion)
        .where(eq(caseVersion.caseId, input.caseId))
        .orderBy(sql`${caseVersion.versionNumber} DESC`)
        .limit(1);
      if (!latest) throw new CoreError("not_found", "case not found");
      await tx
        .insert(caseNullification)
        .values({ caseId: input.caseId, reason: input.reason, nullifiedBy: input.by });
      await syncVersion(tx, latest.id);
    }),
  );
}

export interface UnblindingInput {
  caseId: string;
  armLabel: string;
  armRole: "imp" | "comparator" | "placebo" | "background";
  unblindedAt?: Date;
  by: string;
  reason: string;
  sourceSystem?: string | null;
  sourceRef?: string | null;
}

/** Record the unblinding fact (ADR-0008); rtsm-core did the code-break. */
export async function recordUnblinding(
  db: Db,
  actor: Actor,
  input: UnblindingInput,
): Promise<void> {
  await guarded(() =>
    withActor(db, actor, async (tx) => {
      const [c] = await tx
        .select({ id: pvCase.id })
        .from(pvCase)
        .where(eq(pvCase.id, input.caseId))
        .limit(1);
      if (!c) throw new CoreError("not_found", "case not found");
      await tx.insert(caseUnblinding).values({
        caseId: input.caseId,
        armLabel: input.armLabel,
        armRole: input.armRole,
        unblindedAt: input.unblindedAt ?? new Date(),
        unblindedBy: input.by,
        reason: input.reason,
        sourceSystem: input.sourceSystem ?? null,
        sourceRef: input.sourceRef ?? null,
      });
    }),
  );
}

/** Convenience for tests and tooling: is this version signed (locked)? */
export async function isLocked(db: Db, versionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: signature.id })
    .from(signature)
    .where(and(eq(signature.caseVersionId, versionId)))
    .limit(1);
  return rows.length > 0;
}
