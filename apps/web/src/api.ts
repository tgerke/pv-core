import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authMode, beginLogin, getReauthToken, token } from "./auth";

// --- Identity and access ---------------------------------------------------------

export type AccessRole = "admin" | "case_processor" | "medical_reviewer" | "read_only" | "ingest";
export type Operation = "read" | "enter" | "assess" | "sign" | "submit" | "administer";

export const ACCESS_ROLE_LABEL: Record<AccessRole, string> = {
  admin: "Admin",
  case_processor: "Case processor",
  medical_reviewer: "Medical reviewer",
  read_only: "Read-only",
  ingest: "Ingest (machine)",
};

export interface Me {
  person_id: string;
  label: string;
  auth_mode: "dev" | "oidc";
  grants: { role: AccessRole; organization_id: string | null; study_id: string | null }[];
  // The API's own answer for what this identity may do somewhere; the
  // permission gate on each route stays the authority.
  operations: Operation[];
}

export const can = (me: Me | undefined, op: Operation): boolean => !!me?.operations.includes(op);

// --- Studies -----------------------------------------------------------------------

export type StudyStatus = "planning" | "active" | "closed";

export interface StudyProduct {
  id: string;
  name: string;
  role: string;
}

export interface Study {
  id: string;
  protocol_number: string;
  title: string;
  phase: string | null;
  status: StudyStatus;
  sponsor_org_id: string;
  sponsor_name: string;
  is_blinded: boolean;
  ind_number: string | null;
  eu_ct_number: string | null;
  study_type: string;
  case_count: number | string;
  overdue_case_count: number | string;
  products: StudyProduct[];
}

export interface StudySite {
  id: string;
  site_number: string;
  name: string;
  country: string;
  status: string;
}

export interface StudyDetail extends Omit<Study, "case_count" | "overdue_case_count"> {
  sites: StudySite[];
}

// --- Case queue ----------------------------------------------------------------------

export type CaseState =
  | "intake"
  | "data_entry"
  | "medical_review"
  | "approved"
  | "submitted"
  | "closed"
  | "nullified";
export type ExpeditedClass = "7d" | "15d" | "none";

export interface QueueRow {
  case_id: string;
  worldwide_unique_id: string;
  sender_case_id: string;
  report_type: string;
  study_id: string | null;
  protocol_number: string | null;
  sponsor_org_id: string | null;
  product_id: string | null;
  product_name: string | null;
  first_received_date: string;
  source_system: string | null;
  latest_version_id: string;
  latest_version_number: number;
  latest_version_kind: string;
  awareness_date: string;
  info_received_date: string;
  subject_number: string | null;
  initials: string | null;
  primary_event_pt: string | null;
  primary_event_soc: string | null;
  expedited_class: ExpeditedClass;
  reportability_reason: string;
  causality_assessed: boolean;
  minimum_criteria_met: boolean;
  is_blinded: boolean | null;
  is_unblinded: boolean;
  is_nullified: boolean;
  state: CaseState;
  open_obligations: number | string;
  overdue_obligations: number | string;
  next_due_date: string | null;
  days_remaining: number | null;
  latest_signature_meaning: string | null;
  latest_signed_at: string | null;
  attachment_count: number | string;
  version_count: number | string;
  any_anticipated: boolean;
  any_causality_disagreement: boolean;
  received_via: ReceiptChannel | null;
  received_ref: string | null;
}

export type ReceiptChannel = "email" | "fax" | "phone" | "edc_push" | "other";
export const RECEIPT_CHANNELS: { value: ReceiptChannel; label: string }[] = [
  { value: "email", label: "Email (SAE form)" },
  { value: "fax", label: "Fax" },
  { value: "phone", label: "Phone" },
  { value: "edc_push", label: "EDC push" },
  { value: "other", label: "Other" },
];
export const receiptChannelLabel = (v: ReceiptChannel | null | undefined) =>
  RECEIPT_CHANNELS.find((c) => c.value === v)?.label ?? null;

// --- Obligations, submissions, compliance ------------------------------------------------

export type ObligationStatus =
  | "not_required"
  | "acknowledged"
  | "submitted"
  | "superseded_by_follow_up"
  | "overdue"
  | "due_soon"
  | "pending";
export type ObligationKind = "initial" | "follow_up" | "nullification";
export type SubmissionKind =
  | "initial_notification"
  | "initial_report"
  | "follow_up_report"
  | "amendment"
  | "nullification"
  | "notification_letter";
export type SubmissionFormat =
  | "cioms_i_pdf"
  | "medwatch_3500a_pdf"
  | "e2b_r3_json"
  | "portal_manual"
  | "email";
export type AckCode = "AA" | "AE" | "AR" | "CA" | "CR" | "manual_receipt";

export interface Obligation {
  expected_submission_id: string;
  reporting_rule_id: string;
  rule_name: string;
  citation: string | null;
  destination_id: string;
  destination_name: string;
  destination_kind: string;
  case_id: string;
  case_version_id: string;
  version_number: number;
  obligation_kind: ObligationKind;
  clock_start_date: string;
  due_date: string;
  due_soon_days: number;
  timeline_days: number;
  latest_version_number: number;
  waiver_id: string | null;
  waiver_reason: string | null;
  submission_id: string | null;
  sent_at: string | null;
  submitted_version_id: string | null;
  submission_kind: SubmissionKind | null;
  submission_format: SubmissionFormat | null;
  acknowledgement_id: string | null;
  ack_code: AckCode | null;
  acknowledged_at: string | null;
  case_nullified: boolean;
  on_time: boolean | null;
  days_remaining: number | null;
  status: ObligationStatus;
  // Present on the cross-case listing only.
  sender_case_id?: string;
  study_id?: string | null;
  protocol_number?: string | null;
  sponsor_org_id?: string | null;
}

