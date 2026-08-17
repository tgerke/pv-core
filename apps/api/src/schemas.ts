import { z } from "@hono/zod-openapi";

// Response rows come from the v_* views (docs/02-data-model.md): the schemas
// name the columns the web app depends on and pass the rest through, so an
// additive view change never breaks the contract.

export const ErrorSchema = z.object({ error: z.string() }).openapi("Error");

export const AccessRoleSchema = z.enum([
  "admin",
  "case_processor",
  "medical_reviewer",
  "read_only",
  "ingest",
]);
export const OperationSchema = z.enum(["read", "enter", "assess", "sign", "submit", "administer"]);

export const MeSchema = z
  .object({
    person_id: z.string().uuid(),
    label: z.string(),
    auth_mode: z.enum(["dev", "oidc"]),
    grants: z.array(
      z.object({
        role: AccessRoleSchema,
        organization_id: z.string().uuid().nullable(),
        study_id: z.string().uuid().nullable(),
      }),
    ),
    operations: z.array(OperationSchema),
  })
  .openapi("Me");

const loose = <T extends z.ZodRawShape>(shape: T, name: string) =>
  z.object(shape).catchall(z.any()).openapi(name);

export const StudySchema = loose(
  {
    id: z.string().uuid(),
    protocol_number: z.string(),
    title: z.string(),
    phase: z.string().nullable(),
    status: z.enum(["planning", "active", "closed"]),
    sponsor_org_id: z.string().uuid(),
    sponsor_name: z.string(),
    is_blinded: z.boolean(),
    ind_number: z.string().nullable(),
    eu_ct_number: z.string().nullable(),
  },
  "Study",
);

export const QueueRowSchema = loose(
  {
    case_id: z.string().uuid(),
    sender_case_id: z.string(),
    worldwide_unique_id: z.string(),
    study_id: z.string().uuid().nullable(),
    protocol_number: z.string().nullable(),
    product_name: z.string().nullable(),
    state: z.string(),
    expedited_class: z.enum(["7d", "15d", "none"]),
    reportability_reason: z.string(),
    open_obligations: z.coerce.number(),
    overdue_obligations: z.coerce.number(),
    next_due_date: z.string().nullable(),
    days_remaining: z.number().nullable(),
    latest_version_id: z.string().uuid(),
    latest_version_number: z.number(),
    primary_event_pt: z.string().nullable(),
    causality_assessed: z.boolean(),
    minimum_criteria_met: z.boolean(),
    is_unblinded: z.boolean(),
    is_nullified: z.boolean(),
  },
  "QueueRow",
);

export const ObligationSchema = loose(
  {
    expected_submission_id: z.string().uuid(),
    case_id: z.string().uuid(),
    case_version_id: z.string().uuid(),
    rule_name: z.string(),
    citation: z.string().nullable(),
    destination_id: z.string().uuid(),
    destination_name: z.string(),
    obligation_kind: z.enum(["initial", "follow_up", "nullification"]),
    clock_start_date: z.string(),
    due_date: z.string(),
    status: z.enum([
      "not_required",
      "acknowledged",
      "submitted",
      "superseded_by_follow_up",
      "overdue",
      "due_soon",
      "pending",
    ]),
    on_time: z.boolean().nullable(),
    days_remaining: z.number().nullable(),
  },
  "Obligation",
);

export const CaseDetailSchema = loose(
  { id: z.string().uuid(), sender_case_id: z.string(), state: z.string() },
  "CaseDetail",
);
export const RowSchema = z.object({}).catchall(z.any()).openapi("Row");
export const AuditEventSchema = loose(
  {
    id: z.coerce.number(),
    occurred_at: z.string(),
    actor_label: z.string(),
    action: z.string(),
    entity_type: z.string(),
    entity_id: z.string().nullable(),
    hash: z.string(),
    prev_hash: z.string(),
  },
  "AuditEvent",
);

// --- write bodies (snake_case on the wire, like the views) --------------------

const dateStr = z.string().date();
const uuid = z.string().uuid();

export const PatientBody = z.object({
  initials: z.string().max(10).nullish(),
  subject_number: z.string().nullish(),
  study_site_id: uuid.nullish(),
  age_value: z.number().int().nonnegative().nullish(),
  age_unit: z.enum(["years", "months", "weeks", "days", "hours"]).nullish(),
  age_group: z
    .enum(["foetus", "neonate", "infant", "child", "adolescent", "adult", "elderly"])
    .nullish(),
  sex: z.enum(["male", "female", "unknown"]).nullish(),
  weight_kg: z.number().nonnegative().nullish(),
  height_cm: z.number().nonnegative().nullish(),
  medical_history_text: z.string().nullish(),
  death_date: dateStr.nullish(),
  death_cause_text: z.string().nullish(),
});

export const SourceBody = z.object({
  seq: z.number().int().positive(),
  given_name: z.string().nullish(),
  family_name: z.string().nullish(),
  organization: z.string().nullish(),
  country: z.string().length(2).nullish(),
  qualification: z
    .enum(["physician", "pharmacist", "other_health_professional", "lawyer", "consumer"])
    .nullish(),
  is_primary_for_regulatory: z.boolean().optional(),
  person_id: uuid.nullish(),
});

