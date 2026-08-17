CREATE TYPE "public"."receipt_channel" AS ENUM('email', 'fax', 'phone', 'edc_push', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_event_designation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" uuid NOT NULL,
	"case_event_id" uuid NOT NULL,
	"anticipated" boolean NOT NULL,
	"anticipated_event_id" uuid,
	"rationale" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "study_anticipated_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"label" text NOT NULL,
	"prespecified" boolean DEFAULT true NOT NULL,
	"plan_reference" text,
	"justification" text,
	"predicted_rate" numeric,
	"rate_unit" text,
	"rate_basis" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "study_anticipated_event_term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anticipated_event_id" uuid NOT NULL,
	"dictionary_id" uuid NOT NULL,
	"pt_code" text NOT NULL,
	"pt_term" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case" ADD COLUMN "received_via" "receipt_channel";--> statement-breakpoint
ALTER TABLE "case" ADD COLUMN "received_ref" text;--> statement-breakpoint
ALTER TABLE "reporting_rule" ADD COLUMN "excludes_anticipated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_event_designation" ADD CONSTRAINT "case_event_designation_case_version_id_case_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_version"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_event_designation" ADD CONSTRAINT "case_event_designation_case_event_id_case_event_id_fk" FOREIGN KEY ("case_event_id") REFERENCES "public"."case_event"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_event_designation" ADD CONSTRAINT "case_event_designation_anticipated_event_id_study_anticipated_event_id_fk" FOREIGN KEY ("anticipated_event_id") REFERENCES "public"."study_anticipated_event"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_anticipated_event" ADD CONSTRAINT "study_anticipated_event_study_id_study_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."study"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_anticipated_event" ADD CONSTRAINT "study_anticipated_event_approved_by_person_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_anticipated_event_term" ADD CONSTRAINT "study_anticipated_event_term_anticipated_event_id_study_anticipated_event_id_fk" FOREIGN KEY ("anticipated_event_id") REFERENCES "public"."study_anticipated_event"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_anticipated_event_term" ADD CONSTRAINT "study_anticipated_event_term_dictionary_id_dictionary_id_fk" FOREIGN KEY ("dictionary_id") REFERENCES "public"."dictionary"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_event_designation_event_unique" ON "case_event_designation" USING btree ("case_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_event_designation_version_idx" ON "case_event_designation" USING btree ("case_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "study_anticipated_event_study_idx" ON "study_anticipated_event" USING btree ("study_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "study_anticipated_event_term_unique" ON "study_anticipated_event_term" USING btree ("anticipated_event_id","pt_code");--> statement-breakpoint

-- ===========================================================================
-- Hand-written from here (the DDL above is drizzle-kit's diff of schema.ts).
--
-- 1. Anticipated serious adverse events (FDA, Sponsor Responsibilities: Safety
--    Reporting Requirements and Safety Assessment for IND and BA/BE Studies,
--    Guidance for Industry, December 2025; clinical-standards-library
--    sources/FDA/fda-ind-safety-reporting-sponsor-responsibilities-2025.md,
--    accessed 2026-08-17). §III.C distinguishes "anticipated" (likely in the
--    study population independent of the drug) from "expected" (listed in the
--    IB); §IV.A.2.a says such SAEs do not warrant expedited IND safety
--    reporting as individual cases and are assessed in aggregate under 21 CFR
--    312.32(c)(1)(i)(C); §V.A puts a MedDRA-coded list of them, one cohesive
--    medical concept each, in the safety surveillance plan; §VI.A lets a
--    concept be added during the trial with clinical judgment and
--    documentation; §VI.C.1.b names the sources of predicted rates. The list
--    is data (study_anticipated_event + terms), the sponsor's per-event
--    judgment is data (case_event_designation), and the reporting effect is
--    a rule attribute (reporting_rule.excludes_anticipated), so a rule that
--    knows no such carve-out (Regulation (EU) 536/2014, ICH E2A) is untouched.
-- 2. Investigator/sponsor causality disagreement is derived, never stored:
--    both rows already coexist in case_assessment (E2B(R3) IG §G.k.9.i;
--    Reg. 536/2014 Annex III §2.1 ¶4; ICH E2F §3.7.2(l)).
-- 3. Intake provenance: case.received_via / received_ref.
-- ===========================================================================

-- A rate never exists without its unit and its basis; a concept is either
-- prespecified in the plan or justified when added during the trial (§V.A, §VI.A).
ALTER TABLE study_anticipated_event ADD CONSTRAINT study_anticipated_event_rate_check
  CHECK ((predicted_rate IS NULL) = (rate_unit IS NULL) AND (predicted_rate IS NULL OR rate_basis IS NOT NULL));
--> statement-breakpoint
ALTER TABLE study_anticipated_event ADD CONSTRAINT study_anticipated_event_rate_unit_check
  CHECK (rate_unit IS NULL OR rate_unit IN ('per_100_participant_years', 'proportion'));
--> statement-breakpoint
ALTER TABLE study_anticipated_event ADD CONSTRAINT study_anticipated_event_documentation_check
  CHECK ((prespecified AND plan_reference IS NOT NULL) OR (NOT prespecified AND justification IS NOT NULL));
--> statement-breakpoint
-- An anticipated designation always names the concept it rolls up to; a
-- "not anticipated" designation names none.
ALTER TABLE case_event_designation ADD CONSTRAINT case_event_designation_concept_check
  CHECK ((anticipated AND anticipated_event_id IS NOT NULL) OR (NOT anticipated AND anticipated_event_id IS NULL));
--> statement-breakpoint
-- The exclusion needs a per-event predicate to exclude from.
ALTER TABLE reporting_rule ADD CONSTRAINT reporting_rule_excludes_anticipated_check
  CHECK (NOT excludes_anticipated OR serious IS NOT NULL OR unexpected IS NOT NULL
         OR related IS NOT NULL OR fatal_or_life_threatening IS NOT NULL);
--> statement-breakpoint

-- Like an RSI version, a concept's one permitted mutation is its ending (ADR-0004).
CREATE OR REPLACE FUNCTION pv_anticipated_event_guard() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'study_anticipated_event rows are never deleted: end them with effective_to'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.id <> OLD.id OR NEW.study_id <> OLD.study_id OR NEW.label <> OLD.label
     OR NEW.prespecified <> OLD.prespecified
     OR NEW.plan_reference IS DISTINCT FROM OLD.plan_reference
     OR NEW.justification IS DISTINCT FROM OLD.justification
     OR NEW.predicted_rate IS DISTINCT FROM OLD.predicted_rate
     OR NEW.rate_unit IS DISTINCT FROM OLD.rate_unit
     OR NEW.rate_basis IS DISTINCT FROM OLD.rate_basis
     OR NEW.effective_from <> OLD.effective_from
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to) THEN
    RAISE EXCEPTION 'study_anticipated_event: only effective_to may be set, once'
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER study_anticipated_event_guard BEFORE UPDATE OR DELETE ON study_anticipated_event
  FOR EACH ROW EXECUTE FUNCTION pv_anticipated_event_guard();
--> statement-breakpoint
CREATE TRIGGER study_anticipated_event_term_immutable BEFORE UPDATE OR DELETE ON study_anticipated_event_term
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_mutation();
--> statement-breakpoint
REVOKE UPDATE, DELETE ON study_anticipated_event_term FROM pv_app;
--> statement-breakpoint

-- A designation names an event of its own version and a concept of the
-- case's study. The concept's effective window is checked by core at the time
-- of designation, not here, so a follow-up version cloned after the concept
-- ended still carries the designation the sponsor made.
CREATE OR REPLACE FUNCTION pv_designation_guard() RETURNS trigger AS $fn$
DECLARE
  v_case uuid;
BEGIN
  SELECT cv.case_id INTO v_case
  FROM case_event e JOIN case_version cv ON cv.id = e.case_version_id
  WHERE e.id = NEW.case_event_id AND e.case_version_id = NEW.case_version_id;
  IF v_case IS NULL THEN
    RAISE EXCEPTION 'case_event_designation: event % does not belong to version %', NEW.case_event_id, NEW.case_version_id
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.anticipated_event_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM study_anticipated_event ae JOIN "case" c ON c.study_id = ae.study_id
       WHERE ae.id = NEW.anticipated_event_id AND c.id = v_case) THEN
    RAISE EXCEPTION 'case_event_designation: concept % is not on this study''s anticipated-event list', NEW.anticipated_event_id
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER case_event_designation_guard BEFORE INSERT OR UPDATE ON case_event_designation
  FOR EACH ROW EXECUTE FUNCTION pv_designation_guard();
--> statement-breakpoint
CREATE TRIGGER case_event_designation_lock BEFORE INSERT OR UPDATE OR DELETE ON case_event_designation
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_locked_version_mutation();
--> statement-breakpoint
CREATE TRIGGER study_anticipated_event_audit AFTER INSERT OR UPDATE ON study_anticipated_event
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER study_anticipated_event_term_audit AFTER INSERT ON study_anticipated_event_term
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_event_designation_audit AFTER INSERT OR UPDATE OR DELETE ON case_event_designation
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint

-- Version hash (ADR-0006, §11.70): designations join the canonical document
-- only when the version has any, so every version hashed before this
-- migration keeps its exact hash and every signature its binding. A signed
-- version cannot gain a designation (lock trigger), so a hash never changes
-- under a signature. No hashed child carries a timestamptz (jsonb renders it
-- in the session zone; see migration 0003). STABLE is restated because
-- CREATE OR REPLACE resets unspecified attributes.
CREATE OR REPLACE FUNCTION pv_case_version_sha256(p_version uuid) RETURNS char(64) AS $fn$
DECLARE
  v_doc jsonb;
BEGIN
  SELECT jsonb_build_object(
    'version', (SELECT jsonb_build_object(
        'id', cv.id, 'case_id', cv.case_id, 'version_number', cv.version_number,
        'kind', cv.kind, 'info_received_date', cv.info_received_date,
        'awareness_date', cv.awareness_date, 'awareness_rationale', cv.awareness_rationale,
        'dictionary_id', cv.dictionary_id)
      FROM case_version cv WHERE cv.id = p_version),
    'patient', (SELECT to_jsonb(p) - 'id' FROM case_patient p WHERE p.case_version_id = p_version),
    'sources', (SELECT coalesce(jsonb_agg(to_jsonb(s) - 'id' ORDER BY s.seq), '[]'::jsonb)
      FROM case_source s WHERE s.case_version_id = p_version),
    'events', (SELECT coalesce(jsonb_agg(to_jsonb(e) - 'id' ORDER BY e.seq), '[]'::jsonb)
      FROM case_event e WHERE e.case_version_id = p_version),
    'drugs', (SELECT coalesce(jsonb_agg(to_jsonb(d) - 'id' ORDER BY d.seq), '[]'::jsonb)
      FROM case_drug d WHERE d.case_version_id = p_version),
    'assessments', (SELECT coalesce(jsonb_agg(
        (to_jsonb(a) - 'id' - 'case_drug_id' - 'case_event_id')
          || jsonb_build_object('drug_seq', d.seq, 'event_seq', e.seq)
        ORDER BY d.seq, e.seq, a.assessor), '[]'::jsonb)
      FROM case_assessment a
      JOIN case_drug d ON d.id = a.case_drug_id
      JOIN case_event e ON e.id = a.case_event_id
      WHERE a.case_version_id = p_version),
    'tests', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'id' ORDER BY t.seq), '[]'::jsonb)
      FROM case_test t WHERE t.case_version_id = p_version),
    'narrative', (SELECT to_jsonb(n) - 'id' FROM case_narrative n WHERE n.case_version_id = p_version)
  ) INTO v_doc;
  IF EXISTS (SELECT 1 FROM case_event_designation g WHERE g.case_version_id = p_version) THEN
    v_doc := v_doc || jsonb_build_object('designations', (
      SELECT jsonb_agg(
        (to_jsonb(g) - 'id' - 'case_version_id' - 'case_event_id')
          || jsonb_build_object('event_seq', e.seq)
        ORDER BY e.seq)
      FROM case_event_designation g
      JOIN case_event e ON e.id = g.case_event_id
      WHERE g.case_version_id = p_version));
  END IF;
  RETURN encode(digest(v_doc::text, 'sha256'), 'hex');