export interface Acknowledgement {
  id: string;
  ack_code: AckCode;
  received_at: string;
  error_text: string | null;
  ack_message_id?: string | null;
}

export interface Submission {
  id: string;
  case_version_id: string;
  destination_id: string;
  kind: SubmissionKind;
  format: SubmissionFormat;
  sent_at: string;
  sent_by: string;
  payload_sha256: string | null;
  case_version_sha256: string;
  message_id: string | null;
  transmission_ref: string | null;
  note: string | null;
  destination_name: string;
  sent_by_name: string | null;
  version_number: number;
  acknowledgements: Acknowledgement[] | null;
}

export interface ComplianceRow {
  sponsor_org_id: string;
  study_id: string;
  protocol_number: string;
  destination_id: string;
  destination_name: string;
  closed: number | string;
  on_time_count: number | string;
  late_count: number | string;
  overdue_open: number | string;
  pending_open: number | string;
  waived: number | string;
  superseded: number | string;
  pct_on_time: number | string | null;
}

// --- DSUR --------------------------------------------------------------------------

export interface SarLineRow {
  case_id: string;
  sender_case_id: string;
  study_id: string;
  protocol_number: string;
  sponsor_org_id: string;
  product_id: string | null;
  product_name: string | null;
  first_received_date: string;
  awareness_date: string;
  subject_number: string | null;
  sex: string | null;
  age_value: number | null;
  age_unit: string | null;
  site_country: string | null;
  arm_label: string;
  suspect_drugs: string | null;
  pt_term: string;
  soc_term: string;
  onset_date: string | null;
  outcome: string | null;
  seriousness_rank: number;
  reporter_related: boolean | null;
  sponsor_related: boolean | null;
  expectedness: string;
  rsi_label: string | null;
  other_serious_reactions: string | null;
  /** E2F §3.7.2(l): the sponsor's position when it differs, and the anticipated concept when designated. */
  sponsor_comment: string | null;
  anticipated_label: string | null;
}

export interface SaeSummaryRow {
  sponsor_org_id: string;
  product_id: string | null;
  product_name: string | null;
  study_id: string;
  protocol_number: string;
  soc_code: string | null;
  soc_term: string;
  arm_label: string;
  event_count: number | string;
  case_count: number | string;
  reaction_count: number | string;
  fatal_or_life_threatening_count: number | string;
}

// --- Case detail ---------------------------------------------------------------------

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
export type EventOutcome =
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
export type Assessor = "reporter" | "sponsor";
export type Rechallenge = "recurred" | "did_not_recur" | "outcome_unknown" | "not_rechallenged";
export type Expectedness = "expected" | "unexpected";
export type ExpectednessBasis = "override" | "rsi_listed" | "rsi_not_listed" | "no_rsi_in_effect";
export type SignatureMeaning = "medical_review" | "approval";
export type WorkflowState = "data_entry" | "medical_review" | "closed";
export type VersionKind = "initial" | "follow_up" | "amendment";

export interface CasePatient {
  id: string;
  case_version_id: string;
  initials: string | null;
  subject_number: string | null;
  study_site_id: string | null;
  age_value: number | null;
  age_unit: AgeUnit | null;
  age_group: AgeGroup | null;
  sex: Sex | null;
  weight_kg: number | string | null;
  height_cm: number | string | null;
  medical_history_text: string | null;
  death_date: string | null;
  death_cause_text: string | null;
}

export interface CaseSource {
  id: string;
  case_version_id: string;
  seq: number;
  given_name: string | null;
  family_name: string | null;
  organization: string | null;
  country: string | null;
  qualification: Qualification | null;
  is_primary_for_regulatory: boolean;
  person_id: string | null;
}

/** An event row with its derived per-event verdict (v_case_event_reportability). */
export interface CaseEvent {
  id: string;
  case_version_id: string;
  seq: number;
  reported_term: string;
  dictionary_id: string | null;
  llt_code: string | null;
  llt_term: string | null;
  pt_code: string | null;
  pt_term: string | null;
  hlt_code: string | null;
  hlt_term: string | null;
  hlgt_code: string | null;
  hlgt_term: string | null;
  soc_code: string | null;
  soc_term: string | null;
  serious_death: boolean;
  serious_life_threatening: boolean;
  serious_hospitalization: boolean;
  serious_disabling: boolean;
  serious_congenital_anomaly: boolean;
  serious_other_medically_important: boolean;
  onset_date: string | null;
  end_date: string | null;
  outcome: EventOutcome;
  medically_confirmed: boolean | null;
  occur_country: string | null;
  serious: boolean;
  fatal_or_life_threatening: boolean;
  expectedness: Expectedness | null;
  expectedness_basis: ExpectednessBasis | null;
  rsi_label: string | null;
  reporter_assessed: boolean;
  sponsor_assessed: boolean;
  reporter_related: boolean | null;
  sponsor_related: boolean | null;
  related_either: boolean | null;
  causality_disagreement: boolean;
  anticipated: boolean;
  anticipated_basis: "prespecified" | "added_during_trial" | null;
  anticipated_event_id: string | null;
  anticipated_label: string | null;
  anticipated_plan_reference: string | null;
  anticipated_candidate: boolean;
  designation_id: string | null;
  designation_rationale: string | null;
}

