-- Least-privilege runtime roles (ADR-0003, ADR-0008; compliance doc honest gaps).
-- pv_app holds DML only: no TRUNCATE, no DDL (no CREATE on the schema), and
-- no trigger disablement (requires table ownership, which stays with the
-- migration role). Dev-grade password; a production deployment rotates it
-- with ALTER ROLE.
DO $$ BEGIN
  CREATE ROLE pv_app LOGIN PASSWORD 'pv_app';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO pv_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pv_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pv_app;--> statement-breakpoint
-- Tables and sequences added by future migrations (run by the owning role)
-- inherit the same DML-only grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pv_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO pv_app;--> statement-breakpoint
-- The audit trail is written only by the trigger, never by the role: with
-- SECURITY DEFINER the trigger function inserts as the table owner, and the
-- runtime role loses direct INSERT. It cannot fabricate audit events even
-- with a correctly recomputed hash chain.
ALTER FUNCTION pv_audit() SECURITY DEFINER;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_event FROM pv_app;--> statement-breakpoint
-- Belt and braces on the immutable facts: the triggers already reject these,
-- and the role does not hold the privilege either.
REVOKE UPDATE, DELETE ON signature, submission, submission_acknowledgement, case_attachment,
  case_transition, case_unblinding, case_nullification, rsi_listed_term, dictionary_term FROM pv_app;--> statement-breakpoint

-- Read-only role for BI and DSUR tooling: the derived views only, and never
-- the arm columns at rest (ADR-0008). Aggregate DSUR views expose arms where
-- E2F §3.7.3 needs them.
DO $$ BEGIN
  CREATE ROLE pv_readonly LOGIN PASSWORD 'pv_readonly';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO pv_readonly;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pv_readonly;--> statement-breakpoint
REVOKE SELECT ON case_unblinding FROM pv_readonly;--> statement-breakpoint
GRANT SELECT (id, case_id, unblinded_at, unblinded_by, reason, source_system, source_ref) ON case_unblinding TO pv_readonly;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pv_readonly;
