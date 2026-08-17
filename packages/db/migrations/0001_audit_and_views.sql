-- Custom migration: compliance machinery + reporting-obligation engine +
-- derived views. Everything here is deliberately in the database (ADR-0003,
-- ADR-0004, ADR-0006, ADR-0007): audit, immutability, version locking, and
-- the regulatory clock hold for every write path, not just well-behaved app
-- code.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Constraints Drizzle can't express
-- ---------------------------------------------------------------------------

-- Day zero is a judgment: when it differs from the receipt date, say why
-- (ADR-0007, E2A §III.B.3).
ALTER TABLE case_version ADD CONSTRAINT case_version_awareness_rationale_check
  CHECK (awareness_date = info_received_date OR awareness_rationale IS NOT NULL);
--> statement-breakpoint
-- An expectedness override always carries its rationale (E2A §II.C.2).
ALTER TABLE case_assessment ADD CONSTRAINT case_assessment_override_rationale_check
  CHECK ((expectedness_override IS NULL) = (expectedness_rationale IS NULL));
--> statement-breakpoint
-- A grant scopes to a sponsor organization or a study, not both (ADR-0015).
ALTER TABLE access_grant ADD CONSTRAINT access_grant_single_scope_check
  CHECK (NOT (organization_id IS NOT NULL AND study_id IS NOT NULL));
--> statement-breakpoint
-- ACK codes are the E2B(R3) IG §4.0 set plus a manual receipt.
ALTER TABLE submission_acknowledgement ADD CONSTRAINT submission_ack_code_check
  CHECK (ack_code IN ('AA', 'AE', 'AR', 'CA', 'CR', 'manual_receipt'));
--> statement-breakpoint
-- A return to data entry carries the reviewer's note.
ALTER TABLE case_transition ADD CONSTRAINT case_transition_return_note_check
  CHECK (to_state <> 'data_entry' OR note IS NOT NULL);
--> statement-breakpoint
-- A fatal outcome (E.i.7 = 5) is a death seriousness criterion (E.i.3.2a).
ALTER TABLE case_event ADD CONSTRAINT case_event_fatal_is_serious_check
  CHECK (outcome <> 'fatal' OR serious_death);
--> statement-breakpoint
ALTER TABLE reporting_rule ADD CONSTRAINT reporting_rule_timeline_positive_check
  CHECK (timeline_days > 0);
