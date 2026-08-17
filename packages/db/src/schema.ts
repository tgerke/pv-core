import {
  bigserial,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
//
// Coded E2B(R3) values are stored as named enums; the numeric codes the IG
// assigns (verified against the IG source per ADR-0010) are mapped in the
// export module and quoted in comments here.
// ---------------------------------------------------------------------------

export const orgKind = pgEnum("org_kind", ["sponsor", "cro", "site_org"]);
export const studyStatus = pgEnum("study_status", ["planning", "active", "closed"]);
export const studySiteStatus = pgEnum("study_site_status", ["pending", "active", "closed"]);
// System-access roles (who may call which API operations, ADR-0015/0016).
// 'ingest' is the machine-identity role for source-system intake: it may
// create cases, their children, and attachments, and never assess, sign, or
// submit.
export const accessRole = pgEnum("access_role", [
  "admin",
  "case_processor",
  "medical_reviewer",
  "read_only",
  "ingest",
]);
// How the signer re-authenticated at signing time (§11.200). seed_fixture marks
// demo signatures fabricated by the seed, not a real signing ceremony.
export const reauthMethod = pgEnum("reauth_method", [
  "oidc_fresh_token",
  "dev_token",
  "seed_fixture",
]);
export const signatureMeaning = pgEnum("signature_meaning", ["medical_review", "approval"]);
// E2B(R3) C.1.3 Type of Report: 1 spontaneous, 2 report from study, 3 other,
// 4 not available to sender.
export const reportType = pgEnum("report_type", ["spontaneous", "study", "other", "unknown"]);
// E2B(R3) C.5.4 Study Type: 1 clinical trials, 2 individual patient use,
// 3 other studies.
export const studyType = pgEnum("study_type", [
  "clinical_trial",
  "individual_patient_use",
  "other_study",
]);
export const versionKind = pgEnum("version_kind", ["initial", "follow_up", "amendment"]);
// E2B(R3) G.k.1 Characterisation of Drug Role: 1 suspect, 2 concomitant,
// 3 interacting, 4 drug not administered.
export const drugRole = pgEnum("drug_role", [
  "suspect",
  "concomitant",
  "interacting",
  "not_administered",
]);
// E2B(R3) E.i.7 Outcome at last observation: 1 recovered/resolved,
// 2 recovering/resolving, 3 not recovered/not resolved/ongoing,
// 4 recovered/resolved with sequelae, 5 fatal, 0 unknown.
export const eventOutcome = pgEnum("event_outcome", [
  "recovered",
  "recovering",
  "not_recovered",
  "recovered_with_sequelae",
  "fatal",
  "unknown",
]);
// E2B(R3) G.k.8 Action taken with drug: 1 withdrawn, 2 dose reduced,
// 3 dose increased, 4 dose not changed, 0 unknown, 9 not applicable.
export const actionTaken = pgEnum("action_taken", [
  "drug_withdrawn",
  "dose_reduced",
  "dose_increased",
  "dose_not_changed",
  "unknown",
  "not_applicable",
]);
// E2B(R3) G.k.9.i.4 Did reaction recur on re-administration: 1 yes-yes,
// 2 yes-no, 3 yes-unknown, 4 no-n/a.
export const rechallenge = pgEnum("rechallenge", [
  "recurred",
  "did_not_recur",
  "outcome_unknown",
  "not_rechallenged",
]);
// E2B(R3) C.2.r.4 Reporter qualification: 1 physician, 2 pharmacist, 3 other
// health professional, 4 lawyer, 5 consumer or other non health professional.
export const reporterQualification = pgEnum("reporter_qualification", [
  "physician",
  "pharmacist",
  "other_health_professional",
  "lawyer",
  "consumer",
]);
// ISO 5218 (E2B(R3) D.5): 1 male, 2 female, 0 not known.
export const sex = pgEnum("sex", ["male", "female", "unknown"]);
// E2B(R3) D.2.2b: UCUM a, mo, wk, d, h (decade omitted).
export const ageUnit = pgEnum("age_unit", ["years", "months", "weeks", "days", "hours"]);
// E2B(R3) D.2.3 Age group as per reporter: 0 foetus, 1 neonate, 2 infant,
// 3 child, 4 adolescent, 5 adult, 6 elderly.
export const ageGroup = pgEnum("age_group", [
  "foetus",
  "neonate",
  "infant",
  "child",
  "adolescent",
  "adult",
  "elderly",
]);
export const assessorKind = pgEnum("assessor_kind", ["reporter", "sponsor"]);
export const expectedness = pgEnum("expectedness", ["expected", "unexpected"]);
export const causalityBasis = pgEnum("causality_basis", ["either", "sponsor", "reporter"]);
export const obligationKind = pgEnum("obligation_kind", ["initial", "follow_up", "nullification"]);
export const submissionKind = pgEnum("submission_kind", [
  "initial_notification",
  "initial_report",
  "follow_up_report",
  "amendment",
  "nullification",
  "notification_letter",
]);
export const submissionFormat = pgEnum("submission_format", [
  "cioms_i_pdf",
  "medwatch_3500a_pdf",
  "e2b_r3_json",
  "portal_manual",
  "email",
]);
export const destinationKind = pgEnum("destination_kind", [
  "regulator",
  "ethics_committee",
  "investigator_group",
  "partner",
]);
// Only the intent transitions no other fact implies are stored (ADR-0004);
// intake / approved / submitted / nullified are derived in v_case_queue.
export const workflowState = pgEnum("workflow_state", ["data_entry", "medical_review", "closed"]);
export const productRole = pgEnum("product_role", ["imp", "comparator", "placebo", "background"]);
export const productKind = pgEnum("product_kind", ["investigational", "marketed"]);
export const attachmentKind = pgEnum("attachment_kind", [
  "source_document",
  "correspondence",
  "submission_payload",
]);
export const dictionaryType = pgEnum("dictionary_type", ["MedDRA", "WHODrug"]);

// ---------------------------------------------------------------------------
// Organizational spine
// ---------------------------------------------------------------------------

export const organization = pgTable("organization", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: orgKind("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const study = pgTable("study", {
  id: uuid("id").primaryKey().defaultRandom(),
  protocolNumber: text("protocol_number").notNull().unique(),
  title: text("title").notNull(),
  phase: text("phase"),
  status: studyStatus("status").notNull().default("planning"),
  sponsorOrgId: uuid("sponsor_org_id")
    .notNull()
    .references(() => organization.id),
  // C.5.1.r study registration numbers as the regulators know them.
  indNumber: text("ind_number"),
  euCtNumber: text("eu_ct_number"),
  isBlinded: boolean("is_blinded").notNull().default(false),
  studyType: studyType("study_type").notNull().default("clinical_trial"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const site = pgTable("site", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organization.id),
  name: text("name").notNull(),
  city: text("city"),
  // ISO 3166-1 alpha-2: feeds C.2.r.3 (reporter country) and E.i.9
  // (country of occurrence).
  country: char("country", { length: 2 }).notNull(),
});

export const studySite = pgTable(
  "study_site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => study.id),
    siteId: uuid("site_id")
      .notNull()
      .references(() => site.id),
    siteNumber: text("site_number").notNull(),
    status: studySiteStatus("status").notNull().default("pending"),
  },
  (t) => [
    uniqueIndex("study_site_pair_idx").on(t.studyId, t.siteId),
    uniqueIndex("study_site_number_idx").on(t.studyId, t.siteNumber),
  ],
);

// An investigational or comparator product owned by a sponsor organization.
export const product = pgTable("product", {
  id: uuid("id").primaryKey().defaultRandom(),
  sponsorOrgId: uuid("sponsor_org_id")
    .notNull()
    .references(() => organization.id),
  name: text("name").notNull(),
  substance: text("substance"),
  kind: productKind("kind").notNull().default("investigational"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const studyProduct = pgTable(
  "study_product",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => study.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id),
    role: productRole("role").notNull().default("imp"),
  },
  (t) => [uniqueIndex("study_product_pair_idx").on(t.studyId, t.productId)],
);

// Reference Safety Information in effect for a period: the Investigator's
// Brochure section (or label) expectedness is judged against (E2A §II.C).
// effective_to is the row's one permitted mutation, an ending, never a delete.
export const productRsiVersion = pgTable(
  "product_rsi_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id),
    label: text("label").notNull(), // e.g. "IB v2.0 §6.3"
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    // The RSI document itself, as a content-addressed attachment (ADR-0013).
    documentSha256: char("document_sha256", { length: 64 }),
    approvedBy: uuid("approved_by").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_rsi_version_product_idx").on(t.productId, t.effectiveFrom)],
);

// The MedDRA Preferred Terms an RSI version lists. Immutable: a listedness
// change is a new RSI version.
export const rsiListedTerm = pgTable(
  "rsi_listed_term",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rsiVersionId: uuid("rsi_version_id")
      .notNull()
      .references(() => productRsiVersion.id),
    dictionaryId: uuid("dictionary_id")
      .notNull()
      .references(() => dictionary.id),
    ptCode: text("pt_code").notNull(),
    ptTerm: text("pt_term").notNull(),
    // Severity/specificity qualifier, e.g. "listed as Grade ≤ 3": E2A §II.C.2
    // makes a more specific or more severe form unexpected.
    listednessNote: text("listedness_note"),
  },
  (t) => [uniqueIndex("rsi_listed_term_unique").on(t.rsiVersionId, t.ptCode)],
);

export const person = pgTable("person", {
  id: uuid("id").primaryKey().defaultRandom(),
  givenName: text("given_name").notNull(),
  familyName: text("family_name").notNull(),
  email: text("email").notNull().unique(),
  credentials: text("credentials"), // e.g. "MD", "PharmD"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Access grants (ADR-0015): scoped to a sponsor organization, to a study, or
// unscoped (instance-wide). At most one scope is set. Revocation is a dated
// fact.
export const accessGrant = pgTable(
  "access_grant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    role: accessRole("role").notNull(),
    organizationId: uuid("organization_id").references(() => organization.id),
    studyId: uuid("study_id").references(() => study.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("access_grant_person_idx").on(t.personId)],
);

// An authority, ethics committee, investigator group, or partner that receives
// submissions. Optionally owned by a sponsor organization.
export const reportingDestination = pgTable("reporting_destination", {
  id: uuid("id").primaryKey().defaultRandom(),
  sponsorOrgId: uuid("sponsor_org_id").references(() => organization.id),
  name: text("name").notNull(),
  kind: destinationKind("kind").notNull(),
  country: char("country", { length: 2 }),
  // N.1.4 / C.3 receiver identifier used on E2B(R3) files.
  e2bReceiverId: text("e2b_receiver_id"),
  defaultFormat: submissionFormat("default_format").notNull().default("cioms_i_pdf"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Deployment-level operational facts (default dictionary, importer
// provenance). Written by tooling, never by request handlers; audited.
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Dictionary (ADR-0005): a loaded MedDRA (or WHODrug) release. Immutable after
// load; a new release is a new row. Only is_demo_subset = true rows are ever
// created by code in this repository; the verbatim importer loads the
// licensed distribution and records its hash.
// ---------------------------------------------------------------------------

export const dictionary = pgTable(
  "dictionary",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: dictionaryType("type").notNull(),
    version: text("version").notNull(),
    termsCount: integer("terms_count").notNull().default(0),
    isDemoSubset: boolean("is_demo_subset").notNull(),
    sourceSha256: char("source_sha256", { length: 64 }),
    loadedBy: uuid("loaded_by").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dictionary_type_version_unique").on(t.type, t.version)],
);

// One row per Lowest Level Term with its primary path. Not row-audited:
// reloadable licensed reference data; the audited header carries counts and
// the source hash. A trigram GIN index for substring search is added in SQL
// (0001); drizzle-orm has no gin_trgm_ops helper.
export const dictionaryTerm = pgTable(
  "dictionary_term",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dictionaryId: uuid("dictionary_id")
      .notNull()
      .references(() => dictionary.id),
    code: text("code").notNull(), // LLT code
    term: text("term").notNull(), // LLT term
    normalizedTerm: text("normalized_term").notNull(),
    ptCode: text("pt_code").notNull(),
    ptTerm: text("pt_term").notNull(),
    hltCode: text("hlt_code"),
    hltTerm: text("hlt_term"),
    hlgtCode: text("hlgt_code"),
    hlgtTerm: text("hlgt_term"),
    socCode: text("soc_code").notNull(),
    socTerm: text("soc_term").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
  },
  (t) => [
    uniqueIndex("dictionary_term_code_unique").on(t.dictionaryId, t.code),
    index("dictionary_term_exact_idx").on(t.dictionaryId, t.normalizedTerm),
    index("dictionary_term_pt_idx").on(t.dictionaryId, t.ptCode),
  ],
);

// ---------------------------------------------------------------------------
// Case model (ADR-0006, ADR-0009). Element IDs are ICH E2B(R3) IG data
// elements.
// ---------------------------------------------------------------------------

// The identity that stays constant across every transmission of the case.
// Identity columns are guarded by trigger (0001).
export const pvCase = pgTable(
  "case",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // C.1.8.1 Worldwide Unique Case Identification Number: never changes.
    worldwideUniqueId: text("worldwide_unique_id").notNull().unique(),
    // C.1.1 Sender's (case) Safety Report Unique Identifier: CC-org-number.
    senderCaseId: text("sender_case_id").notNull().unique(),
    reportType: reportType("report_type").notNull().default("study"), // C.1.3
    studyId: uuid("study_id").references(() => study.id), // null = spontaneous
    // Primary suspect product: anchors RSI lookup and DSUR grouping.
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id),
    firstReceivedDate: date("first_received_date").notNull(), // C.1.4
    // Machine intake provenance: the as-received record and its hash.
    sourceSystem: text("source_system"),
    sourceRef: text("source_ref"),
    intakePayload: jsonb("intake_payload"),
    intakePayloadSha256: char("intake_payload_sha256", { length: 64 }),
    // A resubmission after nullification is a new case (IG C.1.11).
    replacesCaseId: uuid("replaces_case_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("case_study_idx").on(t.studyId),
    index("case_product_idx").on(t.productId),
    index("case_replaces_idx").on(t.replacesCaseId),
  ],
);

// One transmission-worthy state of a case. Mutable while unsigned; locked
// forever by its first signature (ADR-0006).
export const caseVersion = pgTable(
  "case_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => pvCase.id),
    versionNumber: integer("version_number").notNull(),
    kind: versionKind("kind").notNull(),
    // C.1.5 Date of Most Recent Information for This Report.
    infoReceivedDate: date("info_received_date").notNull(),
    // Day zero of every clock (E2A §III.B.3): the sponsor's first knowledge
    // that the case meets the minimum criteria. Defaults to
    // info_received_date; a rationale is required when they differ (CHECK in
    // 0001).
    awarenessDate: date("awareness_date").notNull(),
    awarenessRationale: text("awareness_rationale"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    // The MedDRA release this ICSR is coded with (IG §3.2: one per ICSR).
    dictionaryId: uuid("dictionary_id")
      .notNull()
      .references(() => dictionary.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("case_version_number_unique").on(t.caseId, t.versionNumber)],
);

// D Patient characteristics. Pseudonymous by design; birth dates avoided.
export const casePatient = pgTable(
  "case_patient",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersion.id),
    initials: text("initials"), // D.1
    subjectNumber: text("subject_number"), // D.1.1.4 investigation number
    studySiteId: uuid("study_site_id").references(() => studySite.id),
    ageValue: integer("age_value"), // D.2.2a
    ageUnit: ageUnit("age_unit"), // D.2.2b
    ageGroup: ageGroup("age_group"), // D.2.3
    sex: sex("sex"), // D.5
    weightKg: numeric("weight_kg"), // D.3
    heightCm: numeric("height_cm"), // D.4
    medicalHistoryText: text("medical_history_text"), // D.7.2
    deathDate: date("death_date"), // D.9.1
    deathCauseText: text("death_cause_text"), // D.9.2.r
  },
  (t) => [uniqueIndex("case_patient_version_unique").on(t.caseVersionId)],
);

// C.2.r Primary source(s): the reporters.
export const caseSource = pgTable(
  "case_source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersion.id),
    seq: integer("seq").notNull(),
    givenName: text("given_name"), // C.2.r.1.2
    familyName: text("family_name"), // C.2.r.1.4
    organization: text("organization"), // C.2.r.2.1
    country: char("country", { length: 2 }), // C.2.r.3
    qualification: reporterQualification("qualification"), // C.2.r.4
    isPrimaryForRegulatory: boolean("is_primary_for_regulatory").notNull().default(false), // C.2.r.5
    personId: uuid("person_id").references(() => person.id),
  },
  (t) => [uniqueIndex("case_source_seq_unique").on(t.caseVersionId, t.seq)],
);

// E.i Reaction(s) / event(s), coded at LLT with the path snapshotted.
export const caseEvent = pgTable(
  "case_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersion.id),
    seq: integer("seq").notNull(),
    reportedTerm: text("reported_term").notNull(), // E.i.1.1a
    dictionaryId: uuid("dictionary_id").references(() => dictionary.id),
    lltCode: text("llt_code"), // E.i.2.1b
    lltTerm: text("llt_term"),
    ptCode: text("pt_code"),
    ptTerm: text("pt_term"),
    hltCode: text("hlt_code"),
    hltTerm: text("hlt_term"),
    hlgtCode: text("hlgt_code"),
    hlgtTerm: text("hlgt_term"),
    socCode: text("soc_code"),
    socTerm: text("soc_term"),
    // E.i.3.2 seriousness criteria (a-f).
    seriousDeath: boolean("serious_death").notNull().default(false),
    seriousLifeThreatening: boolean("serious_life_threatening").notNull().default(false),
    seriousHospitalization: boolean("serious_hospitalization").notNull().default(false),
    seriousDisabling: boolean("serious_disabling").notNull().default(false),
    seriousCongenitalAnomaly: boolean("serious_congenital_anomaly").notNull().default(false),
    seriousOtherMedicallyImportant: boolean("serious_other_medically_important")
      .notNull()
      .default(false),
    onsetDate: date("onset_date"), // E.i.4
    endDate: date("end_date"), // E.i.5
    outcome: eventOutcome("outcome").notNull().default("unknown"), // E.i.7
    medicallyConfirmed: boolean("medically_confirmed"), // E.i.8
    occurCountry: char("occur_country", { length: 2 }), // E.i.9
  },
  (t) => [
    uniqueIndex("case_event_seq_unique").on(t.caseVersionId, t.seq),
    index("case_event_pt_idx").on(t.ptCode),
  ],
);

// G.k Drug(s) information.
export const caseDrug = pgTable(
  "case_drug",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersion.id),
    seq: integer("seq").notNull(),
    role: drugRole("role").notNull(), // G.k.1
    productId: uuid("product_id").references(() => product.id),
    nameAsReported: text("name_as_reported").notNull(), // G.k.2.2
    isBlinded: boolean("is_blinded").notNull().default(false), // G.k.2.5
    lotNumber: text("lot_number"), // G.k.4.r.7
    indicationPtCode: text("indication_pt_code"), // G.k.7.r.2
    indicationPtTerm: text("indication_pt_term"),
    doseText: text("dose_text"), // G.k.4.r.8
    doseValue: numeric("dose_value"), // G.k.4.r.1a
    doseUnit: text("dose_unit"), // G.k.4.r.1b
    route: text("route"), // G.k.4.r.10
    startDate: date("start_date"), // G.k.4.r.4
    endDate: date("end_date"), // G.k.4.r.5
    actionTaken: actionTaken("action_taken"), // G.k.8
  },
  (t) => [uniqueIndex("case_drug_seq_unique").on(t.caseVersionId, t.seq)],
);