export const EventBody = z.object({
  seq: z.number().int().positive(),
  reported_term: z.string().min(1),
  llt_code: z.string().nullish(),
  serious_death: z.boolean().optional(),
  serious_life_threatening: z.boolean().optional(),
  serious_hospitalization: z.boolean().optional(),
  serious_disabling: z.boolean().optional(),
  serious_congenital_anomaly: z.boolean().optional(),
  serious_other_medically_important: z.boolean().optional(),
  onset_date: dateStr.nullish(),
  end_date: dateStr.nullish(),
  outcome: z
    .enum([
      "recovered",
      "recovering",
      "not_recovered",
      "recovered_with_sequelae",
      "fatal",
      "unknown",
    ])
    .optional(),
  medically_confirmed: z.boolean().nullish(),
  occur_country: z.string().length(2).nullish(),
});

export const DrugBody = z.object({
  seq: z.number().int().positive(),
  role: z.enum(["suspect", "concomitant", "interacting", "not_administered"]),
  product_id: uuid.nullish(),
  name_as_reported: z.string().min(1),
  is_blinded: z.boolean().optional(),
  lot_number: z.string().nullish(),
  indication_pt_code: z.string().nullish(),
  indication_pt_term: z.string().nullish(),
  dose_text: z.string().nullish(),
  dose_value: z.number().nullish(),
  dose_unit: z.string().nullish(),
  route: z.string().nullish(),
  start_date: dateStr.nullish(),
  end_date: dateStr.nullish(),
  action_taken: z
    .enum([
      "drug_withdrawn",
      "dose_reduced",
      "dose_increased",
      "dose_not_changed",
      "unknown",
      "not_applicable",
    ])
    .nullish(),
});

export const AssessmentBody = z.object({
  drug_seq: z.number().int().positive(),
  event_seq: z.number().int().positive(),
  assessor: z.enum(["reporter", "sponsor"]),
  reasonable_possibility: z.boolean(),
  causality_method: z.string().nullish(),
  causality_result: z.string().nullish(),
  rechallenge: z
    .enum(["recurred", "did_not_recur", "outcome_unknown", "not_rechallenged"])
    .nullish(),
  expectedness_override: z.enum(["expected", "unexpected"]).nullish(),
  expectedness_rationale: z.string().nullish(),
  rsi_version_id: uuid.nullish(),
});

export const TestBody = z.object({
  seq: z.number().int().positive(),
  test_date: dateStr.nullish(),
  test_name: z.string().min(1),
  result_text: z.string().nullish(),
  unit: z.string().nullish(),
  comments: z.string().nullish(),
});

export const NarrativeBody = z.object({
  narrative: z.string().nullish(),
  reporter_comments: z.string().nullish(),
  sender_diagnosis_pt_code: z.string().nullish(),
  sender_diagnosis_pt_term: z.string().nullish(),
  sender_comments: z.string().nullish(),
});

export const SectionsBody = z.object({
  patient: PatientBody.optional(),
  sources: z.array(SourceBody).optional(),
  events: z.array(EventBody).optional(),
  drugs: z.array(DrugBody).optional(),
  tests: z.array(TestBody).optional(),
  narrative: NarrativeBody.optional(),
});

export const CreateCaseBody = SectionsBody.extend({
  study_id: uuid.nullish(),
  product_id: uuid,
  report_type: z.enum(["spontaneous", "study", "other", "unknown"]).optional(),
  first_received_date: dateStr,
  info_received_date: dateStr.optional(),
  awareness_date: dateStr.optional(),
  awareness_rationale: z.string().nullish(),
  dictionary_id: uuid.optional(),
  sender_case_id: z.string().optional(),
  worldwide_unique_id: z.string().optional(),
  replaces_case_id: uuid.nullish(),
  source: z
    .object({ system: z.string(), ref: z.string(), payload: z.unknown().optional() })
    .nullish(),
  assessments: z.array(AssessmentBody).optional(),
});

export const OpenVersionBody = z.object({
  kind: z.enum(["follow_up", "amendment"]),
  info_received_date: dateStr,
  awareness_date: dateStr.optional(),
  awareness_rationale: z.string().nullish(),
});

export const VersionHeaderBody = z.object({
  info_received_date: dateStr.optional(),
  awareness_date: dateStr.optional(),
  awareness_rationale: z.string().nullish(),
});

export const TransitionBody = z.object({
  to_state: z.enum(["data_entry", "medical_review", "closed"]),
  note: z.string().nullish(),
});

export const SignBody = z.object({
  meaning: z.enum(["medical_review", "approval"]),
  reauth_token: z.string().min(1),
});

export const NullifyBody = z.object({ reason: z.string().min(1) });

export const UnblindingBody = z.object({
  arm_label: z.string().min(1),
  arm_role: z.enum(["imp", "comparator", "placebo", "background"]),
  reason: z.string().min(1),
  unblinded_at: z.string().datetime().optional(),
  source_system: z.string().nullish(),
  source_ref: z.string().nullish(),
});