END
$fn$ LANGUAGE plpgsql STABLE;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Views. CREATE OR REPLACE keeps every existing column in place and appends.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_case_event_reportability AS
WITH ev AS (
  SELECT e.id AS case_event_id, e.case_version_id, cv.case_id, cv.version_number,
    c.product_id, c.study_id, e.seq, e.pt_code, e.pt_term, e.soc_code, e.soc_term, e.reported_term,
    e.onset_date, e.outcome,
    (e.serious_death OR e.serious_life_threatening OR e.serious_hospitalization
      OR e.serious_disabling OR e.serious_congenital_anomaly OR e.serious_other_medically_important) AS serious,
    (e.serious_death OR e.serious_life_threatening OR e.outcome = 'fatal') AS fatal_or_life_threatening,
    coalesce(e.onset_date, cv.awareness_date) AS rsi_reference_date,
    cv.awareness_date
  FROM case_event e
  JOIN case_version cv ON cv.id = e.case_version_id
  JOIN "case" c ON c.id = cv.case_id
),
rsi AS (
  SELECT DISTINCT ON (ev.case_event_id) ev.case_event_id, v.id AS rsi_version_id, v.label AS rsi_label
  FROM ev
  JOIN product_rsi_version v ON v.product_id = ev.product_id
    AND v.effective_from <= ev.rsi_reference_date
    AND (v.effective_to IS NULL OR v.effective_to >= ev.rsi_reference_date)
  ORDER BY ev.case_event_id, v.effective_from DESC
),
overrides AS (
  SELECT a.case_event_id,
    bool_or(a.expectedness_override = 'unexpected') AS any_unexpected,
    bool_or(a.expectedness_override = 'expected') AS any_expected
  FROM case_assessment a WHERE a.assessor = 'sponsor' AND a.expectedness_override IS NOT NULL
  GROUP BY a.case_event_id
),
causality AS (
  SELECT a.case_event_id,
    bool_or(a.assessor = 'reporter') AS reporter_assessed,
    bool_or(a.assessor = 'sponsor') AS sponsor_assessed,
    bool_or(a.assessor = 'reporter' AND a.reasonable_possibility) AS reporter_related_raw,
    bool_or(a.assessor = 'sponsor' AND a.reasonable_possibility) AS sponsor_related_raw
  FROM case_assessment a
  JOIN case_drug d ON d.id = a.case_drug_id AND d.role IN ('suspect', 'interacting')
  GROUP BY a.case_event_id
),
designation AS (
  SELECT g.case_event_id, g.anticipated, g.anticipated_event_id,
    ae.label AS anticipated_label, ae.plan_reference AS anticipated_plan_reference, ae.prespecified
  FROM case_event_designation g
  LEFT JOIN study_anticipated_event ae ON ae.id = g.anticipated_event_id
)
SELECT ev.case_event_id, ev.case_version_id, ev.case_id, ev.version_number, ev.product_id, ev.study_id,
  ev.seq, ev.reported_term, ev.pt_code, ev.pt_term, ev.soc_code, ev.soc_term, ev.onset_date, ev.outcome,
  ev.serious, ev.fatal_or_life_threatening,
  r.rsi_version_id, r.rsi_label,
  CASE
    WHEN o.any_unexpected THEN 'unexpected'
    WHEN o.any_expected THEN 'expected'
    WHEN r.rsi_version_id IS NULL THEN 'unexpected'
    WHEN EXISTS (SELECT 1 FROM rsi_listed_term lt WHERE lt.rsi_version_id = r.rsi_version_id AND lt.pt_code = ev.pt_code)
      THEN 'expected'
    ELSE 'unexpected'
  END::expectedness AS expectedness,
  CASE
    WHEN o.any_unexpected OR o.any_expected THEN 'override'
    WHEN r.rsi_version_id IS NULL THEN 'no_rsi_in_effect'
    WHEN EXISTS (SELECT 1 FROM rsi_listed_term lt WHERE lt.rsi_version_id = r.rsi_version_id AND lt.pt_code = ev.pt_code)
      THEN 'rsi_listed'
    ELSE 'rsi_not_listed'
  END AS expectedness_basis,
  coalesce(ca.reporter_assessed, false) AS reporter_assessed,
  coalesce(ca.sponsor_assessed, false) AS sponsor_assessed,
  CASE WHEN coalesce(ca.reporter_assessed, false) THEN ca.reporter_related_raw ELSE true END AS reporter_related,
  CASE WHEN coalesce(ca.sponsor_assessed, false) THEN ca.sponsor_related_raw ELSE true END AS sponsor_related,
  (CASE WHEN coalesce(ca.reporter_assessed, false) THEN ca.reporter_related_raw ELSE true END
     OR CASE WHEN coalesce(ca.sponsor_assessed, false) THEN ca.sponsor_related_raw ELSE true END) AS related_either,
  -- Appended in 0004. Disagreement compares the two recorded opinions, not
  -- the fail-safe defaults: an unassessed side is not a disagreement.
  coalesce(ca.reporter_assessed AND ca.sponsor_assessed
           AND ca.reporter_related_raw <> ca.sponsor_related_raw, false) AS causality_disagreement,
  coalesce(g.anticipated, false) AS anticipated,
  CASE WHEN g.anticipated AND g.prespecified THEN 'prespecified'
       WHEN g.anticipated THEN 'added_during_trial' END AS anticipated_basis,
  g.anticipated_event_id,
  g.anticipated_label,
  g.anticipated_plan_reference,
  -- A hint for the reviewer: an in-effect concept of the study lists this PT.
  -- Never a designation by itself.
  EXISTS (SELECT 1 FROM study_anticipated_event x
          JOIN study_anticipated_event_term t ON t.anticipated_event_id = x.id
          WHERE x.study_id = ev.study_id AND t.pt_code = ev.pt_code
            AND x.effective_from <= ev.awareness_date
            AND (x.effective_to IS NULL OR x.effective_to >= ev.awareness_date)) AS anticipated_candidate