// G.k.9.i Drug-reaction matrix: one row per drug x event x assessor.
export const caseAssessment = pgTable(
  "case_assessment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersion.id),
    caseDrugId: uuid("case_drug_id")
      .notNull()
      .references(() => caseDrug.id),
    caseEventId: uuid("case_event_id")
      .notNull()
      .references(() => caseEvent.id),
    assessor: assessorKind("assessor").notNull(), // G.k.9.i.2.r.1 source
    // E2A §II.A.2: a causal relationship that "cannot be ruled out".
    reasonablePossibility: boolean("reasonable_possibility").notNull(),
    causalityMethod: text("causality_method"), // G.k.9.i.2.r.2
    causalityResult: text("causality_result"), // G.k.9.i.2.r.3
    rechallenge: rechallenge("rechallenge"), // G.k.9.i.4
    // Sponsor judgment that overrides the RSI-derived expectedness (E2A
    // §II.C.2). Override and rationale are required together (CHECK in 0001).
    expectednessOverride: expectedness("expectedness_override"),
    expectednessRationale: text("expectedness_rationale"),
    rsiVersionId: uuid("rsi_version_id").references(() => productRsiVersion.id),
  },
  (t) => [
    uniqueIndex("case_assessment_unique").on(t.caseDrugId, t.caseEventId, t.assessor),
    index("case_assessment_version_idx").on(t.caseVersionId),
  ],
);