--> statement-breakpoint
-- One active waiver per obligation.
CREATE UNIQUE INDEX expected_submission_waiver_active_unique
  ON expected_submission_waiver (expected_submission_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
-- Substring search over dictionary terms (drizzle-orm has no gin_trgm_ops).
CREATE INDEX dictionary_term_trgm_idx ON dictionary_term
  USING gin (normalized_term gin_trgm_ops);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Immutability: facts, signatures, submissions, and audit events can never be
-- updated or deleted, by any role. Part 11 §11.10(c), §11.10(e).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pv_forbid_mutation() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION '% rows are immutable (append-only): % rejected', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'raise_exception';
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_event_immutable BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER signature_immutable BEFORE UPDATE OR DELETE ON signature
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER submission_immutable BEFORE UPDATE OR DELETE ON submission
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER submission_acknowledgement_immutable BEFORE UPDATE OR DELETE ON submission_acknowledgement
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER case_attachment_immutable BEFORE UPDATE OR DELETE ON case_attachment
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER case_transition_immutable BEFORE UPDATE OR DELETE ON case_transition
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER case_unblinding_immutable BEFORE UPDATE OR DELETE ON case_unblinding
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER case_nullification_immutable BEFORE UPDATE OR DELETE ON case_nullification
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER rsi_listed_term_immutable BEFORE UPDATE OR DELETE ON rsi_listed_term
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER dictionary_term_immutable BEFORE UPDATE OR DELETE ON dictionary_term
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_mutation();
--> statement-breakpoint

-- A dictionary header is immutable except for the counts and hash the
-- importer sets after loading its terms (ADR-0005).
CREATE OR REPLACE FUNCTION pv_dictionary_guard() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'dictionary rows are immutable: DELETE rejected' USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.id <> OLD.id OR NEW.type <> OLD.type OR NEW.version <> OLD.version
     OR NEW.is_demo_subset <> OLD.is_demo_subset OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'dictionary identity is immutable: only terms_count, source_sha256, loaded_by may be set'
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER dictionary_guard BEFORE UPDATE OR DELETE ON dictionary
  FOR EACH ROW EXECUTE FUNCTION pv_dictionary_guard();
--> statement-breakpoint

-- An RSI version's one permitted mutation is its ending (ADR-0004).
CREATE OR REPLACE FUNCTION pv_rsi_version_guard() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'product_rsi_version rows are never deleted: end them with effective_to'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.id <> OLD.id OR NEW.product_id <> OLD.product_id OR NEW.label <> OLD.label
     OR NEW.effective_from <> OLD.effective_from
     OR NEW.document_sha256 IS DISTINCT FROM OLD.document_sha256
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR (OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to) THEN
    RAISE EXCEPTION 'product_rsi_version: only effective_to may be set, once'
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER product_rsi_version_guard BEFORE UPDATE OR DELETE ON product_rsi_version
  FOR EACH ROW EXECUTE FUNCTION pv_rsi_version_guard();
--> statement-breakpoint

-- Case identity never changes (E2B(R3) C.1.8.1); nothing deletes a case.
CREATE OR REPLACE FUNCTION pv_case_identity_guard() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'case rows are never deleted: nullify the case (C.1.11)' USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.id <> OLD.id OR NEW.worldwide_unique_id <> OLD.worldwide_unique_id
     OR NEW.sender_case_id <> OLD.sender_case_id OR NEW.first_received_date <> OLD.first_received_date
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
     OR NEW.intake_payload IS DISTINCT FROM OLD.intake_payload
     OR NEW.intake_payload_sha256 IS DISTINCT FROM OLD.intake_payload_sha256 THEN
    RAISE EXCEPTION 'case identity and intake provenance are immutable' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER case_identity_guard BEFORE UPDATE OR DELETE ON "case"
  FOR EACH ROW EXECUTE FUNCTION pv_case_identity_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Version hash and lock (ADR-0006, §11.70).
-- pv_case_version_sha256() hashes the canonical JSON of a version and its
-- children (jsonb key order is canonical; children ordered by seq). A
-- signature copies it; v_signature_integrity recomputes it.
-- ---------------------------------------------------------------------------

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
  RETURN encode(digest(v_doc::text, 'sha256'), 'hex');
END
$fn$ LANGUAGE plpgsql STABLE;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION pv_forbid_locked_version_mutation() RETURNS trigger AS $fn$
DECLARE
  v_version uuid;
BEGIN
  IF TG_TABLE_NAME = 'case_version' THEN
    v_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.case_version_id ELSE NEW.case_version_id END;
  END IF;
  IF EXISTS (SELECT 1 FROM signature s WHERE s.case_version_id = v_version) THEN
    RAISE EXCEPTION 'case version % is locked by a signature (ADR-0006): % on % rejected; open a new version',
      v_version, TG_OP, TG_TABLE_NAME USING ERRCODE = 'raise_exception';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER case_version_lock BEFORE UPDATE OR DELETE ON case_version
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_locked_version_mutation();
--> statement-breakpoint
CREATE TRIGGER case_patient_lock BEFORE INSERT OR UPDATE OR DELETE ON case_patient
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_locked_version_mutation();
--> statement-breakpoint
CREATE TRIGGER case_source_lock BEFORE INSERT OR UPDATE OR DELETE ON case_source
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_locked_version_mutation();
--> statement-breakpoint
CREATE TRIGGER case_event_lock BEFORE INSERT OR UPDATE OR DELETE ON case_event
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_locked_version_mutation();
--> statement-breakpoint
CREATE TRIGGER case_drug_lock BEFORE INSERT OR UPDATE OR DELETE ON case_drug
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_locked_version_mutation();
--> statement-breakpoint
CREATE TRIGGER case_assessment_lock BEFORE INSERT OR UPDATE OR DELETE ON case_assessment
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_locked_version_mutation();
--> statement-breakpoint
CREATE TRIGGER case_test_lock BEFORE INSERT OR UPDATE OR DELETE ON case_test
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_locked_version_mutation();
--> statement-breakpoint
CREATE TRIGGER case_narrative_lock BEFORE INSERT OR UPDATE OR DELETE ON case_narrative
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_locked_version_mutation();
--> statement-breakpoint

-- No versions after nullification (C.1.11.1 = 1): a resubmission is a new
-- case with replaces_case_id.
CREATE OR REPLACE FUNCTION pv_forbid_versions_after_nullification() RETURNS trigger AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM case_nullification n WHERE n.case_id = NEW.case_id) THEN
    RAISE EXCEPTION 'case % is nullified: no further versions (open a new case with replaces_case_id)', NEW.case_id
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER case_version_after_nullification BEFORE INSERT ON case_version
  FOR EACH ROW EXECUTE FUNCTION pv_forbid_versions_after_nullification();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit trail: AFTER-triggers on every domain table write hash-chained events.
