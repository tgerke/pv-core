import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  type AssessmentInput,
  addAttachment,
  attachmentBytes,
  auditEvents,
  buildE2bJson,
  type CaseSections,
  CoreError,
  caseAuditTrail,
  caseDetail,
  caseQueue,
  collectDigest,
  createAnticipatedEvent,
  createCase,
  createDestination,
  createOrganization,
  createPerson,
  createProduct,
  createRsiVersion,
  createRule,
  createSite,
  createStudy,
  type DrugInput,
  digestRecipients,
  dsurSaeSummary,
  dsurSarLineListing,
  type EventInput,
  endAnticipatedEvent,
  endRsiVersion,
  endRule,
  expectedSubmissions,
  grantAccess,
  importDictionary,
  listAnticipatedEvents,
  listDestinations,
  listDictionaries,
  listOrganizations,
  listPeople,
  listProducts,
  listRules,
  listSites,
  listStudies,
  nullifyCase,
  openVersion,
  type PatientInput,
  permits,
  type Row,
  readableScope,
  recordAcknowledgement,
  recordSubmission,
  recordUnblinding,
  renderCiomsI,
  renderDigest,
  renderMedWatch3500A,
  reportability,
  reportingCompliance,
  resolveScope,
  resyncAll,
  revokeAccess,
  revokeWaiver,
  ruleMatches,
  type SourceInput,
  searchTerms,
  signatureIntegrity,
  signVersion,
  studyDetail,
  type TestInput,
  transitionVersion,
  updateSections,
  updateStudyStatus,
  updateVersionHeader,
  verifyAuditChain,
  waiveObligation,
} from "@pv-core/core";
import type { Db, Sql } from "@pv-core/db";
import { cors } from "hono/cors";
import {
  authMiddleware,
  authMode,
  configureTokens,
  type Env,
  requirePermission,
  verifyReauth,
} from "./auth.js";
import {
  AckBody,
  AnticipatedEventBody,
  AssessmentBody,
  AuditEventSchema,
  CaseDetailSchema,
  CreateCaseBody,
  DesignationsBody,
  DestinationBody,
  EndBody,
  ErrorSchema,
  GrantBody,
  ImportDictionaryBody,
  MeSchema,
  NullifyBody,
  ObligationSchema,
  OpenVersionBody,
  OrganizationBody,
  PersonBody,
  ProductBody,
  QueueRowSchema,
  RevokeWaiverBody,
  RowSchema,
  RsiVersionBody,
  RuleBody,
  SectionsBody,
  SignBody,
  SiteBody,
  StudyBody,
  StudyPatchBody,
  StudySchema,
  SubmissionBody,
  TransitionBody,
  UnblindingBody,
  VersionHeaderBody,
  WaiverBody,
} from "./schemas.js";

const security = [{ bearerAuth: [] }];
const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const body = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { "application/json": { schema } },
});
const P = {
  studyId: z.object({ studyId: z.string().uuid() }),
  caseId: z.object({ caseId: z.string().uuid() }),
  versionId: z.object({ versionId: z.string().uuid() }),
  submissionId: z.object({ submissionId: z.string().uuid() }),
  expectedSubmissionId: z.object({ expectedSubmissionId: z.string().uuid() }),
  dictionaryId: z.object({ dictionaryId: z.string().uuid() }),
  productId: z.object({ productId: z.string().uuid() }),
  rsiVersionId: z.object({ rsiVersionId: z.string().uuid() }),
  anticipatedEventId: z.object({ anticipatedEventId: z.string().uuid() }),
  ruleId: z.object({ ruleId: z.string().uuid() }),
  grantId: z.object({ grantId: z.string().uuid() }),
} as const;
const rows = z.array(RowSchema);
// View rows are dynamic (Row); the schemas above document the columns that
// matter, and this narrows the handler's return to what the route declares.
const cast = <T>(x: unknown) => x as T;

// --- wire (snake_case) -> core (camelCase) mappers ----------------------------------

const toPatient = (p: z.infer<typeof SectionsBody>["patient"]): PatientInput | undefined =>
  p && {
    initials: p.initials,
    subjectNumber: p.subject_number,
    studySiteId: p.study_site_id,
    ageValue: p.age_value,
    ageUnit: p.age_unit,
    ageGroup: p.age_group,
    sex: p.sex,
    weightKg: p.weight_kg,
    heightCm: p.height_cm,
    medicalHistoryText: p.medical_history_text,
    deathDate: p.death_date,
    deathCauseText: p.death_cause_text,
  };
const toSources = (s: z.infer<typeof SectionsBody>["sources"]): SourceInput[] | undefined =>
  s?.map((r) => ({
    seq: r.seq,
    givenName: r.given_name,
    familyName: r.family_name,
    organization: r.organization,
    country: r.country,
    qualification: r.qualification,
    isPrimaryForRegulatory: r.is_primary_for_regulatory,
    personId: r.person_id,
  }));
const toEvents = (e: z.infer<typeof SectionsBody>["events"]): EventInput[] | undefined =>
  e?.map((r) => ({
    seq: r.seq,
    reportedTerm: r.reported_term,
    lltCode: r.llt_code,
    seriousDeath: r.serious_death,
    seriousLifeThreatening: r.serious_life_threatening,
    seriousHospitalization: r.serious_hospitalization,
    seriousDisabling: r.serious_disabling,
    seriousCongenitalAnomaly: r.serious_congenital_anomaly,
    seriousOtherMedicallyImportant: r.serious_other_medically_important,
    onsetDate: r.onset_date,
    endDate: r.end_date,
    outcome: r.outcome,
    medicallyConfirmed: r.medically_confirmed,
    occurCountry: r.occur_country,
  }));
const toDrugs = (d: z.infer<typeof SectionsBody>["drugs"]): DrugInput[] | undefined =>
  d?.map((r) => ({
    seq: r.seq,
    role: r.role,
    productId: r.product_id,
    nameAsReported: r.name_as_reported,
    isBlinded: r.is_blinded,
    lotNumber: r.lot_number,
    indicationPtCode: r.indication_pt_code,
    indicationPtTerm: r.indication_pt_term,
    doseText: r.dose_text,
    doseValue: r.dose_value,
    doseUnit: r.dose_unit,
    route: r.route,
    startDate: r.start_date,
    endDate: r.end_date,
    actionTaken: r.action_taken,
  }));
const toAssessments = (
  a: z.infer<typeof AssessmentBody>[] | undefined,
): AssessmentInput[] | undefined =>
  a?.map((r) => ({
    drugSeq: r.drug_seq,
    eventSeq: r.event_seq,
    assessor: r.assessor,
    reasonablePossibility: r.reasonable_possibility,
    causalityMethod: r.causality_method,
    causalityResult: r.causality_result,
    rechallenge: r.rechallenge,
    expectednessOverride: r.expectedness_override,
    expectednessRationale: r.expectedness_rationale,
    rsiVersionId: r.rsi_version_id,
  }));