// F.r Results of tests and procedures (minimal).
export const caseTest = pgTable(
  "case_test",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersion.id),
    seq: integer("seq").notNull(),
    testDate: date("test_date"), // F.r.1
    testName: text("test_name").notNull(), // F.r.2.1
    resultText: text("result_text"), // F.r.3
    unit: text("unit"),
    comments: text("comments"), // F.r.6
  },
  (t) => [uniqueIndex("case_test_seq_unique").on(t.caseVersionId, t.seq)],
);

// H Narrative case summary and further information.
export const caseNarrative = pgTable(
  "case_narrative",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersion.id),
    narrative: text("narrative"), // H.1
    reporterComments: text("reporter_comments"), // H.2
    senderDiagnosisPtCode: text("sender_diagnosis_pt_code"), // H.3.r
    senderDiagnosisPtTerm: text("sender_diagnosis_pt_term"),
    senderComments: text("sender_comments"), // H.4
  },
  (t) => [uniqueIndex("case_narrative_version_unique").on(t.caseVersionId)],
);

// Source documents, correspondence, and submitted payload bytes, content-
// addressed into the blob store (ADR-0013). Immutable rows.
export const caseAttachment = pgTable(
  "case_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => pvCase.id),
    caseVersionId: uuid("case_version_id").references(() => caseVersion.id),
    kind: attachmentKind("kind").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => person.id),
    sourceSystem: text("source_system"),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("case_attachment_case_idx").on(t.caseId),
    index("case_attachment_sha_idx").on(t.sha256),
  ],
);