FROM ev
LEFT JOIN rsi r ON r.case_event_id = ev.case_event_id
LEFT JOIN overrides o ON o.case_event_id = ev.case_event_id
LEFT JOIN causality ca ON ca.case_event_id = ev.case_event_id
LEFT JOIN designation g ON g.case_event_id = ev.case_event_id;
--> statement-breakpoint

CREATE OR REPLACE VIEW v_case_reportability AS
SELECT cv.id AS case_version_id, cv.case_id, cv.version_number, cv.kind AS version_kind,
  cv.awareness_date, cv.info_received_date, c.study_id, c.product_id, c.report_type,
  coalesce(st.sponsor_org_id, pr.sponsor_org_id) AS sponsor_org_id,
  mc.minimum_criteria_met,
  coalesce(bool_or(er.serious), false) AS any_serious,
  coalesce(bool_or(er.serious AND er.expectedness = 'unexpected'), false) AS any_serious_unexpected,
  coalesce(bool_or(er.serious AND er.expectedness = 'unexpected' AND er.related_either), false) AS any_susar,
  coalesce(bool_or(er.serious AND er.expectedness = 'unexpected' AND er.related_either
                    AND er.fatal_or_life_threatening), false) AS any_fatal_lt_susar,
  coalesce(bool_and(NOT er.serious OR er.sponsor_assessed), true) AS causality_assessed,
  CASE
    WHEN NOT mc.minimum_criteria_met THEN 'none'
    WHEN coalesce(bool_or(er.serious AND er.expectedness = 'unexpected' AND er.related_either
                    AND er.fatal_or_life_threatening), false) THEN '7d'
    WHEN coalesce(bool_or(er.serious AND er.expectedness = 'unexpected' AND er.related_either), false) THEN '15d'
    ELSE 'none'
  END AS expedited_class,
  CASE
    WHEN NOT mc.minimum_criteria_met THEN 'minimum criteria not met'
    WHEN NOT coalesce(bool_or(er.serious), false) THEN 'non-serious'
    WHEN NOT coalesce(bool_or(er.serious AND er.expectedness = 'unexpected'), false) THEN 'serious but expected'
    WHEN NOT coalesce(bool_or(er.serious AND er.expectedness = 'unexpected' AND er.related_either), false)
      THEN 'not related (reporter and sponsor)'
    WHEN coalesce(bool_or(er.serious AND er.expectedness = 'unexpected' AND er.related_either
                    AND er.fatal_or_life_threatening), false) THEN 'fatal/life-threatening SUSAR'
    ELSE 'SUSAR'
  END
  -- Appended in 0004: the class is authority-agnostic (a SUSAR is still a
  -- SUSAR for Regulation (EU) 536/2014); the reason says when every
  -- SUSAR-shaped event is anticipated in the study population, which is what
  -- an FDA rule with excludes_anticipated acts on.
  || CASE WHEN coalesce(bool_or(er.serious AND er.expectedness = 'unexpected' AND er.related_either), false)
            AND coalesce(bool_and(NOT (er.serious AND er.expectedness = 'unexpected' AND er.related_either)
                                  OR er.anticipated), true)
          THEN '; anticipated in the study population (aggregate review)' ELSE '' END AS reason,
  coalesce(bool_or(er.anticipated), false) AS any_anticipated,
  (coalesce(bool_or(er.serious AND er.expectedness = 'unexpected' AND er.related_either), false)
     AND coalesce(bool_and(NOT (er.serious AND er.expectedness = 'unexpected' AND er.related_either)
                           OR er.anticipated), true)) AS all_susar_anticipated,
  coalesce(bool_or(er.causality_disagreement), false) AS any_causality_disagreement