export interface CaseDrug {
  id: string;
  case_version_id: string;
  seq: number;
  role: DrugRole;
  product_id: string | null;
  name_as_reported: string;
  is_blinded: boolean;
  lot_number: string | null;
  indication_pt_code: string | null;
  indication_pt_term: string | null;
  dose_text: string | null;
  dose_value: number | string | null;
  dose_unit: string | null;
  route: string | null;
  start_date: string | null;
  end_date: string | null;
  action_taken: ActionTaken | null;
  product_name: string | null;
}

export interface CaseAssessment {
  id: string;
  case_version_id: string;
  case_drug_id: string;
  case_event_id: string;
  assessor: Assessor;
  reasonable_possibility: boolean;
  causality_method: string | null;
  causality_result: string | null;
  rechallenge: Rechallenge | null;
  expectedness_override: Expectedness | null;
  expectedness_rationale: string | null;
  rsi_version_id: string | null;
  drug_seq: number;
  event_seq: number;
}

export interface CaseTest {
  id: string;
  case_version_id: string;
  seq: number;
  test_date: string | null;
  test_name: string;
  result_text: string | null;
  unit: string | null;
  comments: string | null;
}

export interface CaseNarrative {
  id: string;
  case_version_id: string;
  narrative: string | null;
  reporter_comments: string | null;
  sender_diagnosis_pt_code: string | null;
  sender_diagnosis_pt_term: string | null;
  sender_comments: string | null;
}

export interface CaseSignature {
  id: string;
  case_version_id: string;
  signer_person_id: string;
  meaning: SignatureMeaning;
  signed_sha256: string;
  signed_at: string;
  reauth_method: string;
  reauth_at: string | null;
  signer_name: string | null;
  hash_matches: boolean;
}

export interface CaseTransition {
  id: string;
  case_id: string;
  case_version_id: string;
  to_state: WorkflowState;
  transitioned_by: string;
  transitioned_at: string;
  note: string | null;
  by_name: string | null;
}

export interface RuleMatch {
  case_version_id: string;
  case_id: string;
  version_number: number;
  reporting_rule_id: string;
  destination_id: string;
  obligation_kind: ObligationKind;
  timeline_days: number;
  clock_start_date: string;
  rule_name: string;
  citation: string | null;
  destination_name: string;
  /** Set when the rule would apply but the sponsor's designation held it back. */
  excluded_reason: "anticipated" | null;
  anticipated_labels: string | null;
}

export interface CaseVersion {
  id: string;
  case_id: string;
  version_number: number;
  kind: VersionKind;
  info_received_date: string;
  awareness_date: string;
  awareness_rationale: string | null;
  received_at: string | null;
  dictionary_id: string;
  created_by: string;
  created_at: string;
  dictionary_version: string | null;
  is_demo_subset: boolean | null;
  minimum_criteria_met: boolean;
  missing: string[];
  expedited_class: ExpeditedClass;
  reportability_reason: string;
  any_serious: boolean;
  any_susar: boolean;
  causality_assessed: boolean;
  any_anticipated: boolean;
  all_susar_anticipated: boolean;
  any_causality_disagreement: boolean;
  is_locked: boolean;
  sha256: string;
  created_by_name: string | null;
  patient: CasePatient | null;
  sources: CaseSource[];
  events: CaseEvent[];
  drugs: CaseDrug[];
  assessments: CaseAssessment[];
  tests: CaseTest[];
  narrative: CaseNarrative | null;
  signatures: CaseSignature[];
  transitions: CaseTransition[];
  rule_matches: RuleMatch[];
}

export interface CaseUnblinding {
  id: string;
  arm_label: string;
  arm_role: "imp" | "comparator" | "placebo" | "background";
  unblinded_at: string;
  reason: string;
  source_system: string | null;
  source_ref: string | null;
  by_name: string | null;
}

export interface CaseNullification {
  id: string;
  case_id: string;
  reason: string;
  nullified_by: string;
  nullified_at: string;
  by_name: string | null;
}

export type AttachmentKind = "source_document" | "correspondence" | "submission_payload";

export interface CaseAttachment {
  id: string;
  case_id: string;
  case_version_id: string | null;
  kind: AttachmentKind;
  sha256: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  source_system: string | null;
  source_ref: string | null;
  created_at: string;
  uploaded_by_name: string | null;
}

export interface Waiver {
  id: string;
  expected_submission_id: string;
  waived_by: string;
  reason: string;
  waived_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  by_name: string | null;
}

export interface CaseDetail {
  id: string;
  worldwide_unique_id: string;
  sender_case_id: string;
  report_type: string;
  study_id: string | null;
  product_id: string | null;
  first_received_date: string;
  received_via: ReceiptChannel | null;
  received_ref: string | null;
  source_system: string | null;
  source_ref: string | null;
  intake_payload: unknown;
  intake_payload_sha256: string | null;
  replaces_case_id: string | null;
  created_by: string | null;
  created_at: string;
  state: CaseState;
  expedited_class: ExpeditedClass;
  reportability_reason: string;
  causality_assessed: boolean;
  minimum_criteria_met: boolean;
  is_unblinded: boolean;
  is_nullified: boolean;
  latest_version_id: string;
  latest_version_number: number;
  open_obligations: number | string;
  overdue_obligations: number | string;
  next_due_date: string | null;
  days_remaining: number | null;
  protocol_number: string | null;
  product_name: string | null;
  sponsor_org_id: string | null;
  is_blinded: boolean | null;
  any_anticipated: boolean;
  any_causality_disagreement: boolean;
  study_title: string | null;
  created_by_name: string | null;
  versions: CaseVersion[];
  obligations: Obligation[];
  submissions: Submission[];
  unblinding: CaseUnblinding | null;
  nullification: CaseNullification | null;
  attachments: CaseAttachment[];
  waivers: Waiver[];
}