// The stored intent transitions (ADR-0004). Immutable.
export const caseTransition = pgTable(
  "case_transition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => pvCase.id),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersion.id),
    toState: workflowState("to_state").notNull(),
    transitionedBy: uuid("transitioned_by")
      .notNull()
      .references(() => person.id),
    transitionedAt: timestamp("transitioned_at", { withTimezone: true }).notNull().defaultNow(),
    // Required when a reviewer returns a version to data entry (CHECK in 0001).
    note: text("note"),
  },
  (t) => [index("case_transition_version_idx").on(t.caseVersionId, t.transitionedAt)],
);

// Part 11 signature on a case version. Immutable; the first one locks the
// version (ADR-0006).
export const signature = pgTable(
  "signature",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersion.id),
    signerPersonId: uuid("signer_person_id")
      .notNull()
      .references(() => person.id),
    meaning: signatureMeaning("meaning").notNull(),
    // Copy of pv_case_version_sha256(version) at signing: the §11.70
    // record<->signature binding, verifiable independently of the rows.
    signedSha256: char("signed_sha256", { length: 64 }).notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    // §11.200: how and when the signer re-authenticated. NOT NULL from birth.
    reauthMethod: reauthMethod("reauth_method").notNull(),
    reauthAt: timestamp("reauth_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("signature_version_idx").on(t.caseVersionId)],
);

