# ADR-0017: Validation artifacts are generated from live runs, never hand-edited

**Status**: accepted · 2026-08-17

## Decision

`pnpm validation:iq` checks a live environment (migrations applied, immutability triggers
present, audit trigger on every non-exempt table, role privileges, chain verification,
storage posture, auth mode) and emits an installation-qualification report.
`pnpm validation:artifacts` runs the test suite with a JSON reporter and emits an
operational-qualification run report plus a requirement-to-test traceability matrix,
joined on the regulatory tokens that appear verbatim in test names (`§11.10(e)`, `E2A
§III.B`, `312.32(c)(2)`, `Art. 42(2)`). Both write to `docs/validation/`, which is never
edited by hand.

## Rationale

The port of ctms-core's ADR-0010. Hand-written validation evidence is worse than none: it
cannot be regenerated, and it drifts from the suite silently. Renaming a test away from its token drops the row from the matrix, visibly, which is
the point.

## Consequences

The validation *program* (SOPs, risk assessment, training, a QMS) remains organizational
work; the software produces its raw material. `docs/03-compliance.md` §11.10(a) says
"not claimed" and points here.
