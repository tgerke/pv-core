CREATE TYPE "public"."access_role" AS ENUM('admin', 'case_processor', 'medical_reviewer', 'read_only', 'ingest');--> statement-breakpoint
CREATE TYPE "public"."action_taken" AS ENUM('drug_withdrawn', 'dose_reduced', 'dose_increased', 'dose_not_changed', 'unknown', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."age_group" AS ENUM('foetus', 'neonate', 'infant', 'child', 'adolescent', 'adult', 'elderly');--> statement-breakpoint
CREATE TYPE "public"."age_unit" AS ENUM('years', 'months', 'weeks', 'days', 'hours');--> statement-breakpoint
CREATE TYPE "public"."assessor_kind" AS ENUM('reporter', 'sponsor');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('source_document', 'correspondence', 'submission_payload');--> statement-breakpoint
CREATE TYPE "public"."causality_basis" AS ENUM('either', 'sponsor', 'reporter');--> statement-breakpoint
CREATE TYPE "public"."destination_kind" AS ENUM('regulator', 'ethics_committee', 'investigator_group', 'partner');--> statement-breakpoint
CREATE TYPE "public"."dictionary_type" AS ENUM('MedDRA', 'WHODrug');--> statement-breakpoint
CREATE TYPE "public"."drug_role" AS ENUM('suspect', 'concomitant', 'interacting', 'not_administered');--> statement-breakpoint
CREATE TYPE "public"."event_outcome" AS ENUM('recovered', 'recovering', 'not_recovered', 'recovered_with_sequelae', 'fatal', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."expectedness" AS ENUM('expected', 'unexpected');--> statement-breakpoint
CREATE TYPE "public"."obligation_kind" AS ENUM('initial', 'follow_up', 'nullification');--> statement-breakpoint
CREATE TYPE "public"."org_kind" AS ENUM('sponsor', 'cro', 'site_org');--> statement-breakpoint
CREATE TYPE "public"."product_kind" AS ENUM('investigational', 'marketed');--> statement-breakpoint
CREATE TYPE "public"."product_role" AS ENUM('imp', 'comparator', 'placebo', 'background');--> statement-breakpoint
CREATE TYPE "public"."reauth_method" AS ENUM('oidc_fresh_token', 'dev_token', 'seed_fixture');--> statement-breakpoint
CREATE TYPE "public"."rechallenge" AS ENUM('recurred', 'did_not_recur', 'outcome_unknown', 'not_rechallenged');--> statement-breakpoint
CREATE TYPE "public"."report_type" AS ENUM('spontaneous', 'study', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."reporter_qualification" AS ENUM('physician', 'pharmacist', 'other_health_professional', 'lawyer', 'consumer');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('male', 'female', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."signature_meaning" AS ENUM('medical_review', 'approval');--> statement-breakpoint
CREATE TYPE "public"."study_site_status" AS ENUM('pending', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."study_status" AS ENUM('planning', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."study_type" AS ENUM('clinical_trial', 'individual_patient_use', 'other_study');--> statement-breakpoint
CREATE TYPE "public"."submission_format" AS ENUM('cioms_i_pdf', 'medwatch_3500a_pdf', 'e2b_r3_json', 'portal_manual', 'email');--> statement-breakpoint
CREATE TYPE "public"."submission_kind" AS ENUM('initial_notification', 'initial_report', 'follow_up_report', 'amendment', 'nullification', 'notification_letter');--> statement-breakpoint
CREATE TYPE "public"."version_kind" AS ENUM('initial', 'follow_up', 'amendment');--> statement-breakpoint
CREATE TYPE "public"."workflow_state" AS ENUM('data_entry', 'medical_review', 'closed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "access_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "access_role" NOT NULL,
	"organization_id" uuid,
	"study_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" uuid,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"prev_hash" char(64) NOT NULL,
	"hash" char(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"case_drug_id" uuid NOT NULL,
	"case_event_id" uuid NOT NULL,
	"assessor" "assessor_kind" NOT NULL,
	"reasonable_possibility" boolean NOT NULL,
	"causality_method" text,
	"causality_result" text,
	"rechallenge" "rechallenge",
	"expectedness_override" "expectedness",
	"expectedness_rationale" text,
	"rsi_version_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"case_version_id" uuid,
	"kind" "attachment_kind" NOT NULL,
	"sha256" char(64) NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"source_system" text,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_drug" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" "drug_role" NOT NULL,
	"product_id" uuid,
	"name_as_reported" text NOT NULL,
	"is_blinded" boolean DEFAULT false NOT NULL,
	"lot_number" text,
	"indication_pt_code" text,
	"indication_pt_term" text,
	"dose_text" text,
	"dose_value" numeric,
	"dose_unit" text,
	"route" text,
	"start_date" date,
	"end_date" date,
	"action_taken" "action_taken"
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"reported_term" text NOT NULL,
	"dictionary_id" uuid,
	"llt_code" text,
	"llt_term" text,
	"pt_code" text,
	"pt_term" text,
	"hlt_code" text,
	"hlt_term" text,
	"hlgt_code" text,
	"hlgt_term" text,
	"soc_code" text,
	"soc_term" text,
	"serious_death" boolean DEFAULT false NOT NULL,
	"serious_life_threatening" boolean DEFAULT false NOT NULL,
	"serious_hospitalization" boolean DEFAULT false NOT NULL,
	"serious_disabling" boolean DEFAULT false NOT NULL,
	"serious_congenital_anomaly" boolean DEFAULT false NOT NULL,
	"serious_other_medically_important" boolean DEFAULT false NOT NULL,
	"onset_date" date,
	"end_date" date,
	"outcome" "event_outcome" DEFAULT 'unknown' NOT NULL,
	"medically_confirmed" boolean,
	"occur_country" char(2)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_narrative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"narrative" text,
	"reporter_comments" text,
	"sender_diagnosis_pt_code" text,
	"sender_diagnosis_pt_term" text,
	"sender_comments" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_nullification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"nullified_by" uuid NOT NULL,
	"nullified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_patient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"initials" text,
	"subject_number" text,
	"study_site_id" uuid,
	"age_value" integer,
	"age_unit" "age_unit",
	"age_group" "age_group",
	"sex" "sex",
	"weight_kg" numeric,
	"height_cm" numeric,
	"medical_history_text" text,
	"death_date" date,
	"death_cause_text" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"given_name" text,
	"family_name" text,
	"organization" text,
	"country" char(2),
	"qualification" "reporter_qualification",
	"is_primary_for_regulatory" boolean DEFAULT false NOT NULL,
	"person_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_test" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"test_date" date,
	"test_name" text NOT NULL,
	"result_text" text,
	"unit" text,
	"comments" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"case_version_id" uuid NOT NULL,
	"to_state" "workflow_state" NOT NULL,
	"transitioned_by" uuid NOT NULL,
	"transitioned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_unblinding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"arm_label" text NOT NULL,
	"arm_role" "product_role" NOT NULL,
	"unblinded_at" timestamp with time zone NOT NULL,
	"unblinded_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"source_system" text,
	"source_ref" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"kind" "version_kind" NOT NULL,
	"info_received_date" date NOT NULL,
	"awareness_date" date NOT NULL,
	"awareness_rationale" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dictionary_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dictionary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "dictionary_type" NOT NULL,
	"version" text NOT NULL,
	"terms_count" integer DEFAULT 0 NOT NULL,
	"is_demo_subset" boolean NOT NULL,
	"source_sha256" char(64),
	"loaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dictionary_term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dictionary_id" uuid NOT NULL,
	"code" text NOT NULL,
	"term" text NOT NULL,
	"normalized_term" text NOT NULL,
	"pt_code" text NOT NULL,
	"pt_term" text NOT NULL,
	"hlt_code" text,
	"hlt_term" text,
	"hlgt_code" text,
	"hlgt_term" text,
	"soc_code" text NOT NULL,
	"soc_term" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expected_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporting_rule_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"case_version_id" uuid NOT NULL,
	"obligation_kind" "obligation_kind" NOT NULL,
	"clock_start_date" date NOT NULL,
	"due_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expected_submission_waiver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expected_submission_id" uuid NOT NULL,
	"waived_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"waived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "org_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"given_name" text NOT NULL,
	"family_name" text NOT NULL,
	"email" text NOT NULL,
	"credentials" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsor_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"substance" text,
	"kind" "product_kind" DEFAULT 'investigational' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_rsi_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"label" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"document_sha256" char(64),
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worldwide_unique_id" text NOT NULL,
	"sender_case_id" text NOT NULL,
	"report_type" "report_type" DEFAULT 'study' NOT NULL,
	"study_id" uuid,
	"product_id" uuid NOT NULL,
	"first_received_date" date NOT NULL,
	"source_system" text,
	"source_ref" text,
	"intake_payload" jsonb,
	"intake_payload_sha256" char(64),
	"replaces_case_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_worldwide_unique_id_unique" UNIQUE("worldwide_unique_id"),
	CONSTRAINT "case_sender_case_id_unique" UNIQUE("sender_case_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reporting_destination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsor_org_id" uuid,
	"name" text NOT NULL,
	"kind" "destination_kind" NOT NULL,
	"country" char(2),
	"e2b_receiver_id" text,
	"default_format" "submission_format" DEFAULT 'cioms_i_pdf' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reporting_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsor_org_id" uuid,
	"study_id" uuid,
	"product_id" uuid,
	"destination_id" uuid NOT NULL,
	"name" text NOT NULL,
	"citation" text,
	"report_types" text[],
	"version_kinds" text[],
	"obligation_kind" "obligation_kind" DEFAULT 'initial' NOT NULL,
	"serious" boolean,
	"unexpected" boolean,
	"related" boolean,
	"fatal_or_life_threatening" boolean,
	"causality_basis" "causality_basis" DEFAULT 'either' NOT NULL,
	"requires_prior_submission" boolean DEFAULT false NOT NULL,
	"timeline_days" integer NOT NULL,
	"due_soon_days" integer DEFAULT 3 NOT NULL,
	"satisfying_kinds" text[] NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rsi_listed_term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rsi_version_id" uuid NOT NULL,
	"dictionary_id" uuid NOT NULL,
	"pt_code" text NOT NULL,
	"pt_term" text NOT NULL,
	"listedness_note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signature" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"signer_person_id" uuid NOT NULL,
	"meaning" "signature_meaning" NOT NULL,
	"signed_sha256" char(64) NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reauth_method" "reauth_method" NOT NULL,
	"reauth_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"country" char(2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "study" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol_number" text NOT NULL,
	"title" text NOT NULL,
	"phase" text,
	"status" "study_status" DEFAULT 'planning' NOT NULL,
	"sponsor_org_id" uuid NOT NULL,
	"ind_number" text,
	"eu_ct_number" text,
	"is_blinded" boolean DEFAULT false NOT NULL,
	"study_type" "study_type" DEFAULT 'clinical_trial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_protocol_number_unique" UNIQUE("protocol_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "study_product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"role" "product_role" DEFAULT 'imp' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "study_site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"site_number" text NOT NULL,
	"status" "study_site_status" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"kind" "submission_kind" NOT NULL,
	"format" "submission_format" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by" uuid NOT NULL,
	"payload_sha256" char(64),
	"case_version_sha256" char(64) NOT NULL,
	"message_id" text,
	"transmission_ref" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submission_acknowledgement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ack_code" text NOT NULL,
	"ack_message_id" text,
	"error_text" text,
	"recorded_by" uuid NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_study_id_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."study"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_assessment" ADD CONSTRAINT "case_assessment_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_assessment" ADD CONSTRAINT "case_assessment_case_drug_id_case_drug_id_fk" FOREIGN KEY ("case_drug_id") REFERENCES "public"."case_drug"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_assessment" ADD CONSTRAINT "case_assessment_case_event_id_case_event_id_fk" FOREIGN KEY ("case_event_id") REFERENCES "public"."case_event"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_assessment" ADD CONSTRAINT "case_assessment_rsi_version_id_product_rsi_version_id_fk" FOREIGN KEY ("rsi_version_id") REFERENCES "public"."product_rsi_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_attachment" ADD CONSTRAINT "case_attachment_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_attachment" ADD CONSTRAINT "case_attachment_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_attachment" ADD CONSTRAINT "case_attachment_uploaded_by_person_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_drug" ADD CONSTRAINT "case_drug_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_drug" ADD CONSTRAINT "case_drug_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_event" ADD CONSTRAINT "case_event_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_event" ADD CONSTRAINT "case_event_dictionary_id_dictionary_id_fk" FOREIGN KEY ("dictionary_id") REFERENCES "public"."dictionary"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_narrative" ADD CONSTRAINT "case_narrative_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_nullification" ADD CONSTRAINT "case_nullification_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_nullification" ADD CONSTRAINT "case_nullification_nullified_by_person_id_fk" FOREIGN KEY ("nullified_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_patient" ADD CONSTRAINT "case_patient_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_patient" ADD CONSTRAINT "case_patient_study_site_id_study_site_id_fk" FOREIGN KEY ("study_site_id") REFERENCES "public"."study_site"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_source" ADD CONSTRAINT "case_source_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_source" ADD CONSTRAINT "case_source_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_test" ADD CONSTRAINT "case_test_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_transition" ADD CONSTRAINT "case_transition_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_transition" ADD CONSTRAINT "case_transition_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_transition" ADD CONSTRAINT "case_transition_transitioned_by_person_id_fk" FOREIGN KEY ("transitioned_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_unblinding" ADD CONSTRAINT "case_unblinding_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_unblinding" ADD CONSTRAINT "case_unblinding_unblinded_by_person_id_fk" FOREIGN KEY ("unblinded_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_version" ADD CONSTRAINT "case_version_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_version" ADD CONSTRAINT "case_version_dictionary_id_dictionary_id_fk" FOREIGN KEY ("dictionary_id") REFERENCES "public"."dictionary"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_version" ADD CONSTRAINT "case_version_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dictionary" ADD CONSTRAINT "dictionary_loaded_by_person_id_fk" FOREIGN KEY ("loaded_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dictionary_term" ADD CONSTRAINT "dictionary_term_dictionary_id_dictionary_id_fk" FOREIGN KEY ("dictionary_id") REFERENCES "public"."dictionary"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expected_submission" ADD CONSTRAINT "expected_submission_reporting_rule_id_reporting_rule_id_fk" FOREIGN KEY ("reporting_rule_id") REFERENCES "public"."reporting_rule"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expected_submission" ADD CONSTRAINT "expected_submission_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expected_submission" ADD CONSTRAINT "expected_submission_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expected_submission_waiver" ADD CONSTRAINT "expected_submission_waiver_expected_submission_id_expected_submission_id_fk" FOREIGN KEY ("expected_submission_id") REFERENCES "public"."expected_submission"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expected_submission_waiver" ADD CONSTRAINT "expected_submission_waiver_waived_by_person_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expected_submission_waiver" ADD CONSTRAINT "expected_submission_waiver_revoked_by_person_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product" ADD CONSTRAINT "product_sponsor_org_id_organization_id_fk" FOREIGN KEY ("sponsor_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_rsi_version" ADD CONSTRAINT "product_rsi_version_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_rsi_version" ADD CONSTRAINT "product_rsi_version_approved_by_person_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case" ADD CONSTRAINT "case_study_id_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."study"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case" ADD CONSTRAINT "case_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case" ADD CONSTRAINT "case_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting_destination" ADD CONSTRAINT "reporting_destination_sponsor_org_id_organization_id_fk" FOREIGN KEY ("sponsor_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting_rule" ADD CONSTRAINT "reporting_rule_sponsor_org_id_organization_id_fk" FOREIGN KEY ("sponsor_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting_rule" ADD CONSTRAINT "reporting_rule_study_id_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."study"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting_rule" ADD CONSTRAINT "reporting_rule_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reporting_rule" ADD CONSTRAINT "reporting_rule_destination_id_reporting_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."reporting_destination"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rsi_listed_term" ADD CONSTRAINT "rsi_listed_term_rsi_version_id_product_rsi_version_id_fk" FOREIGN KEY ("rsi_version_id") REFERENCES "public"."product_rsi_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rsi_listed_term" ADD CONSTRAINT "rsi_listed_term_dictionary_id_dictionary_id_fk" FOREIGN KEY ("dictionary_id") REFERENCES "public"."dictionary"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signature" ADD CONSTRAINT "signature_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signature" ADD CONSTRAINT "signature_signer_person_id_person_id_fk" FOREIGN KEY ("signer_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site" ADD CONSTRAINT "site_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study" ADD CONSTRAINT "study_sponsor_org_id_organization_id_fk" FOREIGN KEY ("sponsor_org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_product" ADD CONSTRAINT "study_product_study_id_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."study"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_product" ADD CONSTRAINT "study_product_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_site" ADD CONSTRAINT "study_site_study_id_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."study"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_site" ADD CONSTRAINT "study_site_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission" ADD CONSTRAINT "submission_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission" ADD CONSTRAINT "submission_destination_id_reporting_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."reporting_destination"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission" ADD CONSTRAINT "submission_sent_by_person_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_acknowledgement" ADD CONSTRAINT "submission_acknowledgement_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_acknowledgement" ADD CONSTRAINT "submission_acknowledgement_recorded_by_person_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_grant_person_idx" ON "access_grant" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_event_entity_idx" ON "audit_event" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_assessment_unique" ON "case_assessment" USING btree ("case_drug_id","case_event_id","assessor");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_assessment_version_idx" ON "case_assessment" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_attachment_case_idx" ON "case_attachment" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_attachment_sha_idx" ON "case_attachment" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_drug_seq_unique" ON "case_drug" USING btree ("case_version_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_event_seq_unique" ON "case_event" USING btree ("case_version_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_event_pt_idx" ON "case_event" USING btree ("pt_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_narrative_version_unique" ON "case_narrative" USING btree ("case_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_nullification_case_unique" ON "case_nullification" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_patient_version_unique" ON "case_patient" USING btree ("case_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_source_seq_unique" ON "case_source" USING btree ("case_version_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_test_seq_unique" ON "case_test" USING btree ("case_version_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_transition_version_idx" ON "case_transition" USING btree ("case_version_id","transitioned_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_unblinding_case_unique" ON "case_unblinding" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_version_number_unique" ON "case_version" USING btree ("case_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dictionary_type_version_unique" ON "dictionary" USING btree ("type","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dictionary_term_code_unique" ON "dictionary_term" USING btree ("dictionary_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dictionary_term_exact_idx" ON "dictionary_term" USING btree ("dictionary_id","normalized_term");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dictionary_term_pt_idx" ON "dictionary_term" USING btree ("dictionary_id","pt_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expected_submission_rule_version_unique" ON "expected_submission" USING btree ("reporting_rule_id","case_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expected_submission_case_idx" ON "expected_submission" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expected_submission_due_idx" ON "expected_submission" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expected_submission_waiver_idx" ON "expected_submission_waiver" USING btree ("expected_submission_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_rsi_version_product_idx" ON "product_rsi_version" USING btree ("product_id","effective_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_study_idx" ON "case" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_product_idx" ON "case" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_replaces_idx" ON "case" USING btree ("replaces_case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reporting_rule_destination_idx" ON "reporting_rule" USING btree ("destination_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rsi_listed_term_unique" ON "rsi_listed_term" USING btree ("rsi_version_id","pt_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_version_idx" ON "signature" USING btree ("case_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "study_product_pair_idx" ON "study_product" USING btree ("study_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "study_site_pair_idx" ON "study_site" USING btree ("study_id","site_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "study_site_number_idx" ON "study_site" USING btree ("study_id","site_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submission_version_idx" ON "submission" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submission_destination_idx" ON "submission" USING btree ("destination_id","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submission_ack_submission_idx" ON "submission_acknowledgement" USING btree ("submission_id");