// Unblinding fact (ADR-0008): at most one per case; the randomization system
// computed it. The only table with an arm at rest.
export const caseUnblinding = pgTable(
  "case_unblinding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => pvCase.id),
    armLabel: text("arm_label").notNull(),
    armRole: productRole("arm_role").notNull(),
    unblindedAt: timestamp("unblinded_at", { withTimezone: true }).notNull(),
    unblindedBy: uuid("unblinded_by")
      .notNull()
      .references(() => person.id),
    reason: text("reason").notNull(),
    sourceSystem: text("source_system"),
    sourceRef: text("source_ref"),
  },
  (t) => [uniqueIndex("case_unblinding_case_unique").on(t.caseId)],
);

// Nullification fact (C.1.11.1 = 1): at most one per case; a trigger rejects
// further versions.
export const caseNullification = pgTable(
  "case_nullification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => pvCase.id),
    reason: text("reason").notNull(), // C.1.11.2
    nullifiedBy: uuid("nullified_by")
      .notNull()
      .references(() => person.id),
    nullifiedAt: timestamp("nullified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("case_nullification_case_unique").on(t.caseId)],
);

// ---------------------------------------------------------------------------
// Reporting-obligation engine (ADR-0007)
// ---------------------------------------------------------------------------

// A rule is a row: destination, scope, obligation kind, a per-event predicate
// (NULL = don't care), timeline in calendar days, and what satisfies it. Rules
// change by ending one and inserting another.
export const reportingRule = pgTable(
  "reporting_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sponsorOrgId: uuid("sponsor_org_id").references(() => organization.id),
    studyId: uuid("study_id").references(() => study.id),
    productId: uuid("product_id").references(() => product.id),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => reportingDestination.id),
    name: text("name").notNull(),
    citation: text("citation"),
    reportTypes: text("report_types").array(),
    versionKinds: text("version_kinds").array(),
    obligationKind: obligationKind("obligation_kind").notNull().default("initial"),
    serious: boolean("serious"),
    unexpected: boolean("unexpected"),
    related: boolean("related"),
    fatalOrLifeThreatening: boolean("fatal_or_life_threatening"),
    causalityBasis: causalityBasis("causality_basis").notNull().default("either"),
    requiresPriorSubmission: boolean("requires_prior_submission").notNull().default(false),
    timelineDays: integer("timeline_days").notNull(),
    dueSoonDays: integer("due_soon_days").notNull().default(3),
    satisfyingKinds: text("satisfying_kinds").array().notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reporting_rule_destination_idx").on(t.destinationId)],
);