FROM case_version cv
JOIN "case" c ON c.id = cv.case_id
LEFT JOIN study st ON st.id = c.study_id
LEFT JOIN product pr ON pr.id = c.product_id
JOIN v_case_minimum_criteria mc ON mc.case_version_id = cv.id
LEFT JOIN v_case_event_reportability er ON er.case_version_id = cv.id
GROUP BY cv.id, cv.case_id, cv.version_number, cv.kind, cv.awareness_date, cv.info_received_date,
  c.study_id, c.product_id, c.report_type, st.sponsor_org_id, pr.sponsor_org_id, mc.minimum_criteria_met;
--> statement-breakpoint

-- Rule evaluation: v_rule_match's predicate, evaluated once with and once
-- without the anticipated exclusion, so "held back by the designation" is a
-- fact the API can show rather than an absence (ADR-0007: every clock and
-- every non-clock is explainable).
CREATE VIEW v_rule_evaluation AS
SELECT r.case_version_id, r.case_id, r.version_number, rr.id AS reporting_rule_id, rr.destination_id,
  rr.obligation_kind, rr.timeline_days, rr.name AS rule_name, rr.excludes_anticipated,
  CASE rr.obligation_kind WHEN 'nullification' THEN n.nullified_at::date ELSE r.awareness_date END AS clock_start_date,
  (
    (rr.serious IS NULL AND rr.unexpected IS NULL AND rr.related IS NULL AND rr.fatal_or_life_threatening IS NULL)
    OR EXISTS (
      SELECT 1 FROM v_case_event_reportability e
      WHERE e.case_version_id = r.case_version_id
        AND (rr.serious IS NULL OR e.serious = rr.serious)
        AND (rr.unexpected IS NULL OR (e.expectedness = 'unexpected') = rr.unexpected)
        AND (rr.fatal_or_life_threatening IS NULL OR e.fatal_or_life_threatening = rr.fatal_or_life_threatening)
        AND (rr.related IS NULL OR rr.related = CASE rr.causality_basis
              WHEN 'sponsor' THEN e.sponsor_related
              WHEN 'reporter' THEN e.reporter_related
              ELSE e.related_either END)
        AND (NOT rr.excludes_anticipated OR NOT e.anticipated)
    )
  ) AS matched,
  (
    (rr.serious IS NULL AND rr.unexpected IS NULL AND rr.related IS NULL AND rr.fatal_or_life_threatening IS NULL)
    OR EXISTS (
      SELECT 1 FROM v_case_event_reportability e
      WHERE e.case_version_id = r.case_version_id
        AND (rr.serious IS NULL OR e.serious = rr.serious)
        AND (rr.unexpected IS NULL OR (e.expectedness = 'unexpected') = rr.unexpected)
        AND (rr.fatal_or_life_threatening IS NULL OR e.fatal_or_life_threatening = rr.fatal_or_life_threatening)
        AND (rr.related IS NULL OR rr.related = CASE rr.causality_basis
              WHEN 'sponsor' THEN e.sponsor_related
              WHEN 'reporter' THEN e.reporter_related
              ELSE e.related_either END)
    )
  ) AS matched_ignoring_anticipated