-- Actor identity comes from per-transaction settings established by the API
-- (set_config('pv.actor_id' / 'pv.actor_label', ..., true)); writes made
-- without them are attributed to 'system'.
--
-- Chain: hash = sha256(prev_hash || action || actor_id || actor_label ||
--                      entity_id || before || after || occurred_at)
-- computed from the stored columns, so pv_verify_audit_chain() can replay
-- and detect any retroactive edit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pv_audit() RETURNS trigger AS $fn$
DECLARE
  v_now timestamptz := now();
  v_actor uuid := nullif(current_setting('pv.actor_id', true), '')::uuid;
  v_label text := coalesce(nullif(current_setting('pv.actor_label', true), ''), 'system');
  v_prev char(64);
  v_before jsonb;
  v_after jsonb;
  v_entity_id text;
  v_action text := lower(TG_TABLE_NAME) || '.' || lower(TG_OP);
  v_hash char(64);
BEGIN
  -- Serialize chain appends; xact-scoped lock releases on commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtext('pv_audit_chain'));
  SELECT hash INTO v_prev FROM audit_event ORDER BY id DESC LIMIT 1;
  IF v_prev IS NULL THEN
    v_prev := repeat('0', 64);
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_after := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
  ELSE
    v_before := to_jsonb(OLD);
  END IF;
  v_entity_id := coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'key', v_before ->> 'key');
  v_hash := encode(digest(
    v_prev || v_action || coalesce(v_actor::text, '') || v_label
      || coalesce(v_entity_id, '') || coalesce(v_before::text, '')
      || coalesce(v_after::text, '') || v_now::text,
    'sha256'), 'hex');
  INSERT INTO audit_event
    (occurred_at, actor_id, actor_label, action, entity_type, entity_id,
     before, after, prev_hash, hash)
  VALUES
    (v_now, v_actor, v_label, v_action, TG_TABLE_NAME, v_entity_id,
     v_before, v_after, v_prev, v_hash);
  RETURN coalesce(NEW, OLD);
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER organization_audit AFTER INSERT OR UPDATE OR DELETE ON organization
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER study_audit AFTER INSERT OR UPDATE OR DELETE ON study
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER site_audit AFTER INSERT OR UPDATE OR DELETE ON site
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER study_site_audit AFTER INSERT OR UPDATE OR DELETE ON study_site
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER product_audit AFTER INSERT OR UPDATE OR DELETE ON product
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER study_product_audit AFTER INSERT OR UPDATE OR DELETE ON study_product
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER product_rsi_version_audit AFTER INSERT OR UPDATE ON product_rsi_version
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER rsi_listed_term_audit AFTER INSERT ON rsi_listed_term
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER person_audit AFTER INSERT OR UPDATE OR DELETE ON person
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER access_grant_audit AFTER INSERT OR UPDATE OR DELETE ON access_grant
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER reporting_destination_audit AFTER INSERT OR UPDATE OR DELETE ON reporting_destination
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER app_meta_audit AFTER INSERT OR UPDATE OR DELETE ON app_meta
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER dictionary_audit AFTER INSERT OR UPDATE ON dictionary
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_audit AFTER INSERT OR UPDATE ON "case"
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_version_audit AFTER INSERT OR UPDATE ON case_version
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_patient_audit AFTER INSERT OR UPDATE OR DELETE ON case_patient
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_source_audit AFTER INSERT OR UPDATE OR DELETE ON case_source
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_event_audit AFTER INSERT OR UPDATE OR DELETE ON case_event
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_drug_audit AFTER INSERT OR UPDATE OR DELETE ON case_drug
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_assessment_audit AFTER INSERT OR UPDATE OR DELETE ON case_assessment
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_test_audit AFTER INSERT OR UPDATE OR DELETE ON case_test
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_narrative_audit AFTER INSERT OR UPDATE OR DELETE ON case_narrative
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_attachment_audit AFTER INSERT ON case_attachment
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_transition_audit AFTER INSERT ON case_transition
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER signature_audit AFTER INSERT ON signature
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_unblinding_audit AFTER INSERT ON case_unblinding
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER case_nullification_audit AFTER INSERT ON case_nullification
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER reporting_rule_audit AFTER INSERT OR UPDATE OR DELETE ON reporting_rule
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER expected_submission_audit AFTER INSERT OR UPDATE OR DELETE ON expected_submission
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER expected_submission_waiver_audit AFTER INSERT OR UPDATE OR DELETE ON expected_submission_waiver
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER submission_audit AFTER INSERT ON submission
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint
CREATE TRIGGER submission_acknowledgement_audit AFTER INSERT ON submission_acknowledgement
  FOR EACH ROW EXECUTE FUNCTION pv_audit();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION pv_verify_audit_chain()