// --- Audit and integrity --------------------------------------------------------------

export interface AuditEvent {
  id: number | string;
  occurred_at: string;
  actor_id: string | null;
  actor_label: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  prev_hash: string;
  hash: string;
  actor_name?: string | null;
}

export interface ChainStatus {
  ok: boolean;
  events: number;
  problems: Record<string, unknown>[];
}

export interface SignatureIntegrityRow {
  signature_id: string;
  case_version_id: string;
  case_id: string;
  signer_person_id: string;
  meaning: SignatureMeaning;
  signed_at: string;
  signed_sha256: string;
  current_sha256: string;
  hash_matches: boolean;
  sender_case_id: string;
}

// --- Reference data --------------------------------------------------------------------

export interface Dictionary {
  id: string;
  type: string;
  version: string;
  terms_count: number | string;
  is_demo_subset: boolean;
  source_sha256: string | null;
  created_at: string;
  is_default: boolean;
}

export interface DictionaryTerm {
  code: string;
  term: string;
  pt_code: string;
  pt_term: string;
  hlt_term: string | null;
  hlgt_term: string | null;
  soc_code: string | null;
  soc_term: string | null;
  is_current: boolean;
}

export type OrgKind = "sponsor" | "cro" | "site_org";

export interface Organization {
  id: string;
  name: string;
  kind: OrgKind;
  created_at: string;
}

export interface RsiListedTerm {
  pt_code: string;
  pt_term: string;
  listedness_note: string | null;
}

export interface RsiVersion {
  id: string;
  label: string;
  effective_from: string;
  effective_to: string | null;
  listed_terms: RsiListedTerm[];
}

export interface Product {
  id: string;
  sponsor_org_id: string;
  name: string;
  substance: string | null;
  kind: "investigational" | "marketed";
  created_at: string;
  sponsor_name: string | null;
  rsi_versions: RsiVersion[] | null;
}

export type AnticipatedRateUnit = "per_100_participant_years" | "proportion";

/** A serious adverse event the safety surveillance plan anticipates in the study population (one medical concept, several PTs). */
export interface AnticipatedEvent {
  id: string;
  study_id: string;
  label: string;
  prespecified: boolean;
  plan_reference: string | null;
  justification: string | null;
  predicted_rate: string | null;
  rate_unit: AnticipatedRateUnit | null;
  rate_basis: string | null;
  effective_from: string;
  effective_to: string | null;
  approved_by: string | null;
  created_at: string;
  protocol_number: string;
  sponsor_org_id: string;
  approved_by_name: string | null;
  terms: { pt_code: string; pt_term: string }[] | null;
}

export type DestinationKind = "regulator" | "ethics_committee" | "investigator_group" | "partner";

export interface Destination {
  id: string;
  sponsor_org_id: string | null;
  name: string;
  kind: DestinationKind;
  country: string | null;
  e2b_receiver_id: string | null;
  default_format: SubmissionFormat;
  created_at: string;
  sponsor_name: string | null;
}

export type CausalityBasis = "either" | "sponsor" | "reporter";

export interface ReportingRule {
  id: string;
  sponsor_org_id: string | null;
  study_id: string | null;
  product_id: string | null;
  destination_id: string;
  name: string;
  citation: string | null;
  report_types: string[] | null;
  version_kinds: string[] | null;
  obligation_kind: ObligationKind;
  serious: boolean | null;
  unexpected: boolean | null;
  related: boolean | null;
  fatal_or_life_threatening: boolean | null;
  causality_basis: CausalityBasis;
  excludes_anticipated: boolean;
  requires_prior_submission: boolean;
  timeline_days: number;
  due_soon_days: number;
  satisfying_kinds: SubmissionKind[];
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  destination_name: string;
  protocol_number: string | null;
  product_name: string | null;
  sponsor_name: string | null;
}

export interface PersonGrant {
  id: string;
  role: AccessRole;
  organization_id: string | null;
  study_id: string | null;
  granted_at: string;
  revoked_at: string | null;
}

export interface Person {
  id: string;
  given_name: string;
  family_name: string;
  email: string;
  credentials: string | null;
  created_at: string;
  grants: PersonGrant[] | null;
}

export interface SiteRow {
  study_site_id: string;
  study_id: string;
  site_number: string;
  status: string;
  site_id: string;
  name: string;
  city: string | null;
  country: string;
  protocol_number: string;
}

// --- Write bodies (mirror the OpenAPI request schemas) ---------------------------------------

export interface PatientBody {
  initials?: string | null;
  subject_number?: string | null;
  study_site_id?: string | null;
  age_value?: number | null;
  age_unit?: AgeUnit | null;
  age_group?: AgeGroup | null;
  sex?: Sex | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  medical_history_text?: string | null;
  death_date?: string | null;
  death_cause_text?: string | null;
}

export interface SourceBody {
  seq: number;
  given_name?: string | null;
  family_name?: string | null;
  organization?: string | null;
  country?: string | null;
  qualification?: Qualification | null;
  is_primary_for_regulatory?: boolean;
  person_id?: string | null;
}