// Materialized obligation: unique per rule x triggering version. Derived
// state (ADR-0004); the sync may recompute due dates and remove rows for a
// still-open version that no longer matches. Audited.
export const expectedSubmission = pgTable(
  "expected_submission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportingRuleId: uuid("reporting_rule_id")
      .notNull()
      .references(() => reportingRule.id),
    caseId: uuid("case_id")
      .notNull()
      .references(() => pvCase.id),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersion.id),
    obligationKind: obligationKind("obligation_kind").notNull(),
    clockStartDate: date("clock_start_date").notNull(),
    dueDate: date("due_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("expected_submission_rule_version_unique").on(t.reportingRuleId, t.caseVersionId),
    index("expected_submission_case_idx").on(t.caseId),
    index("expected_submission_due_idx").on(t.dueDate),
  ],
);

// A recorded judgment that an obligation is not required. Waiver and
// revocation are dated facts.
export const expectedSubmissionWaiver = pgTable(
  "expected_submission_waiver",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expectedSubmissionId: uuid("expected_submission_id")
      .notNull()
      .references(() => expectedSubmission.id),
    waivedBy: uuid("waived_by")
      .notNull()
      .references(() => person.id),
    reason: text("reason").notNull(),
    waivedAt: timestamp("waived_at", { withTimezone: true }).notNull().defaultNow(),
    revokedBy: uuid("revoked_by").references(() => person.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
  },
  (t) => [index("expected_submission_waiver_idx").on(t.expectedSubmissionId)],
);