RETURNS TABLE (event_id bigint, problem text) AS $fn$
DECLARE
  r record;
  v_prev char(64) := repeat('0', 64);
  v_expected char(64);
BEGIN
  FOR r IN SELECT * FROM audit_event ORDER BY id LOOP
    IF r.prev_hash <> v_prev THEN
      event_id := r.id; problem := 'prev_hash does not match preceding event';
      RETURN NEXT;
    END IF;
    v_expected := encode(digest(
      r.prev_hash || r.action || coalesce(r.actor_id::text, '') || r.actor_label
        || coalesce(r.entity_id, '') || coalesce(r.before::text, '')
        || coalesce(r.after::text, '') || r.occurred_at::text,
      'sha256'), 'hex');
    IF r.hash <> v_expected THEN
      event_id := r.id; problem := 'hash does not match recomputed value';
      RETURN NEXT;
    END IF;
    v_prev := r.hash;
  END LOOP;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Minimum valid ICSR (E2B(R3) IG §3.3.1): identifiable patient, identifiable
-- reporter, at least one event, at least one suspect or interacting drug.
-- ---------------------------------------------------------------------------

CREATE VIEW v_case_minimum_criteria AS
WITH flags AS (
  SELECT cv.id AS case_version_id, cv.case_id, cv.version_number,
    EXISTS (SELECT 1 FROM case_patient p WHERE p.case_version_id = cv.id
              AND (p.initials IS NOT NULL OR p.subject_number IS NOT NULL OR p.age_value IS NOT NULL
                   OR p.age_group IS NOT NULL OR p.sex IS NOT NULL)) AS has_identifiable_patient,
    EXISTS (SELECT 1 FROM case_source s WHERE s.case_version_id = cv.id
              AND (s.given_name IS NOT NULL OR s.family_name IS NOT NULL OR s.organization IS NOT NULL
                   OR s.qualification IS NOT NULL OR s.country IS NOT NULL OR s.person_id IS NOT NULL))
      AS has_identifiable_reporter,
    EXISTS (SELECT 1 FROM case_event e WHERE e.case_version_id = cv.id) AS has_event,
    EXISTS (SELECT 1 FROM case_drug d WHERE d.case_version_id = cv.id
              AND d.role IN ('suspect', 'interacting')) AS has_suspect_drug
  FROM case_version cv
)
SELECT f.*,
  (f.has_identifiable_patient AND f.has_identifiable_reporter AND f.has_event AND f.has_suspect_drug)
    AS minimum_criteria_met,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT f.has_identifiable_patient THEN 'identifiable patient' END,
    CASE WHEN NOT f.has_identifiable_reporter THEN 'identifiable reporter' END,
    CASE WHEN NOT f.has_event THEN 'at least one event' END,
    CASE WHEN NOT f.has_suspect_drug THEN 'at least one suspect drug' END
  ], NULL) AS missing
FROM flags f;
--> statement-breakpoint

-- No signature, submission, or medical review before the case is a valid ICSR.
CREATE OR REPLACE FUNCTION pv_require_minimum_criteria() RETURNS trigger AS $fn$
DECLARE
  v_missing text[];
BEGIN
  IF TG_TABLE_NAME = 'case_transition' THEN
    -- Field access is resolved per table, so this stays inside the branch.
    IF (to_jsonb(NEW) ->> 'to_state') <> 'medical_review' THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT missing INTO v_missing FROM v_case_minimum_criteria WHERE case_version_id = NEW.case_version_id;
  IF v_missing IS NULL OR array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'case version % does not meet the minimum criteria for a valid ICSR (E2B(R3) §3.3.1): missing %',
      NEW.case_version_id, coalesce(array_to_string(v_missing, ', '), 'version') USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER signature_requires_valid_icsr BEFORE INSERT ON signature
  FOR EACH ROW EXECUTE FUNCTION pv_require_minimum_criteria();