export interface EventBody {
  seq: number;
  reported_term: string;
  llt_code?: string | null;
  serious_death?: boolean;
  serious_life_threatening?: boolean;
  serious_hospitalization?: boolean;
  serious_disabling?: boolean;
  serious_congenital_anomaly?: boolean;
  serious_other_medically_important?: boolean;
  onset_date?: string | null;
  end_date?: string | null;
  outcome?: EventOutcome;
  medically_confirmed?: boolean | null;
  occur_country?: string | null;
}

export interface DrugBody {
  seq: number;
  role: DrugRole;
  product_id?: string | null;
  name_as_reported: string;
  is_blinded?: boolean;
  lot_number?: string | null;
  indication_pt_code?: string | null;
  indication_pt_term?: string | null;
  dose_text?: string | null;
  dose_value?: number | null;
  dose_unit?: string | null;
  route?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  action_taken?: ActionTaken | null;
}

export interface TestBody {
  seq: number;
  test_date?: string | null;
  test_name: string;
  result_text?: string | null;
  unit?: string | null;
  comments?: string | null;
}

export interface NarrativeBody {
  narrative?: string | null;
  reporter_comments?: string | null;
  sender_diagnosis_pt_code?: string | null;
  sender_diagnosis_pt_term?: string | null;
  sender_comments?: string | null;
}

export interface AssessmentBody {
  drug_seq: number;
  event_seq: number;
  assessor: Assessor;
  reasonable_possibility: boolean;
  causality_method?: string | null;
  causality_result?: string | null;
  rechallenge?: Rechallenge | null;
  expectedness_override?: Expectedness | null;
  expectedness_rationale?: string | null;
  rsi_version_id?: string | null;
}

export interface SectionsBody {
  patient?: PatientBody;
  sources?: SourceBody[];
  events?: EventBody[];
  drugs?: DrugBody[];
  tests?: TestBody[];
  narrative?: NarrativeBody;
}

export interface CreateCaseBody extends SectionsBody {
  study_id?: string | null;
  product_id: string;
  report_type?: "spontaneous" | "study" | "other" | "unknown";
  first_received_date: string;
  info_received_date?: string;
  awareness_date?: string;
  awareness_rationale?: string | null;
  dictionary_id?: string;
  sender_case_id?: string;
  worldwide_unique_id?: string;
  received_via?: ReceiptChannel | null;
  received_ref?: string | null;
  assessments?: AssessmentBody[];
}

export interface DesignationBody {
  event_seq: number;
  anticipated: boolean;
  anticipated_event_id?: string | null;
  rationale?: string | null;
}

// --- Transport -------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`API ${status}: ${detail}`);
  }
}

/** Plain-language rendering of any error surfaced in the UI. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "You are not signed in. Refresh the page to sign in again.";
    if (e.status === 403) return "You don't have permission to do this.";
    if (e.status === 423) return `Locked by a signature: ${e.detail}`;
    if (e.status < 500 && e.detail) return e.detail;
    return "Something went wrong on the server. Please try again.";
  }
  if (e instanceof TypeError)
    return "Couldn't reach the server. Check your connection and try again.";
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong. Please try again.";
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.status === 401 && authMode === "oidc") {
    await beginLogin(); // session expired: round-trip through the IdP
  }
  if (res.ok) return;
  const text = await res.text();
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed?.error === "string") detail = parsed.error;
  } catch {
    // non-JSON body: keep the raw text as detail
  }
  throw new ApiError(res.status, detail);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token() ?? ""}`,
      ...(init?.headers ?? {}),
    },
  });
  await throwIfNotOk(res);
  return res.json() as Promise<T>;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const qs = (params: Record<string, string | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

/**
 * Bytes behind an authenticated GET (attachments, the E2B export). Browser
 * navigations cannot carry the bearer token, so anything that shows or saves
 * a file goes through here.
 */