export const SubmissionBody = z.object({
  destination_id: uuid,
  kind: z.enum([
    "initial_notification",
    "initial_report",
    "follow_up_report",
    "amendment",
    "nullification",
    "notification_letter",
  ]),
  format: z.enum(["cioms_i_pdf", "medwatch_3500a_pdf", "e2b_r3_json", "portal_manual", "email"]),
  /** An attachment (kind submission_payload) already uploaded to the case; when omitted for e2b_r3_json the server renders and stores the export. */
  payload_attachment_id: uuid.nullish(),
  message_id: z.string().nullish(),
  transmission_ref: z.string().nullish(),
  note: z.string().nullish(),
  sent_at: z.string().datetime().optional(),
});

export const AckBody = z.object({
  ack_code: z.enum(["AA", "AE", "AR", "CA", "CR", "manual_receipt"]),
  ack_message_id: z.string().nullish(),
  error_text: z.string().nullish(),
  received_at: z.string().datetime().optional(),
});

export const WaiverBody = z.object({ reason: z.string().min(1) });
export const RevokeWaiverBody = z.object({ waiver_id: uuid, reason: z.string().min(1) });

export const RuleBody = z.object({
  sponsor_org_id: uuid.nullish(),
  study_id: uuid.nullish(),
  product_id: uuid.nullish(),
  destination_id: uuid,
  name: z.string().min(1),
  citation: z.string().nullish(),
  report_types: z.array(z.string()).nullish(),
  version_kinds: z.array(z.string()).nullish(),
  obligation_kind: z.enum(["initial", "follow_up", "nullification"]).optional(),
  serious: z.boolean().nullish(),
  unexpected: z.boolean().nullish(),
  related: z.boolean().nullish(),
  fatal_or_life_threatening: z.boolean().nullish(),
  causality_basis: z.enum(["either", "sponsor", "reporter"]).optional(),
  requires_prior_submission: z.boolean().optional(),
  timeline_days: z.number().int().positive(),
  due_soon_days: z.number().int().nonnegative().optional(),
  satisfying_kinds: z
    .array(
      z.enum([
        "initial_notification",
        "initial_report",
        "follow_up_report",
        "amendment",
        "nullification",
        "notification_letter",
      ]),
    )
    .min(1),
  effective_from: dateStr,
  effective_to: dateStr.nullish(),
});

export const EndBody = z.object({ effective_to: dateStr });

export const OrganizationBody = z.object({
  name: z.string().min(1),
  kind: z.enum(["sponsor", "cro", "site_org"]),
});
export const StudyBody = z.object({
  protocol_number: z.string().min(1),
  title: z.string().min(1),
  phase: z.string().nullish(),
  status: z.enum(["planning", "active", "closed"]).optional(),
  sponsor_org_id: uuid,
  ind_number: z.string().nullish(),
  eu_ct_number: z.string().nullish(),
  is_blinded: z.boolean().optional(),
  study_type: z.enum(["clinical_trial", "individual_patient_use", "other_study"]).optional(),
  product_ids: z.array(uuid).optional(),
});
export const StudyPatchBody = z.object({ status: z.enum(["planning", "active", "closed"]) });
export const SiteBody = z.object({
  organization_id: uuid,
  name: z.string().min(1),
  city: z.string().nullish(),
  country: z.string().length(2),
  study_id: uuid.optional(),
  site_number: z.string().optional(),
});
export const ProductBody = z.object({
  sponsor_org_id: uuid,
  name: z.string().min(1),
  substance: z.string().nullish(),
  kind: z.enum(["investigational", "marketed"]).optional(),
});
export const RsiVersionBody = z.object({
  label: z.string().min(1),
  effective_from: dateStr,
  dictionary_id: uuid,
  listed_terms: z.array(
    z.object({ pt_code: z.string(), pt_term: z.string(), listedness_note: z.string().nullish() }),
  ),
  document_sha256: z.string().length(64).nullish(),
  end_previous: z.boolean().optional(),
});
export const DestinationBody = z.object({
  sponsor_org_id: uuid.nullish(),
  name: z.string().min(1),
  kind: z.enum(["regulator", "ethics_committee", "investigator_group", "partner"]),
  country: z.string().length(2).nullish(),
  e2b_receiver_id: z.string().nullish(),
  default_format: z
    .enum(["cioms_i_pdf", "medwatch_3500a_pdf", "e2b_r3_json", "portal_manual", "email"])
    .optional(),
});
export const PersonBody = z.object({
  given_name: z.string().min(1),
  family_name: z.string().min(1),
  email: z.string().email(),
  credentials: z.string().nullish(),
});
export const GrantBody = z.object({
  person_id: uuid,
  role: AccessRoleSchema,
  organization_id: uuid.nullish(),
  study_id: uuid.nullish(),
});
export const ImportDictionaryBody = z.object({
  version: z.string().min(1),
  dir: z.string().min(1),
});