FROM v_case_reportability r
JOIN reporting_rule rr
  ON (rr.sponsor_org_id IS NULL OR rr.sponsor_org_id = r.sponsor_org_id)
 AND (rr.study_id IS NULL OR rr.study_id = r.study_id)
 AND (rr.product_id IS NULL OR rr.product_id = r.product_id)
 AND (rr.report_types IS NULL OR r.report_type::text = ANY (rr.report_types))
 AND (rr.version_kinds IS NULL OR r.version_kind::text = ANY (rr.version_kinds))
 AND r.awareness_date >= rr.effective_from
 AND (rr.effective_to IS NULL OR r.awareness_date <= rr.effective_to)
 AND (NOT rr.requires_prior_submission OR EXISTS (
        SELECT 1 FROM submission s JOIN case_version pv ON pv.id = s.case_version_id
        WHERE pv.case_id = r.case_id
          AND (pv.version_number < r.version_number OR rr.obligation_kind = 'nullification')
          AND s.destination_id = rr.destination_id AND s.kind <> 'nullification'))
LEFT JOIN case_nullification n ON n.case_id = r.case_id
WHERE r.minimum_criteria_met
  AND (rr.obligation_kind <> 'nullification' OR n.id IS NOT NULL);
--> statement-breakpoint

-- Same columns as before; the anticipated exclusion is inside the predicate.
CREATE OR REPLACE VIEW v_rule_match AS
SELECT case_version_id, case_id, version_number, reporting_rule_id, destination_id,
  obligation_kind, timeline_days, clock_start_date