const toTests = (t: z.infer<typeof SectionsBody>["tests"]): TestInput[] | undefined =>
  t?.map((r) => ({
    seq: r.seq,
    testDate: r.test_date,
    testName: r.test_name,
    resultText: r.result_text,
    unit: r.unit,
    comments: r.comments,
  }));
const toSections = (b: z.infer<typeof SectionsBody>): CaseSections => ({
  patient: toPatient(b.patient),
  sources: toSources(b.sources),
  events: toEvents(b.events),
  drugs: toDrugs(b.drugs),
  tests: toTests(b.tests),
  narrative: b.narrative && {
    narrative: b.narrative.narrative,
    reporterComments: b.narrative.reporter_comments,
    senderDiagnosisPtCode: b.narrative.sender_diagnosis_pt_code,
    senderDiagnosisPtTerm: b.narrative.sender_diagnosis_pt_term,
    senderComments: b.narrative.sender_comments,
  },
});

const STATUS: Record<CoreError["code"], 400 | 403 | 404 | 409 | 423> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  locked: 423,
};

export function buildApp(db: Db, sql: Sql) {
  const mode = authMode();
  if (mode === "dev") configureTokens();
  const app = new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          { error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
          400,
        );
      }
    },
  });
  app.use("*", cors());
  app.onError((err, c) => {
    if (err instanceof CoreError) return c.json({ error: err.message }, STATUS[err.code]);
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description:
      mode === "oidc"
        ? "OIDC access token from the configured identity provider (OIDC_ISSUER)."
        : "Dev tokens: see .env.example (API_TOKEN_ADMIN / API_TOKEN_PROCESSOR / API_TOKEN_REVIEWER / API_TOKEN_READONLY / API_TOKEN_INGEST).",
  });
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "pv-core API",
      version: "0.1.0",
      description:
        "Pharmacovigilance safety database for clinical trials. E2B(R3)-shaped cases with signature-locked versions, a reporting-obligation engine whose clocks are derived on every read, DSUR line listings, and a hash-chained audit trail. The web app consumes exactly this API.",
    },
  });
  // The spec URL is relative so the page also works behind the web app's /api
  // proxy (Vite in dev, nginx in the image), where /openapi.json would 404.
  app.get("/docs", (c) =>
    c.html(`<!doctype html><html><head><title>pv-core API</title></head><body>
<script id="api-reference" data-url="openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>`),
  );
  app.get("/health", (c) => c.json({ status: "ok", service: "pv-core-api", auth_mode: mode }));

  // --- gates (ADR-0015/0016) ---------------------------------------------------
  const auth = authMiddleware(sql);
  const readOrEnter = (c: { req: { method: string } }) =>
    c.req.method === "GET" ? ("read" as const) : ("enter" as const);
  const readOrAdminister = (c: { req: { method: string } }) =>
    c.req.method === "GET" ? ("read" as const) : ("administer" as const);

  app.use("/me", auth);
  app.use("/studies", auth, requirePermission(sql, readOrAdminister));
  app.use("/studies/:studyId", auth, requirePermission(sql, readOrAdminister, "studyId"));
  app.use("/studies/:studyId/*", auth, requirePermission(sql, "read", "studyId"));
  app.use("/queue", auth, requirePermission(sql, "read"));
  app.use("/expected-submissions", auth, requirePermission(sql, "read"));
  app.use("/compliance", auth, requirePermission(sql, "read"));
  app.use("/reportability", auth, requirePermission(sql, "read"));
  app.use("/dsur/*", auth, requirePermission(sql, "read"));
  // POST /cases carries its study/product scope in the body; the handler
  // completes the scope check after parsing.
  app.use("/cases", auth, requirePermission(sql, "enter"));
  app.use("/cases/:caseId", auth, requirePermission(sql, "read", "caseId"));
  app.use("/cases/:caseId/audit", auth, requirePermission(sql, "read", "caseId"));
  app.use("/cases/:caseId/attachments", auth, requirePermission(sql, readOrEnter, "caseId"));
  app.use("/cases/:caseId/versions", auth, requirePermission(sql, "enter", "caseId"));
  app.use("/cases/:caseId/nullification", auth, requirePermission(sql, "enter", "caseId"));
  app.use("/cases/:caseId/unblinding", auth, requirePermission(sql, "assess", "caseId"));
  app.use("/case-versions/:versionId", auth, requirePermission(sql, readOrEnter, "versionId"));
  app.use("/case-versions/:versionId/sections", auth, requirePermission(sql, "enter", "versionId"));
  app.use(
    "/case-versions/:versionId/assessments",
    auth,
    requirePermission(sql, "assess", "versionId"),
  );
  // The anticipated designation is the sponsor's judgment: same gate as the
  // sponsor's causality assessment.
  app.use(
    "/case-versions/:versionId/designations",
    auth,
    requirePermission(sql, "assess", "versionId"),
  );
  app.use(
    "/case-versions/:versionId/transition",
    auth,
    requirePermission(
      sql,
      async (c) => {
        try {
          const b = (await c.req.json()) as { to_state?: string };
          return b?.to_state === "data_entry"
            ? "assess"
            : b?.to_state === "closed"
              ? "submit"
              : "enter";
        } catch {
          return "enter";
        }
      },
      "versionId",
    ),
  );
  app.use("/case-versions/:versionId/sign", auth, requirePermission(sql, "sign", "versionId"));
  app.use(
    "/case-versions/:versionId/submissions",
    auth,
    requirePermission(sql, "submit", "versionId"),
  );
  app.use("/case-versions/:versionId/e2b.json", auth, requirePermission(sql, "read", "versionId"));
  app.use(
    "/case-versions/:versionId/cioms1.pdf",
    auth,
    requirePermission(sql, "read", "versionId"),
  );
  app.use(
    "/case-versions/:versionId/medwatch-3500a.pdf",
    auth,
    requirePermission(sql, "read", "versionId"),
  );
  app.use(
    "/case-versions/:versionId/rule-matches",
    auth,
    requirePermission(sql, "read", "versionId"),
  );
  app.use("/submissions/:submissionId/*", auth, requirePermission(sql, "submit", "submissionId"));
  app.use(
    "/expected-submissions/:expectedSubmissionId/*",
    auth,
    requirePermission(sql, "assess", "expectedSubmissionId"),
  );
  app.use("/files/:attachmentSha256", auth, requirePermission(sql, "read", "attachmentSha256"));
  app.use("/audit-events", auth, requirePermission(sql, "read"));
  app.use("/audit-chain/*", auth, requirePermission(sql, "read"));
  app.use("/signature-integrity", auth, requirePermission(sql, "read"));
  app.use("/dictionaries", auth, requirePermission(sql, readOrAdminister));
  app.use("/dictionaries/*", auth, requirePermission(sql, readOrAdminister));
  app.use("/organizations", auth, requirePermission(sql, readOrAdminister));
  app.use("/products", auth, requirePermission(sql, readOrAdminister));
  app.use("/products/:productId/*", auth, requirePermission(sql, "administer", "productId"));
  app.use(
    "/rsi-versions/:rsiVersionId/*",
    auth,
    requirePermission(sql, "administer", "rsiVersionId"),
  );
  // POST /anticipated-events carries its study in the body; the handler
  // completes the scope check after parsing (as POST /cases does).
  app.use("/anticipated-events", auth, requirePermission(sql, readOrAdminister));
  app.use(
    "/anticipated-events/:anticipatedEventId/*",
    auth,
    requirePermission(sql, "administer", "anticipatedEventId"),
  );
  app.use("/destinations", auth, requirePermission(sql, readOrAdminister));
  app.use("/reporting-rules", auth, requirePermission(sql, readOrAdminister));
  app.use("/reporting-rules/:ruleId/*", auth, requirePermission(sql, "administer", "ruleId"));
  app.use("/people", auth, requirePermission(sql, readOrAdminister));
  app.use("/access-grants", auth, requirePermission(sql, "administer"));
  app.use("/access-grants/*", auth, requirePermission(sql, "administer"));
  app.use("/sites", auth, requirePermission(sql, readOrAdminister));
  app.use("/resync", auth, requirePermission(sql, "administer"));

  const scopeOf = (c: { get: (k: "grants") => Env["Variables"]["grants"] }) =>
    readableScope(c.get("grants"));

  // --- identity ------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/me",
      security,
      summary: "Who am I: person, grants, and the operations they permit somewhere",
      responses: { 200: json(MeSchema, "Identity") },
    }),
    (c) => {
      const grants = c.get("grants");
      const ops = (["read", "enter", "assess", "sign", "submit", "administer"] as const).filter(
        (op) => permits(grants, op, {}),
      );
      return c.json(
        {
          person_id: c.get("actor").personId!,
          label: c.get("actor").label,
          auth_mode: mode,
          grants,
          operations: ops,
        },
        200,
      );
    },
  );

  // --- studies -------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/studies",
      security,
      summary: "Studies the caller can read, with case and overdue counts",
      responses: { 200: json(z.array(StudySchema), "Studies") },
    }),
    async (c) =>
      c.json(cast<z.infer<typeof StudySchema>[]>(await listStudies(sql, scopeOf(c))), 200),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/studies",
      security,
      summary: "Create a study (administer)",
      request: { body: body(StudyBody) },
      responses: {
        201: json(z.object({ id: z.string().uuid() }), "Created"),
        400: json(ErrorSchema, "Invalid"),
      },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const r = await createStudy(db, c.get("actor"), {
        protocolNumber: b.protocol_number,
        title: b.title,
        phase: b.phase,
        status: b.status,
        sponsorOrgId: b.sponsor_org_id,
        indNumber: b.ind_number,
        euCtNumber: b.eu_ct_number,
        isBlinded: b.is_blinded,
        studyType: b.study_type,
        productIds: b.product_ids,
      });
      return c.json(r, 201);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}",
      security,
      summary: "A study with its sites and products",
      request: { params: P.studyId },
      responses: { 200: json(StudySchema, "Study"), 404: json(ErrorSchema, "Not found") },
    }),
    async (c) => {
      const s = await studyDetail(sql, c.req.valid("param").studyId);
      return s
        ? c.json(cast<z.infer<typeof StudySchema>>(s), 200)
        : c.json({ error: "study not found" }, 404);
    },
  );
  app.openapi(
    createRoute({
      method: "patch",
      path: "/studies/{studyId}",
      security,
      summary: "Move a study's status",
      request: { params: P.studyId, body: body(StudyPatchBody) },
      responses: { 200: json(z.object({ ok: z.boolean() }), "Updated") },
    }),
    async (c) => {
      await updateStudyStatus(
        db,
        c.get("actor"),
        c.req.valid("param").studyId,
        c.req.valid("json").status,
      );
      return c.json({ ok: true }, 200);
    },
  );

  // --- queues, clocks, DSUR (view reads) -------------------------------------------
  const queueRoute = (path: string, summary: string, scoped: boolean) =>
    app.openapi(
      createRoute({
        method: "get",
        path,
        security,
        summary,
        request: {
          ...(scoped ? { params: P.studyId } : {}),
          query: z.object({ state: z.string().optional() }),
        },
        responses: { 200: json(z.array(QueueRowSchema), "Queue rows, overdue first") },
      }),
      async (c) =>
        c.json(
          cast<z.infer<typeof QueueRowSchema>[]>(
            await caseQueue(sql, scopeOf(c), {
              studyId: scoped ? c.req.param("studyId") : undefined,
              state: c.req.query("state"),
            }),
          ),
          200,
        ),
    );
  queueRoute("/queue", "Case queue across every study the caller can read", false);
  queueRoute("/studies/{studyId}/queue", "Case queue for a study", true);

  const obligationsRoute = (path: string, scoped: boolean) =>
    app.openapi(
      createRoute({
        method: "get",
        path,
        security,
        summary: "Expected submissions with derived status (v_expected_submission_status)",
        request: {
          ...(scoped ? { params: P.studyId } : {}),
          query: z.object({ status: z.string().optional() }),
        },
        responses: { 200: json(z.array(ObligationSchema), "Obligations, overdue first") },
      }),
      async (c) =>
        c.json(
          cast<z.infer<typeof ObligationSchema>[]>(
            await expectedSubmissions(sql, scopeOf(c), {
              studyId: scoped ? c.req.param("studyId") : undefined,
              status: c.req.query("status"),
            }),
          ),
          200,
        ),
    );
  obligationsRoute("/expected-submissions", false);
  obligationsRoute("/studies/{studyId}/expected-submissions", true);

  const viewRoute = (
    path: string,
    summary: string,
    scoped: boolean,
    fn: (studyId: string | undefined, c: Parameters<typeof scopeOf>[0]) => Promise<Row[]>,
  ) =>
    app.openapi(
      createRoute({
        method: "get",
        path,
        security,
        summary,
        request: scoped ? { params: P.studyId } : {},
        responses: { 200: json(rows, "Rows") },
      }),
      async (c) => c.json(await fn(scoped ? c.req.param("studyId") : undefined, c), 200),
    );
  viewRoute(
    "/reportability",
    "Reportability verdict per case version (v_case_reportability)",
    false,
    (s, c) => reportability(sql, scopeOf(c), s),
  );
  viewRoute(
    "/studies/{studyId}/reportability",
    "Reportability verdicts for a study",
    true,
    (s, c) => reportability(sql, scopeOf(c), s),
  );
  viewRoute(
    "/compliance",
    "On-time submission metrics per study and destination (v_reporting_compliance)",
    false,
    (s, c) => reportingCompliance(sql, scopeOf(c), s),
  );
  viewRoute(
    "/studies/{studyId}/compliance",
    "On-time submission metrics for a study",
    true,
    (s, c) => reportingCompliance(sql, scopeOf(c), s),
  );
  viewRoute(
    "/dsur/sae-summary",
    "DSUR cumulative SAE tabulation by SOC and arm (ICH E2F §3.7.3)",
    false,
    (s, c) => dsurSaeSummary(sql, scopeOf(c), s),
  );
  viewRoute(
    "/studies/{studyId}/dsur/sae-summary",
    "DSUR cumulative SAE tabulation for a study",
    true,
    (s, c) => dsurSaeSummary(sql, scopeOf(c), s),
  );

  // The digest as the email would read it, plus its derived recipient list
  // (ADR-0014): what the cron job sends is never terminal-only knowledge.
  app.openapi(
    createRoute({
      method: "get",
      path: "/studies/{studyId}/digest",
      security,
      summary:
        "The reminders digest for a study: overdue and due-soon obligations, intake items, stale reviews, unassessed causality, chain status",
      request: { params: P.studyId },
      responses: { 200: json(RowSchema, "Digest data, rendered text, and recipients") },
    }),
    async (c) => {
      const studyId = c.req.valid("param").studyId;
      const data = await collectDigest(sql, studyId);
      const rendered = renderDigest(data);
      const recipients = await digestRecipients(sql, studyId);
      return c.json(
        cast<Row>({ ...data, subject: rendered.subject, text: rendered.text, recipients }),
        200,
      );
    },
  );

  const lineListingRoute = (path: string, scoped: boolean) =>
    app.openapi(
      createRoute({
        method: "get",
        path,
        security,
        summary:
          "DSUR line listing of serious adverse reactions (ICH E2F §3.7.2), filterable by receipt date",
        request: {
          ...(scoped ? { params: P.studyId } : {}),
          query: z.object({ from: z.string().date().optional(), to: z.string().date().optional() }),
        },
        responses: { 200: json(rows, "One row per case under its most serious reaction") },
      }),
      async (c) =>
        c.json(
          await dsurSarLineListing(sql, scopeOf(c), {
            studyId: scoped ? c.req.param("studyId") : undefined,
            from: c.req.query("from"),
            to: c.req.query("to"),
          }),
          200,
        ),
    );
  lineListingRoute("/dsur/sar-line-listing", false);
  lineListingRoute("/studies/{studyId}/dsur/sar-line-listing", true);

  // --- cases -----------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: "post",
      path: "/cases",
      security,
      summary: "Create a case with its initial version and any sections that arrived",
      description:
        "An intake item is an ordinary case whose first version does not yet meet the ICH E2B(R3) §3.3.1 minimum criteria; it shows as 'intake' in the queue until it does. The clock materializes at once (ADR-0007).",
      request: { body: body(CreateCaseBody) },
      responses: {
        201: json(
          z.object({
            case_id: z.string().uuid(),
            case_version_id: z.string().uuid(),
            sender_case_id: z.string(),
            worldwide_unique_id: z.string(),
          }),
          "Created",
        ),
        400: json(ErrorSchema, "Invalid"),
        403: json(ErrorSchema, "Out of scope"),
      },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const actor = c.get("actor");
      const scope = b.study_id
        ? await resolveScope(sql, "studyId", b.study_id)
        : await resolveScope(sql, "productId", b.product_id);
      if (!scope) return c.json({ error: "study or product not found" }, 400);
      if (!permits(c.get("grants"), "enter", scope))
        return c.json({ error: "requires 'enter' permission for this study" }, 403);
      const r = await createCase(db, actor, {
        ...toSections(b),
        assessments: toAssessments(b.assessments),
        studyId: b.study_id,
        productId: b.product_id,
        reportType: b.report_type,
        firstReceivedDate: b.first_received_date,
        receivedVia: b.received_via,
        receivedRef: b.received_ref,
        infoReceivedDate: b.info_received_date,
        awarenessDate: b.awareness_date,
        awarenessRationale: b.awareness_rationale,
        dictionaryId: b.dictionary_id,
        senderCaseId: b.sender_case_id,
        worldwideUniqueId: b.worldwide_unique_id,
        replacesCaseId: b.replaces_case_id,
        source: b.source,
        createdBy: actor.personId!,
      });
      return c.json(
        {
          case_id: r.caseId,
          case_version_id: r.caseVersionId,
          sender_case_id: r.senderCaseId,
          worldwide_unique_id: r.worldwideUniqueId,
        },
        201,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/cases/{caseId}",
      security,
      summary:
        "The whole case: versions with sections and verdicts, facts, obligations, submissions, attachments",
      request: { params: P.caseId },
      responses: { 200: json(CaseDetailSchema, "Case"), 404: json(ErrorSchema, "Not found") },
    }),
    async (c) => {
      const d = await caseDetail(sql, c.req.valid("param").caseId);
      return d
        ? c.json(cast<z.infer<typeof CaseDetailSchema>>(d), 200)
        : c.json({ error: "case not found" }, 404);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/cases/{caseId}/audit",
      security,
      summary: "Audit events touching the case, its versions, and every child row",
      request: {
        params: P.caseId,
        query: z.object({ limit: z.coerce.number().int().positive().max(2000).optional() }),
      },
      responses: { 200: json(z.array(AuditEventSchema), "Events, newest first") },
    }),
    async (c) =>
      c.json(
        cast<z.infer<typeof AuditEventSchema>[]>(
          await caseAuditTrail(sql, c.req.valid("param").caseId, c.req.valid("query").limit ?? 500),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/cases/{caseId}/versions",
      security,
      summary: "Open a follow-up or amendment version cloned from the latest (ADR-0006)",
      request: { params: P.caseId, body: body(OpenVersionBody) },
      responses: {
        201: json(
          z.object({ case_version_id: z.string().uuid(), version_number: z.number() }),
          "Opened",
        ),
        409: json(ErrorSchema, "Latest version is still open"),
      },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const r = await openVersion(db, c.get("actor"), {
        caseId: c.req.valid("param").caseId,
        kind: b.kind,
        infoReceivedDate: b.info_received_date,
        awarenessDate: b.awareness_date,
        awarenessRationale: b.awareness_rationale,
        createdBy: c.get("actor").personId!,
      });
      return c.json({ case_version_id: r.caseVersionId, version_number: r.versionNumber }, 201);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/cases/{caseId}/nullification",
      security,
      summary: "Nullify a case (E2B(R3) C.1.11.1 = 1); no further versions are accepted",
      request: { params: P.caseId, body: body(NullifyBody) },
      responses: {
        201: json(z.object({ ok: z.boolean() }), "Nullified"),
        409: json(ErrorSchema, "Already nullified"),
      },
    }),
    async (c) => {
      await nullifyCase(db, c.get("actor"), {
        caseId: c.req.valid("param").caseId,
        reason: c.req.valid("json").reason,
        by: c.get("actor").personId!,
      });
      return c.json({ ok: true }, 201);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/cases/{caseId}/unblinding",
      security,
      summary: "Record the unblinding fact (ADR-0008); the randomization system did the code-break",
      request: { params: P.caseId, body: body(UnblindingBody) },
      responses: {
        201: json(z.object({ ok: z.boolean() }), "Recorded"),
        409: json(ErrorSchema, "Already recorded"),
      },
    }),
    async (c) => {
      const b = c.req.valid("json");
      await recordUnblinding(db, c.get("actor"), {
        caseId: c.req.valid("param").caseId,
        armLabel: b.arm_label,
        armRole: b.arm_role,
        reason: b.reason,
        unblindedAt: b.unblinded_at ? new Date(b.unblinded_at) : undefined,
        by: c.get("actor").personId!,
        sourceSystem: b.source_system,
        sourceRef: b.source_ref,
      });
      return c.json({ ok: true }, 201);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/cases/{caseId}/attachments",
      security,
      summary:
        "Attach a source document (multipart): stored content-addressed, WORM-capable (ADR-0013)",
      request: {
        params: P.caseId,
        body: {
          content: {
            "multipart/form-data": {
              schema: z.object({
                file: z.custom<File>((v) => v instanceof File, "file required"),
                kind: z
                  .enum(["source_document", "correspondence", "submission_payload"])
                  .optional(),
                case_version_id: z.string().uuid().optional(),
              }),
            },
          },
        },
      },
      responses: {
        201: json(
          z.object({ id: z.string().uuid(), sha256: z.string(), size_bytes: z.number() }),
          "Stored",
        ),
        400: json(ErrorSchema, "No file"),
      },
    }),
    async (c) => {
      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
      const kind = (typeof form.kind === "string" ? form.kind : "source_document") as
        | "source_document"
        | "correspondence"
        | "submission_payload";
      const r = await addAttachment(db, c.get("actor"), {
        caseId: c.req.valid("param").caseId,
        caseVersionId: typeof form.case_version_id === "string" ? form.case_version_id : null,
        kind,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: new Uint8Array(await file.arrayBuffer()),
        uploadedBy: c.get("actor").personId!,
      });
      return c.json({ id: r.id, sha256: r.sha256, size_bytes: r.sizeBytes }, 201);
    },
  );
  // Content-addressed bytes (documented informally; binary response). Scoped
  // by the middleware to the case that holds them.
  app.get("/files/:attachmentSha256", async (c) => {
    const sha = c.req.param("attachmentSha256");
    if (!/^[0-9a-f]{64}$/.test(sha)) return c.json({ error: "not found" }, 404);
    const r = await attachmentBytes(sql, sha);
    if (!r) return c.json({ error: "not found" }, 404);
    return c.body(new Uint8Array(r.bytes).buffer as ArrayBuffer, 200, {
      "content-type": r.mimeType,
      "content-disposition": `inline; filename="${r.fileName.replace(/["\r\n]/g, "")}"`,
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  // --- versions ---------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: "patch",
      path: "/case-versions/{versionId}",
      security,
      summary: "Set the receipt date and day zero of an open version (ADR-0007)",
      request: { params: P.versionId, body: body(VersionHeaderBody) },
      responses: {
        200: json(z.object({ ok: z.boolean() }), "Updated"),
        423: json(ErrorSchema, "Locked by a signature"),
      },
    }),
    async (c) => {
      const b = c.req.valid("json");
      await updateVersionHeader(db, c.get("actor"), c.req.valid("param").versionId, {
        infoReceivedDate: b.info_received_date,
        awarenessDate: b.awareness_date,
        awarenessRationale: b.awareness_rationale,
      });
      return c.json({ ok: true }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/case-versions/{versionId}/sections",
      security,
      summary:
        "Replace one or more sections of an open version (patient, sources, events, drugs, tests, narrative)",
      description:
        "Every write is audited with before/after images; the version locks at its first signature (ADR-0006). The clock resyncs in the same transaction.",
      request: { params: P.versionId, body: body(SectionsBody) },
      responses: {
        200: json(z.object({ ok: z.boolean() }), "Updated"),
        423: json(ErrorSchema, "Locked by a signature"),
      },
    }),
    async (c) => {
      await updateSections(
        db,
        c.get("actor"),
        c.req.valid("param").versionId,
        toSections(c.req.valid("json")),
      );
      return c.json({ ok: true }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/case-versions/{versionId}/assessments",
      security,
      summary:
        "Replace the drug-by-event assessments (causality, expectedness override) of an open version",
      request: {
        params: P.versionId,
        body: body(z.object({ assessments: z.array(AssessmentBody) })),
      },
      responses: {
        200: json(z.object({ ok: z.boolean() }), "Updated"),
        423: json(ErrorSchema, "Locked by a signature"),
      },
    }),
    async (c) => {
      await updateSections(db, c.get("actor"), c.req.valid("param").versionId, {
        assessments: toAssessments(c.req.valid("json").assessments),
      });
      return c.json({ ok: true }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/case-versions/{versionId}/designations",
      security,
      summary:
        "Replace the sponsor's per-event designations of an open version: anticipated in the study population (naming a concept on the study's list) or not",
      description:
        "Sponsor-only (assess). An anticipated designation holds the event back from every rule that excludes anticipated events (FDA IND safety reporting, December 2025 guidance §IV.A.2.a, §V.A); other rules are untouched. The clock resyncs in the same transaction; the version's hash covers the designations.",
      request: { params: P.versionId, body: body(DesignationsBody) },
      responses: {
        200: json(z.object({ ok: z.boolean() }), "Updated"),
        400: json(ErrorSchema, "Invalid"),
        423: json(ErrorSchema, "Locked by a signature"),
      },
    }),
    async (c) => {
      await updateSections(db, c.get("actor"), c.req.valid("param").versionId, {
        designations: c.req.valid("json").designations.map((d) => ({
          eventSeq: d.event_seq,
          anticipated: d.anticipated,
          anticipatedEventId: d.anticipated_event_id,
          rationale: d.rationale,
        })),
      });
      return c.json({ ok: true }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/case-versions/{versionId}/transition",
      security,
      summary:
        "Record an intent transition: to medical review, back to data entry (with a note), or closed",
      request: { params: P.versionId, body: body(TransitionBody) },
      responses: {
        201: json(z.object({ ok: z.boolean() }), "Recorded"),
        409: json(ErrorSchema, "Not a valid ICSR yet"),
      },
    }),
    async (c) => {
      const b = c.req.valid("json");
      await transitionVersion(db, c.get("actor"), {
        versionId: c.req.valid("param").versionId,
        toState: b.to_state,
        by: c.get("actor").personId!,
        note: b.note,
      });
      return c.json({ ok: true }, 201);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/case-versions/{versionId}/sign",
      security,
      summary: "Apply a Part 11 e-signature (medical review or approval) to a version",
      description:
        "Records signer, meaning, timestamp, and the version hash (§11.70 binding); the first signature locks the version (ADR-0006). §11.200: the request must carry proof of re-authentication (reauth_token): in OIDC mode a freshly issued token for the same subject, in dev mode the bearer token restated.",
      request: { params: P.versionId, body: body(SignBody) },
      responses: {
        201: json(
          z.object({ signature_id: z.string().uuid(), signed_sha256: z.string() }),
          "Signed",
        ),
        403: json(ErrorSchema, "Re-authentication failed"),
        409: json(ErrorSchema, "Not signable"),
      },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const reauth = await verifyReauth(c, b.reauth_token);
      if (!reauth.ok) return c.json({ error: reauth.error }, 403);
      const r = await signVersion(db, c.get("actor"), {
        versionId: c.req.valid("param").versionId,
        signerPersonId: c.get("actor").personId!,
        meaning: b.meaning,
        reauthMethod: reauth.method,
        reauthAt: reauth.at,
      });
      return c.json({ signature_id: r.signatureId, signed_sha256: r.signedSha256 }, 201);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/case-versions/{versionId}/e2b.json",
      security,
      summary:
        "E2B(R3)-shaped JSON export keyed by IG element IDs (ADR-0009; not schema-validated XML)",
      request: { params: P.versionId },
      responses: { 200: json(RowSchema, "Export"), 404: json(ErrorSchema, "Not found") },
    }),
    async (c) => c.json(await buildE2bJson(sql, c.req.valid("param").versionId), 200),
  );
  // Regulatory form renderings (ADR-0012; documented informally, binary
  // response): CIOMS I and Form FDA 3500A rendered from the version, with the
  // version hash in the footer. What was actually sent is the stored payload.
  const pdfRoute = (
    suffix: string,
    fileTag: string,
    fn: (versionId: string) => Promise<Uint8Array>,
  ) =>
    app.get(`/case-versions/:versionId/${suffix}`, async (c) => {
      const versionId = c.req.param("versionId");
      if (!z.string().uuid().safeParse(versionId).success) {
        return c.json({ error: "version not found" }, 404);
      }
      const bytes = await fn(versionId);
      return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${versionId}-${fileTag}.pdf"`,
      });
    });
  pdfRoute("cioms1.pdf", "cioms-i", (v) => renderCiomsI(sql, v));
  pdfRoute("medwatch-3500a.pdf", "fda-3500a", (v) => renderMedWatch3500A(sql, v));

  app.openapi(
    createRoute({
      method: "get",
      path: "/case-versions/{versionId}/rule-matches",
      security,
      summary: "Why does each rule apply to this version (v_rule_match)",
      request: { params: P.versionId },
      responses: { 200: json(rows, "Matches") },
    }),
    async (c) => c.json(await ruleMatches(sql, c.req.valid("param").versionId), 200),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/case-versions/{versionId}/submissions",
      security,
      summary:
        "Record what was sent to a destination; requires an approval signature bound to the version's hash",
      description:
        "With no payload attachment, the server renders the payload itself for e2b_r3_json, cioms_i_pdf, and medwatch_3500a_pdf and stores the exact bytes content-addressed; every submission row copies the version hash it sent (ADR-0012/0013).",
      request: { params: P.versionId, body: body(SubmissionBody) },
      responses: {
        201: json(
          z.object({ id: z.string().uuid(), payload_sha256: z.string().nullable() }),
          "Recorded",
        ),
        400: json(ErrorSchema, "Payload attachment not found"),
        409: json(ErrorSchema, "No approval signature bound to the current hash"),
      },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const versionId = c.req.valid("param").versionId;
      let payload: { bytes: Uint8Array; fileName: string; mimeType: string } | null = null;
      if (b.payload_attachment_id) {
        const [a] =
          await sql`SELECT sha256, file_name, mime_type FROM case_attachment WHERE id = ${b.payload_attachment_id}`;
        if (!a) return c.json({ error: "payload attachment not found" }, 400);
        const bytes = await attachmentBytes(sql, a.sha256 as string);
        if (bytes)
          payload = {
            bytes: bytes.bytes,
            fileName: a.file_name as string,
            mimeType: a.mime_type as string,
          };
      } else if (b.format === "e2b_r3_json") {
        const doc = await buildE2bJson(sql, versionId);
        payload = {
          bytes: new TextEncoder().encode(JSON.stringify(doc, null, 2)),
          fileName: `${String(doc["C.1.1"])}-v${doc.meta.version_number}-e2b.json`,
          mimeType: "application/json",
        };
      } else if (b.format === "cioms_i_pdf" || b.format === "medwatch_3500a_pdf") {
        const [v] = await sql`
          SELECT c.sender_case_id, cv.version_number FROM case_version cv JOIN "case" c ON c.id = cv.case_id
          WHERE cv.id = ${versionId}`;
        const tag = b.format === "cioms_i_pdf" ? "cioms-i" : "fda-3500a";
        const bytes =
          b.format === "cioms_i_pdf"
            ? await renderCiomsI(sql, versionId)
            : await renderMedWatch3500A(sql, versionId);
        payload = {
          bytes,
          fileName: `${String(v?.sender_case_id ?? versionId)}-v${String(v?.version_number ?? "")}-${tag}.pdf`,
          mimeType: "application/pdf",
        };
      }
      const r = await recordSubmission(db, c.get("actor"), {
        caseVersionId: versionId,
        destinationId: b.destination_id,
        kind: b.kind,
        format: b.format,
        sentBy: c.get("actor").personId!,
        sentAt: b.sent_at ? new Date(b.sent_at) : undefined,
        payload,
        messageId: b.message_id,
        transmissionRef: b.transmission_ref,
        note: b.note,
      });
      return c.json({ id: r.id, payload_sha256: r.payloadSha256 }, 201);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/submissions/{submissionId}/acknowledgement",
      security,
      summary:
        "Record a regulator or partner acknowledgement (E2B(R3) IG §4.0 codes, or manual receipt)",
      request: { params: P.submissionId, body: body(AckBody) },
      responses: { 201: json(z.object({ id: z.string().uuid() }), "Recorded") },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const r = await recordAcknowledgement(db, c.get("actor"), {
        submissionId: c.req.valid("param").submissionId,
        ackCode: b.ack_code,
        ackMessageId: b.ack_message_id,
        errorText: b.error_text,
        receivedAt: b.received_at ? new Date(b.received_at) : undefined,
        recordedBy: c.get("actor").personId!,
      });
      return c.json(r, 201);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/expected-submissions/{expectedSubmissionId}/waiver",
      security,
      summary: "Record that an obligation is not required (a judgment with a reason)",
      request: { params: P.expectedSubmissionId, body: body(WaiverBody) },
      responses: {
        201: json(z.object({ id: z.string().uuid() }), "Waived"),
        409: json(ErrorSchema, "Already waived"),
      },
    }),
    async (c) => {
      const r = await waiveObligation(db, c.get("actor"), {
        expectedSubmissionId: c.req.valid("param").expectedSubmissionId,
        reason: c.req.valid("json").reason,
        by: c.get("actor").personId!,
      });
      return c.json(r, 201);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/expected-submissions/{expectedSubmissionId}/waiver/revoke",
      security,
      summary: "Revoke a waiver (a dated fact; the obligation's clock resumes)",
      request: { params: P.expectedSubmissionId, body: body(RevokeWaiverBody) },
      responses: { 200: json(z.object({ ok: z.boolean() }), "Revoked") },
    }),
    async (c) => {
      const b = c.req.valid("json");
      await revokeWaiver(db, c.get("actor"), {
        waiverId: b.waiver_id,
        reason: b.reason,
        by: c.get("actor").personId!,
      });
      return c.json({ ok: true }, 200);
    },
  );

  // --- audit -------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/audit-events",
      security,
      summary: "Audit trail (append-only, hash-chained), newest first",
      request: {
        query: z.object({
          entity_type: z.string().optional(),
          entity_id: z.string().optional(),
          limit: z.coerce.number().int().positive().max(2000).optional(),
        }),
      },
      responses: { 200: json(z.array(AuditEventSchema), "Events") },
    }),
    async (c) => {
      const q = c.req.valid("query");
      return c.json(
        cast<z.infer<typeof AuditEventSchema>[]>(
          await auditEvents(sql, {
            entityType: q.entity_type,
            entityId: q.entity_id,
            limit: q.limit,
          }),
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/audit-chain/verify",
      security,
      summary: "Replay the audit hash chain and report any break",
      responses: {
        200: json(
          z.object({ ok: z.boolean(), events: z.number(), problems: rows }),
          "Verification",
        ),
      },
    }),
    async (c) => c.json(await verifyAuditChain(sql), 200),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/signature-integrity",
      security,
      summary: "Every signature with the version hash recomputed now (§11.70)",
      request: { query: z.object({ case_id: z.string().uuid().optional() }) },
      responses: { 200: json(rows, "Signatures") },
    }),
    async (c) => c.json(await signatureIntegrity(sql, c.req.valid("query").case_id), 200),
  );

  // --- reference data and admin ------------------------------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/dictionaries",
      security,
      summary: "Loaded dictionaries (labeled demo subset vs. verbatim releases)",
      responses: { 200: json(rows, "Dictionaries") },
    }),
    async (c) => c.json(cast<Row[]>(await listDictionaries(sql)), 200),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/dictionaries/{dictionaryId}/terms",
      security,
      summary: "Search LLTs by substring (trigram); exact matches first",
      request: {
        params: P.dictionaryId,
        query: z.object({
          q: z.string().min(1),
          limit: z.coerce.number().int().positive().max(100).optional(),
        }),
      },
      responses: { 200: json(rows, "Terms") },
    }),
    async (c) => {
      const q = c.req.valid("query");
      return c.json(
        cast<Row[]>(await searchTerms(sql, c.req.valid("param").dictionaryId, q.q, q.limit ?? 25)),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/dictionaries/import",
      security,
      summary: "Load a licensed MedDRA release verbatim from a directory on the server (ADR-0005)",
      request: { body: body(ImportDictionaryBody) },
      responses: { 201: json(RowSchema, "Loaded (or skipped when already present)") },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const r = await importDictionary(db, {
        version: b.version,
        dir: b.dir,
        loadedBy: c.get("actor").personId,
      });
      return c.json(cast<Row>(r), 201);
    },
  );

  const listRoute = (
    path: string,
    summary: string,
    fn: (c: Parameters<typeof scopeOf>[0]) => Promise<Row[]>,
  ) =>
    app.openapi(
      createRoute({
        method: "get",
        path,
        security,
        summary,
        responses: { 200: json(rows, "Rows") },
      }),
      async (c) => c.json(await fn(c), 200),
    );
  listRoute("/organizations", "Organizations (sponsors, CRO, site organizations)", (c) =>
    listOrganizations(sql, scopeOf(c)),
  );
  listRoute("/products", "Products with their RSI versions and listed terms", (c) =>
    listProducts(sql, scopeOf(c)),
  );
  listRoute(
    "/anticipated-events",
    "Anticipated serious adverse events per study (the safety surveillance plan's list, with terms; ended concepts last)",
    (c) => listAnticipatedEvents(sql, scopeOf(c)),
  );
  viewRoute(
    "/studies/{studyId}/anticipated-events",
    "Anticipated serious adverse events of one study",
    true,
    (s, c) => listAnticipatedEvents(sql, scopeOf(c), s),
  );
  listRoute("/destinations", "Reporting destinations", (c) => listDestinations(sql, scopeOf(c)));
  listRoute("/reporting-rules", "Reporting rules (rows; ended rules last)", (c) =>
    listRules(sql, scopeOf(c)),
  );
  listRoute("/people", "People and their grants", () => listPeople(sql));
  listRoute("/sites", "Study sites", (c) => listSites(sql, scopeOf(c)));

  const createRouteFor = <B extends z.ZodTypeAny>(
    path: string,
    summary: string,
    schema: B,
    fn: (b: z.infer<B>, actor: Env["Variables"]["actor"]) => Promise<unknown>,
  ) =>
    app.openapi(
      createRoute({
        method: "post",
        path,
        security,
        summary,
        request: { body: body(schema) },
        responses: { 201: json(RowSchema, "Created"), 400: json(ErrorSchema, "Invalid") },
      }),
      async (c) =>
        c.json(
          cast<Row>(await fn((c.req.valid as (k: "json") => z.infer<B>)("json"), c.get("actor"))),
          201,
        ),
    );
  createRouteFor("/organizations", "Create an organization", OrganizationBody, (b, a) =>
    createOrganization(db, a, b),
  );
  createRouteFor("/products", "Create a product", ProductBody, (b, a) =>
    createProduct(db, a, {
      sponsorOrgId: b.sponsor_org_id,
      name: b.name,
      substance: b.substance,
      kind: b.kind,
    }),
  );
  createRouteFor("/destinations", "Create a reporting destination", DestinationBody, (b, a) =>
    createDestination(db, a, {
      sponsorOrgId: b.sponsor_org_id,
      name: b.name,
      kind: b.kind,
      country: b.country,
      e2bReceiverId: b.e2b_receiver_id,
      defaultFormat: b.default_format,
    }),
  );
  createRouteFor(
    "/reporting-rules",
    "Create a reporting rule (rules are rows; end and insert, never edit, ADR-0007)",
    RuleBody,
    (b, a) =>
      createRule(db, a, {
        sponsorOrgId: b.sponsor_org_id,
        studyId: b.study_id,
        productId: b.product_id,
        destinationId: b.destination_id,
        name: b.name,
        citation: b.citation,
        reportTypes: b.report_types,
        versionKinds: b.version_kinds,
        obligationKind: b.obligation_kind,
        serious: b.serious,
        unexpected: b.unexpected,
        related: b.related,
        fatalOrLifeThreatening: b.fatal_or_life_threatening,
        causalityBasis: b.causality_basis,
        excludesAnticipated: b.excludes_anticipated,
        requiresPriorSubmission: b.requires_prior_submission,
        timelineDays: b.timeline_days,
        dueSoonDays: b.due_soon_days,
        satisfyingKinds: b.satisfying_kinds,
        effectiveFrom: b.effective_from,
        effectiveTo: b.effective_to,
      }),
  );
  createRouteFor("/people", "Create a person", PersonBody, (b, a) =>
    createPerson(db, a, {
      givenName: b.given_name,
      familyName: b.family_name,
      email: b.email,
      credentials: b.credentials,
    }),
  );
  createRouteFor(
    "/access-grants",
    "Grant access (scoped to a sponsor organization, a study, or unscoped)",
    GrantBody,
    (b, a) =>
      grantAccess(db, a, {
        personId: b.person_id,
        role: b.role,
        organizationId: b.organization_id,
        studyId: b.study_id,
      }),
  );
  createRouteFor("/sites", "Create a site, optionally enrolling it in a study", SiteBody, (b, a) =>
    createSite(db, a, {
      organizationId: b.organization_id,
      name: b.name,
      city: b.city,
      country: b.country,
      studyId: b.study_id,
      siteNumber: b.site_number,
    }),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/products/{productId}/rsi-versions",
      security,
      summary: "Add an RSI version with its listed terms; optionally end the open one",
      request: { params: P.productId, body: body(RsiVersionBody) },
      responses: { 201: json(RowSchema, "Created") },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const r = await createRsiVersion(db, c.get("actor"), {
        productId: c.req.valid("param").productId,
        label: b.label,
        effectiveFrom: b.effective_from,
        dictionaryId: b.dictionary_id,
        listedTerms: b.listed_terms.map((t) => ({
          ptCode: t.pt_code,
          ptTerm: t.pt_term,
          listednessNote: t.listedness_note,
        })),
        documentSha256: b.document_sha256,
        approvedBy: c.get("actor").personId,
        endPrevious: b.end_previous,
      });
      return c.json(cast<Row>(r), 201);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/anticipated-events",
      security,
      summary:
        "Add an anticipated serious adverse event to a study's list: one medical concept, its Preferred Terms, and the plan reference or the clinical justification",
      description:
        "FDA, Sponsor Responsibilities (December 2025) §V.A and §VI.A. A predicted rate is optional and never stored without its unit and basis. Concepts end (effective_to), they are never edited or deleted.",
      request: { body: body(AnticipatedEventBody) },
      responses: {
        201: json(RowSchema, "Created"),
        400: json(ErrorSchema, "Invalid"),
        403: json(ErrorSchema, "Not permitted for this study"),
      },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const scope = await resolveScope(sql, "studyId", b.study_id);
      if (!scope) return c.json({ error: "study not found" }, 400);
      if (!permits(c.get("grants"), "administer", scope))
        return c.json({ error: "requires 'administer' permission for this study" }, 403);
      const r = await createAnticipatedEvent(db, c.get("actor"), {
        studyId: b.study_id,
        label: b.label,
        prespecified: b.prespecified,
        planReference: b.plan_reference,
        justification: b.justification,
        predictedRate: b.predicted_rate,
        rateUnit: b.rate_unit,
        rateBasis: b.rate_basis,
        effectiveFrom: b.effective_from,
        approvedBy: b.approved_by ?? c.get("actor").personId,
        dictionaryId: b.dictionary_id,
        terms: b.terms.map((t) => ({ ptCode: t.pt_code, ptTerm: t.pt_term })),
      });
      return c.json(cast<Row>(r), 201);
    },
  );
  const endRoute = (
    path: string,
    param: "rsiVersionId" | "ruleId" | "anticipatedEventId",
    summary: string,
    fn: (id: string, effectiveTo: string, actor: Env["Variables"]["actor"]) => Promise<void>,
  ) =>
    app.openapi(
      createRoute({
        method: "post",
        path,
        security,
        summary,
        request: { params: P[param], body: body(EndBody) },
        responses: { 200: json(z.object({ ok: z.boolean() }), "Ended") },
      }),
      async (c) => {
        await fn(c.req.param(param)!, c.req.valid("json").effective_to, c.get("actor"));
        return c.json({ ok: true }, 200);
      },
    );
  endRoute(
    "/rsi-versions/{rsiVersionId}/end",
    "rsiVersionId",
    "End an RSI version (its one permitted mutation)",
    (id, to, a) => endRsiVersion(db, a, id, to),
  );
  endRoute(
    "/reporting-rules/{ruleId}/end",
    "ruleId",
    "End a reporting rule (rules are never edited in place)",
    (id, to, a) => endRule(db, a, id, to),
  );
  endRoute(
    "/anticipated-events/{anticipatedEventId}/end",
    "anticipatedEventId",
    "End an anticipated serious adverse event concept (its one permitted mutation)",
    (id, to, a) => endAnticipatedEvent(db, a, id, to),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/access-grants/{grantId}/revoke",
      security,
      summary: "Revoke a grant (a dated fact)",
      request: { params: P.grantId },
      responses: { 200: json(z.object({ ok: z.boolean() }), "Revoked") },
    }),
    async (c) => {
      await revokeAccess(db, c.get("actor"), c.req.valid("param").grantId);
      return c.json({ ok: true }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/resync",
      security,
      summary: "Re-materialize every case's obligations against the current rules",
      responses: { 200: json(z.object({ synced: z.number() }), "Done") },
    }),
    async (c) => c.json({ synced: await resyncAll(db, c.get("actor")) }, 200),
  );

  return app;
}