// What was actually sent. Immutable. A guard trigger requires an approval
// signature on the version whose hash equals the current one (0001).
export const submission = pgTable(
  "submission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseVersionId: uuid("case_version_id")
      .notNull()
      .references(() => caseVersion.id),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => reportingDestination.id),
    kind: submissionKind("kind").notNull(),
    format: submissionFormat("format").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    sentBy: uuid("sent_by")
      .notNull()
      .references(() => person.id),
    // The exact bytes sent, as an attachment of kind submission_payload.
    payloadSha256: char("payload_sha256", { length: 64 }),
    // Copy of the version hash at sending.
    caseVersionSha256: char("case_version_sha256", { length: 64 }).notNull(),
    messageId: text("message_id"), // N.2.r.1
    transmissionRef: text("transmission_ref"),
    note: text("note"),
  },
  (t) => [
    index("submission_version_idx").on(t.caseVersionId),
    index("submission_destination_idx").on(t.destinationId, t.sentAt),
  ],
);

// Regulator/partner acknowledgement (IG §4.0 codes, or manual_receipt).
// Immutable.
export const submissionAcknowledgement = pgTable(
  "submission_acknowledgement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submission.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    ackCode: text("ack_code").notNull(),
    ackMessageId: text("ack_message_id"),
    errorText: text("error_text"),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => person.id),
  },
  (t) => [index("submission_ack_submission_idx").on(t.submissionId)],
);

// ---------------------------------------------------------------------------
// Audit trail (ADR-0003). Written by pv_audit() triggers; hash-chained.
// ---------------------------------------------------------------------------

export const auditEvent = pgTable(
  "audit_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorId: uuid("actor_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(), // e.g. "case_event.update"
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    prevHash: char("prev_hash", { length: 64 }).notNull(),
    hash: char("hash", { length: 64 }).notNull(),
  },
  (t) => [index("audit_event_entity_idx").on(t.entityType, t.entityId)],
);