FROM v_rule_evaluation
WHERE matched;
--> statement-breakpoint

-- Rules that would apply to the version but for the sponsor's anticipated
-- designation(s). Explanatory; nothing materializes from it.
CREATE VIEW v_rule_anticipated_exclusion AS
SELECT ev.case_version_id, ev.case_id, ev.version_number, ev.reporting_rule_id, ev.destination_id,
  ev.obligation_kind, ev.timeline_days, ev.clock_start_date, ev.rule_name,
  (SELECT string_agg(DISTINCT e.anticipated_label, '; ')
     FROM v_case_event_reportability e
     WHERE e.case_version_id = ev.case_version_id AND e.anticipated) AS anticipated_labels
FROM v_rule_evaluation ev
WHERE ev.matched_ignoring_anticipated AND NOT ev.matched;
--> statement-breakpoint

CREATE OR REPLACE VIEW v_case_queue AS
WITH latest AS (
  SELECT DISTINCT ON (cv.case_id) cv.case_id, cv.id AS case_version_id, cv.version_number, cv.kind,
    cv.awareness_date, cv.info_received_date
  FROM case_version cv ORDER BY cv.case_id, cv.version_number DESC
),
lt AS (
  SELECT DISTINCT ON (t.case_version_id) t.case_version_id, t.to_state, t.transitioned_at
  FROM case_transition t ORDER BY t.case_version_id, t.transitioned_at DESC, t.id DESC
),
sig AS (
  SELECT DISTINCT ON (s.case_version_id) s.case_version_id, s.meaning, s.signed_at, s.signer_person_id
  FROM signature s ORDER BY s.case_version_id, s.signed_at DESC
),
obligations AS (
  SELECT es.case_id,
    count(*) FILTER (WHERE es.status IN ('pending', 'due_soon', 'overdue')) AS open_obligations,
    count(*) FILTER (WHERE es.status = 'overdue') AS overdue_obligations,
    min(es.due_date) FILTER (WHERE es.status IN ('pending', 'due_soon', 'overdue')) AS next_due_date
  FROM v_expected_submission_status es GROUP BY es.case_id
),
primary_event AS (
  SELECT DISTINCT ON (er.case_version_id) er.case_version_id, er.pt_term, er.soc_term
  FROM v_case_event_reportability er
  ORDER BY er.case_version_id, er.serious DESC, er.fatal_or_life_threatening DESC, er.seq
)
SELECT c.id AS case_id, c.worldwide_unique_id, c.sender_case_id, c.report_type, c.study_id, st.protocol_number,
  coalesce(st.sponsor_org_id, pr.sponsor_org_id) AS sponsor_org_id,
  c.product_id, pr.name AS product_name, c.first_received_date, c.source_system,
  l.case_version_id AS latest_version_id, l.version_number AS latest_version_number, l.kind AS latest_version_kind,
  l.awareness_date, l.info_received_date,
  cp.subject_number, cp.initials,
  pe.pt_term AS primary_event_pt, pe.soc_term AS primary_event_soc,
  r.expedited_class, r.reason AS reportability_reason, r.causality_assessed, r.minimum_criteria_met,
  st.is_blinded, (u.id IS NOT NULL) AS is_unblinded,
  (n.id IS NOT NULL) AS is_nullified,
  CASE
    WHEN n.id IS NOT NULL THEN 'nullified'
    WHEN lt.to_state = 'closed' THEN 'closed'
    WHEN EXISTS (SELECT 1 FROM submission s WHERE s.case_version_id = l.case_version_id) THEN 'submitted'
    WHEN EXISTS (SELECT 1 FROM signature s WHERE s.case_version_id = l.case_version_id AND s.meaning = 'approval')
      THEN 'approved'
    WHEN lt.to_state IS NOT NULL THEN lt.to_state::text
    WHEN r.minimum_criteria_met THEN 'data_entry'
    ELSE 'intake'
  END AS state,
  coalesce(o.open_obligations, 0) AS open_obligations,
  coalesce(o.overdue_obligations, 0) AS overdue_obligations,
  o.next_due_date,
  (o.next_due_date - CURRENT_DATE) AS days_remaining,
  sig.meaning AS latest_signature_meaning, sig.signed_at AS latest_signed_at,
  (SELECT count(*) FROM case_attachment a WHERE a.case_id = c.id) AS attachment_count,
  (SELECT count(*) FROM case_version v WHERE v.case_id = c.id) AS version_count,
  -- Appended in 0004.
  r.any_anticipated, r.any_causality_disagreement,
  c.received_via, c.received_ref