--> statement-breakpoint
CREATE TRIGGER submission_requires_valid_icsr BEFORE INSERT ON submission
  FOR EACH ROW EXECUTE FUNCTION pv_require_minimum_criteria();
--> statement-breakpoint
CREATE TRIGGER medical_review_requires_valid_icsr BEFORE INSERT ON case_transition
  FOR EACH ROW EXECUTE FUNCTION pv_require_minimum_criteria();
--> statement-breakpoint

-- A submission is of a version that carries an approval signature bound to
-- the version's current hash (§11.70 in the other direction: what was sent
-- is what was signed).
CREATE OR REPLACE FUNCTION pv_require_approval_for_submission() RETURNS trigger AS $fn$
DECLARE
  v_hash char(64) := pv_case_version_sha256(NEW.case_version_id);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM signature s
    WHERE s.case_version_id = NEW.case_version_id AND s.meaning = 'approval' AND s.signed_sha256 = v_hash
  ) THEN
    RAISE EXCEPTION 'case version % has no approval signature bound to its current hash', NEW.case_version_id
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.case_version_sha256 <> v_hash THEN
    RAISE EXCEPTION 'submission hash % does not match the version''s current hash %', NEW.case_version_sha256, v_hash
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER submission_requires_approval BEFORE INSERT ON submission
  FOR EACH ROW EXECUTE FUNCTION pv_require_approval_for_submission();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reportability (E2A §II, §III.A). Per event, then per version.
-- ---------------------------------------------------------------------------

CREATE VIEW v_case_event_reportability AS
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
  -- The RSI version in effect at event onset (Reg. 536/2014 Annex III §2.2(8));
  -- awareness date when onset is unknown. Latest effective_from wins.
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
  -- Fail-safe (ADR-0007): an unassessed event is treated as related.
  CASE WHEN coalesce(ca.reporter_assessed, false) THEN ca.reporter_related_raw ELSE true END AS reporter_related,
  CASE WHEN coalesce(ca.sponsor_assessed, false) THEN ca.sponsor_related_raw ELSE true END AS sponsor_related,
  (CASE WHEN coalesce(ca.reporter_assessed, false) THEN ca.reporter_related_raw ELSE true END
     OR CASE WHEN coalesce(ca.sponsor_assessed, false) THEN ca.sponsor_related_raw ELSE true END) AS related_either
FROM ev
LEFT JOIN rsi r ON r.case_event_id = ev.case_event_id
LEFT JOIN overrides o ON o.case_event_id = ev.case_event_id
LEFT JOIN causality ca ON ca.case_event_id = ev.case_event_id;
--> statement-breakpoint

CREATE VIEW v_case_reportability AS
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
  END AS reason
FROM case_version cv
JOIN "case" c ON c.id = cv.case_id
LEFT JOIN study st ON st.id = c.study_id
LEFT JOIN product pr ON pr.id = c.product_id
JOIN v_case_minimum_criteria mc ON mc.case_version_id = cv.id
LEFT JOIN v_case_event_reportability er ON er.case_version_id = cv.id
GROUP BY cv.id, cv.case_id, cv.version_number, cv.kind, cv.awareness_date, cv.info_received_date,
  c.study_id, c.product_id, c.report_type, st.sponsor_org_id, pr.sponsor_org_id, mc.minimum_criteria_met;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Rule matching (ADR-0007): the pure predicate. "Why does this rule apply to
-- this case" is this view.
-- ---------------------------------------------------------------------------

CREATE VIEW v_rule_match AS
SELECT r.case_version_id, r.case_id, r.version_number, rr.id AS reporting_rule_id, rr.destination_id,
  rr.obligation_kind, rr.timeline_days,
  CASE rr.obligation_kind WHEN 'nullification' THEN n.nullified_at::date ELSE r.awareness_date END AS clock_start_date
