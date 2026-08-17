# ADR-0001: The seat is sponsor/CRO-side, clinical-trial pharmacovigilance

**Status**: accepted · 2026-08-17

## Decision

pv-core is built for the sponsor and CRO seat of pre-approval pharmacovigilance: serious
adverse events from interventional trials, processed as ICH E2B(R3)-shaped Individual Case
Safety Reports, judged against ICH E2A definitions, clocked against 21 CFR 312.32 and
Regulation (EU) 536/2014 Article 42, and summarized for the DSUR of ICH E2F. A CRO runs
one instance and hosts several sponsors on it.

Post-marketing spontaneous reporting is supported by the data model (the case carries an
E2B(R3) report type) but is not the workflow, seed, or documentation focus.

## Rationale

The sibling systems (edc-core, ctms-core, rtsm-core) serve the same seat, and the
organizations that use them (consortia, academic sponsors, the CROs serving them) hold the
safety database in a spreadsheet next to a vendor system today. The regulatory texts for
the pre-approval side (E2A, E2B(R3), E2F, EU CTR) are in the verified source library; the
post-marketing ones (E2C(R2), E2D, GVP modules, 21 CFR 314.80) are not, and ADR-0010
forbids writing them from memory.

## Consequences

Boundaries with the siblings are explicit: edc-core owns AE capture, rtsm-core owns
unblinding, ctms-core owns TMF filing. Regulator gateway accounts are the deploying
organization's. Multi-sponsor is a scope (ADR-0015), not tenancy. PSUR/PBRER, signal
detection, and literature monitoring are non-goals of this phase (docs/06-roadmap.md).