FROM "case" c
JOIN latest l ON l.case_id = c.id
LEFT JOIN study st ON st.id = c.study_id
LEFT JOIN product pr ON pr.id = c.product_id
LEFT JOIN case_patient cp ON cp.case_version_id = l.case_version_id
LEFT JOIN primary_event pe ON pe.case_version_id = l.case_version_id
JOIN v_case_reportability r ON r.case_version_id = l.case_version_id
LEFT JOIN lt ON lt.case_version_id = l.case_version_id
LEFT JOIN sig ON sig.case_version_id = l.case_version_id
LEFT JOIN obligations o ON o.case_id = c.id
LEFT JOIN case_unblinding u ON u.case_id = c.id
LEFT JOIN case_nullification n ON n.case_id = c.id;
--> statement-breakpoint

CREATE OR REPLACE VIEW v_serious_event_listing AS
WITH latest AS (
  SELECT DISTINCT ON (cv.case_id) cv.case_id, cv.id AS case_version_id, cv.version_number, cv.awareness_date
  FROM case_version cv ORDER BY cv.case_id, cv.version_number DESC
)
SELECT er.case_event_id, c.id AS case_id, c.sender_case_id, c.worldwide_unique_id, c.study_id, st.protocol_number,
  st.sponsor_org_id, c.product_id, pr.name AS product_name, c.first_received_date, l.awareness_date,
  cp.subject_number, cp.sex, cp.age_value, cp.age_unit,
  s.country AS site_country,
  coalesce(u.arm_label, CASE WHEN st.is_blinded THEN 'blinded' ELSE pr.name END) AS arm_label,
  (SELECT string_agg(d.name_as_reported || coalesce(' ' || d.dose_text, ''), '; ' ORDER BY d.seq)
     FROM case_drug d WHERE d.case_version_id = l.case_version_id AND d.role IN ('suspect', 'interacting')) AS suspect_drugs,
  er.seq AS event_seq, er.reported_term, er.pt_code, er.pt_term, er.soc_code, er.soc_term,
  er.onset_date, er.outcome, er.fatal_or_life_threatening,
  CASE WHEN e.serious_death THEN 1 WHEN e.serious_life_threatening THEN 2 WHEN e.serious_hospitalization THEN 3
       WHEN e.serious_disabling THEN 4 WHEN e.serious_congenital_anomaly THEN 5 ELSE 6 END AS seriousness_rank,
  er.reporter_related, er.sponsor_related, er.related_either, er.expectedness, er.expectedness_basis, er.rsi_label,
  -- Appended in 0004.
  er.causality_disagreement, er.anticipated, er.anticipated_label
