# ADR-0004: Status is derived, endings are dated facts, corrections are new rows

**Status**: accepted · 2026-08-17

## Decision

No table stores a workflow status. A case's state (`intake`, `data_entry`,
`medical_review`, `approved`, `submitted`, `closed`, `nullified`) is derived in
`v_case_queue` from facts: whether the latest version meets the minimum criteria, the
latest recorded transition, whether a signature or a submission exists on it, whether a
nullification exists. An obligation's status is derived in `v_expected_submission_status`
from due dates, submissions, acknowledgements, waivers, and later versions. Grants,
delegations of RSI versions, and rules end by setting a dated ending column, never by
delete.

## Rationale

A stored status drifts from the facts that should determine it and needs its own audit
story. A derived status is always consistent with the record and needs none. This is the
stance ctms-core (ADR-0004 there) and dmops-core take, applied to case processing.

## Consequences

The `v_*` views are the public query surface (docs/02-data-model.md). Some states are
expensive to compute per row; indexes on `case_version(case_id, version_number)`,
`signature(case_version_id)`, and `submission(case_version_id)` keep the queue cheap.
`expected_submission` rows are derived state and may be removed by the sync when a version
stops matching a rule; the removal is audited.