FROM v_case_reportability r
JOIN reporting_rule rr
  ON (rr.sponsor_org_id IS NULL OR rr.sponsor_org_id = r.sponsor_org_id)
 AND (rr.study_id IS NULL OR rr.study_id = r.study_id)
 AND (rr.product_id IS NULL OR rr.product_id = r.product_id)
 AND (rr.report_types IS NULL OR r.report_type::text = ANY (rr.report_types))
 AND (rr.version_kinds IS NULL OR r.version_kind::text = ANY (rr.version_kinds))
 AND r.awareness_date >= rr.effective_from
 AND (rr.effective_to IS NULL OR r.awareness_date <= rr.effective_to)
 AND (
   -- No predicate columns set: the rule applies to every version in scope.
   (rr.serious IS NULL AND rr.unexpected IS NULL AND rr.related IS NULL AND rr.fatal_or_life_threatening IS NULL)
   OR EXISTS (
     -- Per-event conjunction (E2A §III.A.1): one event that satisfies every set predicate.
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
 )
 AND (NOT rr.requires_prior_submission OR EXISTS (
        -- Follow-ups need a prior submission of an earlier version; a
        -- nullification refers to any submission of the case (same version).
        SELECT 1 FROM submission s JOIN case_version pv ON pv.id = s.case_version_id
        WHERE pv.case_id = r.case_id
          AND (pv.version_number < r.version_number OR rr.obligation_kind = 'nullification')
          AND s.destination_id = rr.destination_id AND s.kind <> 'nullification'))
LEFT JOIN case_nullification n ON n.case_id = r.case_id
WHERE r.minimum_criteria_met
  AND (rr.obligation_kind <> 'nullification' OR n.id IS NOT NULL);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Obligation status (derived, ADR-0004).
-- ---------------------------------------------------------------------------

CREATE VIEW v_expected_submission_status AS
WITH base AS (
  SELECT es.id AS expected_submission_id, es.reporting_rule_id, rr.name AS rule_name, rr.citation,
    rr.destination_id, d.name AS destination_name, d.kind AS destination_kind,
    es.case_id, es.case_version_id, cv.version_number, es.obligation_kind,
    es.clock_start_date, es.due_date, rr.due_soon_days, rr.timeline_days,
    (SELECT max(version_number) FROM case_version WHERE case_id = es.case_id) AS latest_version_number,
    w.id AS waiver_id, w.reason AS waiver_reason,
    s.id AS submission_id, s.sent_at, s.case_version_id AS submitted_version_id, s.kind AS submission_kind,
    s.format AS submission_format,
    a.id AS acknowledgement_id, a.ack_code, a.received_at AS acknowledged_at,
    (n.id IS NOT NULL) AS case_nullified
  FROM expected_submission es
  JOIN reporting_rule rr ON rr.id = es.reporting_rule_id
  JOIN reporting_destination d ON d.id = rr.destination_id
  JOIN case_version cv ON cv.id = es.case_version_id
  LEFT JOIN expected_submission_waiver w ON w.expected_submission_id = es.id AND w.revoked_at IS NULL
  LEFT JOIN case_nullification n ON n.case_id = es.case_id
  LEFT JOIN LATERAL (
    -- The earliest submission that discharges this obligation: same
    -- destination, a satisfying kind, this version or a later one.
    SELECT s.* FROM submission s
    JOIN case_version sv ON sv.id = s.case_version_id
    WHERE sv.case_id = es.case_id AND sv.version_number >= cv.version_number
      AND s.destination_id = rr.destination_id AND s.kind::text = ANY (rr.satisfying_kinds)
      AND s.sent_at::date >= es.clock_start_date
    ORDER BY s.sent_at LIMIT 1) s ON true
  LEFT JOIN LATERAL (
    SELECT a.* FROM submission_acknowledgement a WHERE a.submission_id = s.id
    ORDER BY a.received_at DESC LIMIT 1) a ON true
)
SELECT b.*,
  (b.sent_at::date <= b.due_date) AS on_time,
  (b.due_date - CURRENT_DATE) AS days_remaining,
  CASE
    WHEN b.submission_id IS NULL AND b.waiver_id IS NOT NULL THEN 'not_required'
    -- A nullified case owes nothing further except the nullification itself.
    WHEN b.submission_id IS NULL AND b.case_nullified AND b.obligation_kind <> 'nullification' THEN 'not_required'
    WHEN b.acknowledgement_id IS NOT NULL AND b.ack_code IN ('CA', 'AA', 'manual_receipt') THEN 'acknowledged'
    WHEN b.submission_id IS NOT NULL THEN 'submitted'
    WHEN b.obligation_kind = 'initial' AND b.version_number < b.latest_version_number
         AND NOT EXISTS (SELECT 1 FROM v_rule_match m JOIN case_version lv ON lv.id = m.case_version_id
                         WHERE m.case_id = b.case_id AND m.reporting_rule_id = b.reporting_rule_id
                           AND lv.version_number = b.latest_version_number) THEN 'superseded_by_follow_up'
    WHEN b.due_date < CURRENT_DATE THEN 'overdue'
    WHEN b.due_date <= CURRENT_DATE + b.due_soon_days THEN 'due_soon'
    ELSE 'pending'
  END AS status
FROM base b;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Materialization (ADR-0007). Idempotent; call inside the writing transaction
-- after any change to a case version, its children, or a nullification.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pv_sync_expected_submissions(p_case_version uuid) RETURNS integer AS $fn$
DECLARE
  v_inserted integer := 0;
BEGIN
  -- Insert missing obligations; recompute due dates for still-open versions.
  -- 'initial' obligations belong to the EARLIEST version at which the rule
  -- first matched; later versions that still match add nothing (the original
  -- clock keeps running).
  INSERT INTO expected_submission (reporting_rule_id, case_id, case_version_id, obligation_kind, clock_start_date, due_date)
  SELECT m.reporting_rule_id, m.case_id, m.case_version_id, m.obligation_kind,
         m.clock_start_date, m.clock_start_date + m.timeline_days
  FROM v_rule_match m
  WHERE m.case_version_id = p_case_version
    AND (m.obligation_kind <> 'initial' OR NOT EXISTS (
          SELECT 1 FROM expected_submission x JOIN case_version xv ON xv.id = x.case_version_id
          WHERE x.reporting_rule_id = m.reporting_rule_id AND x.case_id = m.case_id
            AND xv.version_number < m.version_number))
  ON CONFLICT (reporting_rule_id, case_version_id)
  DO UPDATE SET clock_start_date = EXCLUDED.clock_start_date, due_date = EXCLUDED.due_date
    WHERE expected_submission.due_date IS DISTINCT FROM EXCLUDED.due_date
       OR expected_submission.clock_start_date IS DISTINCT FROM EXCLUDED.clock_start_date;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Drop obligations this version no longer triggers, unless already
  -- discharged: those are history. The delete is audited.
  DELETE FROM expected_submission es
  WHERE es.case_version_id = p_case_version
    AND NOT EXISTS (SELECT 1 FROM v_rule_match m
                    WHERE m.case_version_id = es.case_version_id AND m.reporting_rule_id = es.reporting_rule_id)
    AND NOT EXISTS (SELECT 1 FROM v_expected_submission_status s
                    WHERE s.expected_submission_id = es.id AND s.status IN ('submitted', 'acknowledged'));
  RETURN v_inserted;
END
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Case queue: one row per case, state derived by precedence (ADR-0004).
-- ---------------------------------------------------------------------------

CREATE VIEW v_case_queue AS
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
  (SELECT count(*) FROM case_version v WHERE v.case_id = c.id) AS version_count
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

-- ---------------------------------------------------------------------------
-- DSUR (ICH E2F §3.7): serious events on the latest version of every
-- non-nullified study case; arm from the unblinding fact else 'blinded'.
-- ---------------------------------------------------------------------------

CREATE VIEW v_serious_event_listing AS
WITH latest AS (
  SELECT DISTINCT ON (cv.case_id) cv.case_id, cv.id AS case_version_id, cv.version_number, cv.awareness_date
  FROM case_version cv ORDER BY cv.case_id, cv.version_number DESC
)
SELECT er.case_event_id, c.id AS case_id, c.sender_case_id, c.worldwide_unique_id, c.study_id, st.protocol_number,
  st.sponsor_org_id, c.product_id, pr.name AS product_name, c.first_received_date, l.awareness_date,
  cp.subject_number, cp.sex, cp.age_value, cp.age_unit,
  s.country AS site_country,
  -- Arm: the unblinding fact if any; otherwise the product for an open-label
  -- study and 'blinded' for a blinded one (ADR-0008).
  coalesce(u.arm_label, CASE WHEN st.is_blinded THEN 'blinded' ELSE pr.name END) AS arm_label,
  (SELECT string_agg(d.name_as_reported || coalesce(' ' || d.dose_text, ''), '; ' ORDER BY d.seq)
     FROM case_drug d WHERE d.case_version_id = l.case_version_id AND d.role IN ('suspect', 'interacting')) AS suspect_drugs,
  er.seq AS event_seq, er.reported_term, er.pt_code, er.pt_term, er.soc_code, er.soc_term,
  er.onset_date, er.outcome, er.fatal_or_life_threatening,
  CASE WHEN e.serious_death THEN 1 WHEN e.serious_life_threatening THEN 2 WHEN e.serious_hospitalization THEN 3
       WHEN e.serious_disabling THEN 4 WHEN e.serious_congenital_anomaly THEN 5 ELSE 6 END AS seriousness_rank,
  er.reporter_related, er.sponsor_related, er.related_either, er.expectedness, er.expectedness_basis, er.rsi_label
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

-- E2F §3.7.2: interval line listing of serious adverse reactions, one row per
-- case under its most serious reaction, ordered by trial, SOC, PT.
CREATE VIEW v_dsur_sar_line_listing AS
SELECT DISTINCT ON (l.case_id) l.case_id, l.sender_case_id, l.study_id, l.protocol_number, l.sponsor_org_id,
  l.product_id, l.product_name, l.first_received_date, l.awareness_date, l.subject_number, l.sex, l.age_value,
  l.age_unit, l.site_country, l.arm_label, l.suspect_drugs, l.pt_term, l.soc_term, l.onset_date, l.outcome,
  l.seriousness_rank, l.reporter_related, l.sponsor_related, l.expectedness, l.rsi_label,
  (SELECT string_agg(o.pt_term, '; ' ORDER BY o.event_seq) FROM v_serious_event_listing o
     WHERE o.case_id = l.case_id AND o.case_event_id <> l.case_event_id) AS other_serious_reactions
FROM v_serious_event_listing l
WHERE l.related_either
ORDER BY l.case_id, l.seriousness_rank, l.event_seq;
--> statement-breakpoint

-- E2F §3.7.3: cumulative tabulation of serious adverse events by SOC and arm.
CREATE VIEW v_dsur_sae_summary AS
SELECT l.sponsor_org_id, l.product_id, l.product_name, l.study_id, l.protocol_number,
  l.soc_code, l.soc_term, l.arm_label,
  count(*) AS event_count, count(DISTINCT l.case_id) AS case_count,
  count(*) FILTER (WHERE l.related_either) AS reaction_count,
  count(*) FILTER (WHERE l.fatal_or_life_threatening) AS fatal_or_life_threatening_count
FROM v_serious_event_listing l
GROUP BY l.sponsor_org_id, l.product_id, l.product_name, l.study_id, l.protocol_number,
  l.soc_code, l.soc_term, l.arm_label;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Compliance metrics per sponsor x study x destination.
-- ---------------------------------------------------------------------------

CREATE VIEW v_reporting_compliance AS
SELECT coalesce(st.sponsor_org_id, pr.sponsor_org_id) AS sponsor_org_id, c.study_id, st.protocol_number,
  es.destination_id, es.destination_name,
  count(*) FILTER (WHERE es.status IN ('submitted', 'acknowledged')) AS closed,
  count(*) FILTER (WHERE es.status IN ('submitted', 'acknowledged') AND es.on_time) AS on_time_count,
  count(*) FILTER (WHERE es.status IN ('submitted', 'acknowledged') AND NOT es.on_time) AS late_count,
  count(*) FILTER (WHERE es.status = 'overdue') AS overdue_open,
  count(*) FILTER (WHERE es.status IN ('pending', 'due_soon')) AS pending_open,
  count(*) FILTER (WHERE es.status = 'not_required') AS waived,
  count(*) FILTER (WHERE es.status = 'superseded_by_follow_up') AS superseded,
  CASE WHEN count(*) FILTER (WHERE es.status IN ('submitted', 'acknowledged', 'overdue')) = 0 THEN NULL
       ELSE round(100.0 * count(*) FILTER (WHERE es.status IN ('submitted', 'acknowledged') AND es.on_time)
            / count(*) FILTER (WHERE es.status IN ('submitted', 'acknowledged', 'overdue')), 1) END AS pct_on_time
FROM v_expected_submission_status es
JOIN "case" c ON c.id = es.case_id
LEFT JOIN study st ON st.id = c.study_id
LEFT JOIN product pr ON pr.id = c.product_id
GROUP BY coalesce(st.sponsor_org_id, pr.sponsor_org_id), c.study_id, st.protocol_number, es.destination_id, es.destination_name;
--> statement-breakpoint

-- Every signature with the version hash recomputed now (§11.70).
CREATE VIEW v_signature_integrity AS
SELECT s.id AS signature_id, s.case_version_id, cv.case_id, s.signer_person_id, s.meaning, s.signed_at,
  s.signed_sha256, pv_case_version_sha256(s.case_version_id) AS current_sha256,
  (s.signed_sha256 = pv_case_version_sha256(s.case_version_id)) AS hash_matches
FROM signature s JOIN case_version cv ON cv.id = s.case_version_id;