FROM v_case_event_reportability er
JOIN case_event e ON e.id = er.case_event_id
JOIN latest l ON l.case_version_id = er.case_version_id
JOIN "case" c ON c.id = l.case_id
JOIN study st ON st.id = c.study_id
LEFT JOIN product pr ON pr.id = c.product_id
LEFT JOIN case_patient cp ON cp.case_version_id = l.case_version_id
LEFT JOIN study_site ss ON ss.id = cp.study_site_id
LEFT JOIN site s ON s.id = ss.site_id
LEFT JOIN case_unblinding u ON u.case_id = c.id
JOIN v_case_minimum_criteria mc ON mc.case_version_id = l.case_version_id
WHERE er.serious AND mc.minimum_criteria_met
  AND NOT EXISTS (SELECT 1 FROM case_nullification n WHERE n.case_id = c.id);
--> statement-breakpoint

-- E2F §3.7.2(l): the comment column carries the sponsor's position when it
-- differs from the reporter's, and the anticipated concept when designated.
CREATE OR REPLACE VIEW v_dsur_sar_line_listing AS
SELECT DISTINCT ON (l.case_id) l.case_id, l.sender_case_id, l.study_id, l.protocol_number, l.sponsor_org_id,
  l.product_id, l.product_name, l.first_received_date, l.awareness_date, l.subject_number, l.sex, l.age_value,
  l.age_unit, l.site_country, l.arm_label, l.suspect_drugs, l.pt_term, l.soc_term, l.onset_date, l.outcome,
  l.seriousness_rank, l.reporter_related, l.sponsor_related, l.expectedness, l.rsi_label,
  (SELECT string_agg(o.pt_term, '; ' ORDER BY o.event_seq) FROM v_serious_event_listing o
     WHERE o.case_id = l.case_id AND o.case_event_id <> l.case_event_id) AS other_serious_reactions,
  -- Appended in 0004.
  nullif(concat_ws('; ',
    CASE WHEN l.causality_disagreement THEN
      'Sponsor disagrees with the reporter: investigator ' || CASE WHEN l.reporter_related THEN 'related' ELSE 'not related' END
        || ', sponsor ' || CASE WHEN l.sponsor_related THEN 'related' ELSE 'not related' END END,
    CASE WHEN l.anticipated THEN 'anticipated SAE in the study population: ' || l.anticipated_label END), '') AS sponsor_comment,
  l.anticipated_label
FROM v_serious_event_listing l
WHERE l.related_either
ORDER BY l.case_id, l.seriousness_rank, l.event_seq;
