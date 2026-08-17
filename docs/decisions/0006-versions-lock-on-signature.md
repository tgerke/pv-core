# ADR-0006: Case versions lock on signature; follow-ups and corrections are new versions

**Status**: accepted · 2026-08-17

## Context

An ICSR changes over its life: new source information (a discharge summary), sponsor
corrections after review, recoding to a new MedDRA release, nullification. Regulators
expect the worldwide unique identifier to stay constant (E2B(R3) C.1.8.1) and each
transmission to be identifiable (C.1.5 date of most recent information; C.1.11 for
amendments and nullifications). Part 11 expects that a signed record cannot change under
its signature (21 CFR 11.70). Two designs were open: append-only versions of every child
row (edc-core's item-value model) or mutable drafts that freeze at a well-defined moment.

## Decision

`case` is the constant identity. Each transmission-worthy state is a `case_version`
(`initial`, `follow_up`, `amendment`) with its own set of child rows (patient, sources,
events, drugs, assessments, tests, narrative). A version and its children are mutable
while no signature exists on it, and every mutation is audited with before and after
images. The first `signature` on a version freezes it: `pv_forbid_locked_version_mutation()`
rejects INSERT, UPDATE, and DELETE on the version and every child table from then on. Any
later change opens a new version, cloned from the previous one. A `follow_up` carries new
source information and its own awareness date; an `amendment` is a sponsor correction with
no new source information and keeps C.1.5. `case_nullification` is a fact; a trigger
rejects further versions of a nullified case, and a resubmission is a new case with
`replaces_case_id`.

`pv_case_version_sha256(version_id)` hashes the canonical JSON of the version and its
children; `signature.signed_sha256` copies it at signing and `v_signature_integrity`
recomputes it on demand.

## Alternatives considered

- Append-only rows for every field, edc-core style. Correct, but an ICSR is one document
  with dozens of fields edited many times before review; a version per keystroke would
  make the record unreadable, and the audit trail already carries the before/after images.
- Locking on transition to medical review rather than on signature. Rejected: the
  signature is the regulated act (Part 11 §11.50, §11.70), and tying the freeze to it
  keeps one rule instead of two.

## Consequences

Tests that sign a version cannot edit it afterwards; they open a follow-up. Every write
path calls `pv_sync_expected_submissions()` in the same transaction so clocks follow the
new version. Corrections after a signature always leave a visible version boundary, which
is what a reviewer wants to see.
