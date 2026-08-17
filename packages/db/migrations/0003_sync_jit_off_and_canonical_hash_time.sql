-- ---------------------------------------------------------------------------
-- 1. Planner JIT off for the obligation sync.
--
-- pv_sync_expected_submissions() ends with a DELETE whose NOT EXISTS
-- subqueries expand v_rule_match and v_expected_submission_status. On tables
-- without fresh statistics (right after a seed, or mid test-suite) the
-- planner's default row estimates push that statement past
-- jit_optimize_above_cost, and Postgres LLVM-compiles ~1000 expressions on
-- every call: about 2.7 s of compilation for an 18 ms statement, paid on every
-- case write. JIT never wins here (a handful of rows per call), so it is
-- pinned off on the function itself: every caller gets the same behaviour,
-- including a nightly resync run from psql. App connections also disable it
-- (packages/db/src/client.ts).
-- ---------------------------------------------------------------------------
ALTER FUNCTION pv_sync_expected_submissions(uuid) SET jit = off;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Time-zone-independent audit hash.
--
-- pv_audit() hashed occurred_at as v_now::text, whose rendering depends on
-- the session TimeZone (and DateStyle). Every app connection pins
-- PV_TIMEZONE, so verification through the API agreed with itself, but
-- pv_verify_audit_chain() from a psql or pv_readonly session in another zone
-- reported every event as tampered. The hash input is now
-- to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
-- which renders identically in every session. Chains written before this
-- migration verify only under the TimeZone that wrote them; this project has
-- no deployment that predates it (pnpm db:seed rebuilds development
-- databases). SECURITY DEFINER (migration 0002) is restated because CREATE OR
-- REPLACE resets unspecified attributes.
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
      || coalesce(v_after::text, '')
      || to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'sha256'), 'hex');
  INSERT INTO audit_event
    (occurred_at, actor_id, actor_label, action, entity_type, entity_id,
     before, after, prev_hash, hash)
  VALUES
    (v_now, v_actor, v_label, v_action, TG_TABLE_NAME, v_entity_id,
     v_before, v_after, v_prev, v_hash);
  RETURN coalesce(NEW, OLD);
END
$fn$ LANGUAGE plpgsql SECURITY DEFINER;
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
        || coalesce(r.after::text, '')
        || to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'sha256'), 'hex');
    IF r.hash <> v_expected THEN
      event_id := r.id; problem := 'hash does not match recomputed value';
      RETURN NEXT;
    END IF;
    v_prev := r.hash;
  END LOOP;
END
$fn$ LANGUAGE plpgsql;