export async function fetchBytes(path: string): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token() ?? ""}` } });
  await throwIfNotOk(res);
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  return { blob, fileName: /filename="([^"]*)"/.exec(disposition)?.[1] ?? "file" };
}

/**
 * Open an authenticated resource in a new tab. The tab opens synchronously in
 * the click (so popup blockers allow it), then navigates to an object URL of
 * the fetched bytes.
 */
export async function openInNewTab(path: string): Promise<void> {
  const win = window.open("", "_blank");
  try {
    const { blob } = await fetchBytes(path);
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}

/** Invalidate everything after a write: derived views change on every read anyway. */
function useInvalidatingMutation<TInput, TOut>(fn: (input: TInput) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() });
}

// --- Read hooks ------------------------------------------------------------------------

export const useMe = () =>
  useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/me"), staleTime: Infinity });

export const useStudies = () =>
  useQuery({ queryKey: ["studies"], queryFn: () => apiFetch<Study[]>("/studies") });

export const useStudy = (studyId: string | undefined) =>
  useQuery({
    queryKey: ["study", studyId],
    queryFn: () => apiFetch<StudyDetail>(`/studies/${studyId}`),
    enabled: !!studyId,
  });

const scoped = (studyId: string | undefined, path: string) =>
  studyId ? `/studies/${studyId}${path}` : path;

export const useQueue = (studyId: string | undefined, state?: string) =>
  useQuery({
    queryKey: ["queue", studyId ?? "all", state ?? ""],
    queryFn: () => apiFetch<QueueRow[]>(`${scoped(studyId, "/queue")}${qs({ state })}`),
  });

export const useExpectedSubmissions = (studyId: string | undefined, status?: string) =>
  useQuery({
    queryKey: ["expected-submissions", studyId ?? "all", status ?? ""],
    queryFn: () =>
      apiFetch<Obligation[]>(`${scoped(studyId, "/expected-submissions")}${qs({ status })}`),
  });

export const useCompliance = (studyId: string | undefined) =>
  useQuery({
    queryKey: ["compliance", studyId ?? "all"],
    queryFn: () => apiFetch<ComplianceRow[]>(scoped(studyId, "/compliance")),
  });

export const useSarLineListing = (studyId: string | undefined, from?: string, to?: string) =>
  useQuery({
    queryKey: ["dsur-sar", studyId ?? "all", from ?? "", to ?? ""],
    queryFn: () =>
      apiFetch<SarLineRow[]>(`${scoped(studyId, "/dsur/sar-line-listing")}${qs({ from, to })}`),
  });

export const useSaeSummary = (studyId: string | undefined) =>
  useQuery({
    queryKey: ["dsur-sae", studyId ?? "all"],
    queryFn: () => apiFetch<SaeSummaryRow[]>(scoped(studyId, "/dsur/sae-summary")),
  });

export const useCase = (caseId: string | undefined) =>
  useQuery({
    queryKey: ["case", caseId],
    queryFn: () => apiFetch<CaseDetail>(`/cases/${caseId}`),
    enabled: !!caseId,
  });

export const useCaseAudit = (caseId: string | undefined) =>
  useQuery({
    queryKey: ["case-audit", caseId],
    queryFn: () => apiFetch<AuditEvent[]>(`/cases/${caseId}/audit?limit=500`),
    enabled: !!caseId,
  });

export const useRuleMatches = (versionId: string | undefined) =>
  useQuery({
    queryKey: ["rule-matches", versionId],
    queryFn: () => apiFetch<RuleMatch[]>(`/case-versions/${versionId}/rule-matches`),
    enabled: !!versionId,
  });

export const useAuditEvents = (filter?: {
  entityType?: string;
  entityId?: string;
  limit?: number;
}) =>
  useQuery({
    queryKey: ["audit-events", filter],
    queryFn: () =>
      apiFetch<AuditEvent[]>(
        `/audit-events${qs({
          entity_type: filter?.entityType,
          entity_id: filter?.entityId,
          limit: filter?.limit ? String(filter.limit) : undefined,
        })}`,
      ),
  });

export const useChainStatus = () =>
  useQuery({
    queryKey: ["chain"],
    queryFn: () => apiFetch<ChainStatus>("/audit-chain/verify"),
    refetchInterval: 60_000,
  });

export const useSignatureIntegrity = () =>
  useQuery({
    queryKey: ["signature-integrity"],
    queryFn: () => apiFetch<SignatureIntegrityRow[]>("/signature-integrity"),
  });

export const useDictionaries = () =>
  useQuery({
    queryKey: ["dictionaries"],
    queryFn: () => apiFetch<Dictionary[]>("/dictionaries"),
    staleTime: 5 * 60_000,
  });

export const useTermSearch = (dictionaryId: string | undefined, q: string) =>
  useQuery({
    queryKey: ["terms", dictionaryId, q],
    queryFn: () =>
      apiFetch<DictionaryTerm[]>(`/dictionaries/${dictionaryId}/terms${qs({ q, limit: "20" })}`),
    enabled: !!dictionaryId && q.trim().length >= 2,
    staleTime: 60_000,
  });

export const useOrganizations = () =>
  useQuery({
    queryKey: ["organizations"],
    queryFn: () => apiFetch<Organization[]>("/organizations"),
  });

export const useProducts = () =>
  useQuery({ queryKey: ["products"], queryFn: () => apiFetch<Product[]>("/products") });

export const useDestinations = () =>
  useQuery({ queryKey: ["destinations"], queryFn: () => apiFetch<Destination[]>("/destinations") });

export const useReportingRules = () =>
  useQuery({
    queryKey: ["reporting-rules"],
    queryFn: () => apiFetch<ReportingRule[]>("/reporting-rules"),
  });

export const useAnticipatedEvents = (studyId?: string) =>
  useQuery({
    queryKey: ["anticipated-events", studyId ?? "all"],
    queryFn: () =>
      apiFetch<AnticipatedEvent[]>(
        studyId ? `/studies/${studyId}/anticipated-events` : "/anticipated-events",
      ),
  });

export const usePeople = () =>
  useQuery({ queryKey: ["people"], queryFn: () => apiFetch<Person[]>("/people") });

export const useSites = () =>
  useQuery({ queryKey: ["sites"], queryFn: () => apiFetch<SiteRow[]>("/sites") });

// --- Case write hooks --------------------------------------------------------------------

export const useCreateCase = () =>
  useInvalidatingMutation((body: CreateCaseBody) =>
    apiFetch<{
      case_id: string;
      case_version_id: string;
      sender_case_id: string;
      worldwide_unique_id: string;
    }>("/cases", jsonInit("POST", body)),
  );

export const useUpdateSections = () =>
  useInvalidatingMutation((input: { versionId: string; sections: SectionsBody }) =>
    apiFetch<{ ok: boolean }>(
      `/case-versions/${input.versionId}/sections`,
      jsonInit("PUT", input.sections),
    ),
  );

export const useUpdateAssessments = () =>
  useInvalidatingMutation((input: { versionId: string; assessments: AssessmentBody[] }) =>
    apiFetch<{ ok: boolean }>(
      `/case-versions/${input.versionId}/assessments`,
      jsonInit("PUT", { assessments: input.assessments }),
    ),
  );

export const useUpdateDesignations = () =>
  useInvalidatingMutation((input: { versionId: string; designations: DesignationBody[] }) =>
    apiFetch<{ ok: boolean }>(
      `/case-versions/${input.versionId}/designations`,
      jsonInit("PUT", { designations: input.designations }),
    ),
  );

export const useUpdateVersionHeader = () =>
  useInvalidatingMutation(
    (input: {
      versionId: string;
      info_received_date?: string;
      awareness_date?: string;
      awareness_rationale?: string | null;
    }) => {
      const { versionId, ...body } = input;
      return apiFetch<{ ok: boolean }>(`/case-versions/${versionId}`, jsonInit("PATCH", body));
    },
  );

export const useTransition = () =>
  useInvalidatingMutation((input: { versionId: string; to_state: WorkflowState; note?: string }) =>
    apiFetch<{ ok: boolean }>(
      `/case-versions/${input.versionId}/transition`,
      jsonInit("POST", { to_state: input.to_state, ...(input.note ? { note: input.note } : {}) }),
    ),
  );

/**
 * Part 11 e-signature: the request carries fresh proof of identity (§11.200),
 * obtained here (IdP popup in oidc mode; the restated dev token otherwise).
 */
export const useSign = () =>
  useInvalidatingMutation(async (input: { versionId: string; meaning: SignatureMeaning }) => {
    const reauthToken = await getReauthToken();
    return apiFetch<{ signature_id: string; signed_sha256: string }>(
      `/case-versions/${input.versionId}/sign`,
      jsonInit("POST", { meaning: input.meaning, reauth_token: reauthToken }),
    );
  });

export const useOpenVersion = () =>
  useInvalidatingMutation(
    (input: {
      caseId: string;
      kind: "follow_up" | "amendment";
      info_received_date: string;
      awareness_date?: string;
      awareness_rationale?: string | null;
    }) => {
      const { caseId, ...body } = input;
      return apiFetch<{ case_version_id: string; version_number: number }>(
        `/cases/${caseId}/versions`,
        jsonInit("POST", body),
      );
    },
  );

export const useNullify = () =>
  useInvalidatingMutation((input: { caseId: string; reason: string }) =>
    apiFetch<{ ok: boolean }>(
      `/cases/${input.caseId}/nullification`,
      jsonInit("POST", { reason: input.reason }),
    ),
  );

export const useUnblind = () =>
  useInvalidatingMutation(
    (input: {
      caseId: string;
      arm_label: string;
      arm_role: CaseUnblinding["arm_role"];
      reason: string;
      source_system?: string | null;
      source_ref?: string | null;
    }) => {
      const { caseId, ...body } = input;
      return apiFetch<{ ok: boolean }>(`/cases/${caseId}/unblinding`, jsonInit("POST", body));
    },
  );

export const useUploadAttachment = () =>
  useInvalidatingMutation(
    (input: { caseId: string; file: File; kind?: AttachmentKind; versionId?: string }) => {
      const form = new FormData();
      form.set("file", input.file);
      if (input.kind) form.set("kind", input.kind);
      if (input.versionId) form.set("case_version_id", input.versionId);
      return apiFetch<{ id: string; sha256: string; size_bytes: number }>(
        `/cases/${input.caseId}/attachments`,
        { method: "POST", body: form },
      );
    },
  );

export const useRecordSubmission = () =>
  useInvalidatingMutation(
    (input: {
      versionId: string;
      destination_id: string;
      kind: SubmissionKind;
      format: SubmissionFormat;
      payload_attachment_id?: string | null;
      message_id?: string | null;
      note?: string | null;
    }) => {
      const { versionId, ...body } = input;
      return apiFetch<{ id: string; payload_sha256: string | null }>(
        `/case-versions/${versionId}/submissions`,
        jsonInit("POST", body),
      );
    },
  );

export const useRecordAcknowledgement = () =>
  useInvalidatingMutation(
    (input: {
      submissionId: string;
      ack_code: AckCode;
      ack_message_id?: string | null;
      error_text?: string | null;
    }) => {
      const { submissionId, ...body } = input;
      return apiFetch<{ id: string }>(
        `/submissions/${submissionId}/acknowledgement`,
        jsonInit("POST", body),
      );
    },
  );

export const useWaive = () =>
  useInvalidatingMutation((input: { expectedSubmissionId: string; reason: string }) =>
    apiFetch<{ id: string }>(
      `/expected-submissions/${input.expectedSubmissionId}/waiver`,
      jsonInit("POST", { reason: input.reason }),
    ),
  );

export const useRevokeWaiver = () =>
  useInvalidatingMutation(
    (input: { expectedSubmissionId: string; waiverId: string; reason: string }) =>
      apiFetch<{ ok: boolean }>(
        `/expected-submissions/${input.expectedSubmissionId}/waiver/revoke`,
        jsonInit("POST", { waiver_id: input.waiverId, reason: input.reason }),
      ),
  );

// --- Administration hooks ------------------------------------------------------------------

export const useCreateStudy = () =>
  useInvalidatingMutation(
    (body: {
      protocol_number: string;
      title: string;
      phase?: string | null;
      status?: StudyStatus;
      sponsor_org_id: string;
      ind_number?: string | null;
      eu_ct_number?: string | null;
      is_blinded?: boolean;
      study_type?: "clinical_trial" | "individual_patient_use" | "other_study";
      product_ids?: string[];
    }) => apiFetch<{ id: string }>("/studies", jsonInit("POST", body)),
  );

export const useUpdateStudy = () =>
  useInvalidatingMutation((input: { studyId: string; status: StudyStatus }) =>
    apiFetch<{ ok: boolean }>(
      `/studies/${input.studyId}`,
      jsonInit("PATCH", { status: input.status }),
    ),
  );

export const useCreateOrganization = () =>
  useInvalidatingMutation((body: { name: string; kind: OrgKind }) =>
    apiFetch<Organization>("/organizations", jsonInit("POST", body)),
  );

export const useCreateProduct = () =>
  useInvalidatingMutation(
    (body: {
      sponsor_org_id: string;
      name: string;
      substance?: string | null;
      kind?: "investigational" | "marketed";
    }) => apiFetch<Product>("/products", jsonInit("POST", body)),
  );

export const useAddRsiVersion = () =>
  useInvalidatingMutation(
    (input: {
      productId: string;
      label: string;
      effective_from: string;
      dictionary_id: string;
      listed_terms: { pt_code: string; pt_term: string; listedness_note?: string | null }[];
      end_previous?: boolean;
    }) => {
      const { productId, ...body } = input;
      return apiFetch<RsiVersion>(`/products/${productId}/rsi-versions`, jsonInit("POST", body));
    },
  );

export const useEndRsiVersion = () =>
  useInvalidatingMutation((input: { rsiVersionId: string; effective_to: string }) =>
    apiFetch<{ ok: boolean }>(
      `/rsi-versions/${input.rsiVersionId}/end`,
      jsonInit("POST", { effective_to: input.effective_to }),
    ),
  );

export interface CreateAnticipatedEventBody {
  study_id: string;
  label: string;
  prespecified?: boolean;
  plan_reference?: string | null;
  justification?: string | null;
  predicted_rate?: number | null;
  rate_unit?: AnticipatedRateUnit | null;
  rate_basis?: string | null;
  effective_from: string;
  dictionary_id: string;
  terms: { pt_code: string; pt_term: string }[];
}

export const useCreateAnticipatedEvent = () =>
  useInvalidatingMutation((body: CreateAnticipatedEventBody) =>
    apiFetch<AnticipatedEvent>("/anticipated-events", jsonInit("POST", body)),
  );

export const useEndAnticipatedEvent = () =>
  useInvalidatingMutation((input: { anticipatedEventId: string; effective_to: string }) =>
    apiFetch<{ ok: boolean }>(
      `/anticipated-events/${input.anticipatedEventId}/end`,
      jsonInit("POST", { effective_to: input.effective_to }),
    ),
  );

export const useCreateDestination = () =>
  useInvalidatingMutation(
    (body: {
      sponsor_org_id?: string | null;
      name: string;
      kind: DestinationKind;
      country?: string | null;
      e2b_receiver_id?: string | null;
      default_format?: SubmissionFormat;
    }) => apiFetch<Destination>("/destinations", jsonInit("POST", body)),
  );

export interface CreateRuleBody {
  sponsor_org_id?: string | null;
  study_id?: string | null;
  product_id?: string | null;
  destination_id: string;
  name: string;
  citation?: string | null;
  report_types?: string[] | null;
  version_kinds?: string[] | null;
  obligation_kind?: ObligationKind;
  serious?: boolean | null;
  unexpected?: boolean | null;
  related?: boolean | null;
  fatal_or_life_threatening?: boolean | null;
  causality_basis?: CausalityBasis;
  excludes_anticipated?: boolean;
  requires_prior_submission?: boolean;
  timeline_days: number;
  due_soon_days?: number;
  satisfying_kinds: SubmissionKind[];
  effective_from: string;
  effective_to?: string | null;
}

export const useCreateRule = () =>
  useInvalidatingMutation((body: CreateRuleBody) =>
    apiFetch<ReportingRule>("/reporting-rules", jsonInit("POST", body)),
  );

export const useEndRule = () =>
  useInvalidatingMutation((input: { ruleId: string; effective_to: string }) =>
    apiFetch<{ ok: boolean }>(
      `/reporting-rules/${input.ruleId}/end`,
      jsonInit("POST", { effective_to: input.effective_to }),
    ),
  );

export const useCreatePerson = () =>
  useInvalidatingMutation(
    (body: {
      given_name: string;
      family_name: string;
      email: string;
      credentials?: string | null;
    }) => apiFetch<Person>("/people", jsonInit("POST", body)),
  );

export const useGrantAccess = () =>
  useInvalidatingMutation(
    (body: {
      person_id: string;
      role: AccessRole;
      organization_id?: string | null;
      study_id?: string | null;
    }) => apiFetch<PersonGrant>("/access-grants", jsonInit("POST", body)),
  );

export const useRevokeGrant = () =>
  useInvalidatingMutation((input: { grantId: string }) =>
    apiFetch<{ ok: boolean }>(`/access-grants/${input.grantId}/revoke`, { method: "POST" }),
  );

export const useCreateSite = () =>
  useInvalidatingMutation(
    (body: {
      organization_id: string;
      name: string;
      city?: string | null;
      country: string;
      study_id?: string;
      site_number?: string;
    }) => apiFetch<SiteRow>("/sites", jsonInit("POST", body)),
  );

export const useImportDictionary = () =>
  useInvalidatingMutation((body: { version: string; dir: string }) =>
    apiFetch<Record<string, unknown>>("/dictionaries/import", jsonInit("POST", body)),
  );

export const useResync = () =>
  useInvalidatingMutation(() => apiFetch<{ synced: number }>("/resync", { method: "POST" }));
