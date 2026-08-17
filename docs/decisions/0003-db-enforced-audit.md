# ADR-0003: Audit trail written and guarded by the database, not the application

**Status**: accepted · 2026-08-17

## Decision

Every domain table has an AFTER INSERT/UPDATE/DELETE trigger (`pv_audit()`) that appends
an `audit_event` row with the actor, action, entity, full before and after row images, and
a SHA-256 hash chained to the previous event. `audit_event`, `signature`, `submission`,
`submission_acknowledgement`, `case_attachment`, `case_transition`, `case_unblinding`,
`case_nullification`, `rsi_listed_term`, `dictionary`, and `dictionary_term` reject UPDATE
and DELETE for every role (`pv_forbid_mutation()`). The API connects as a role that holds
DML privileges only (`pv_app`, migration 0002): no DDL, no TRUNCATE, no trigger
disablement, no direct writes to `audit_event`. `pv_verify_audit_chain()` replays the
chain and reports any break.

## Rationale

21 CFR 11.10(e) asks for computer-generated, time-stamped audit trails that do not obscure
previously recorded information. Enforcing that below the application layer means every
write path (API, seed, importer, a DBA at psql) is covered, and a retroactive edit is
detectable rather than merely discouraged. This is the mechanism ctms-core and edc-core
already use; porting it keeps the family's compliance story consistent.

## Consequences

Tests cannot clean up after themselves on immutable tables; they use fixture studies and
tolerate accumulation. Chain appends serialize on an advisory lock, so the test suite runs
files sequentially. The actor comes from per-transaction settings established by
`withActor()`; a write outside it is attributed to `system`, which is a bug everywhere
except migrations, importer, and seed.
