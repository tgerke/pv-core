# ADR-0008: Unblinding is a stored fact; the randomization system computes it

**Status**: accepted · 2026-08-17

## Decision

`case_unblinding` records, at most once per case, that a subject's treatment allocation
was revealed for safety reporting: arm label and role, when, by whom, why, and the
code-break reference in the randomization system. pv-core never computes or infers an
arm. The DSUR views read the arm from this fact and print `blinded` where none exists.
The `pv_readonly` role cannot read the arm columns; arms reach readers only through the
aggregate DSUR view.

## Rationale

ICH E2A §III.D and Regulation (EU) 536/2014 Annex III §2.5 expect the sponsor to break the
blind for the affected subject only, keeping trial staff and biometrics blinded. rtsm-core
owns the code-break and its audit (its ADR-0007); a second copy of allocation logic in the
safety database would be a second place for the blind to leak. Recording the fact keeps the
E2B(R3) drug entries honest (G.k.2.5 blinded flag) and the DSUR tabulation by arm possible
(E2F §3.7.3) without pv-core holding a randomization list.

## Consequences

Any new view that joins `case_unblinding` needs review for arm leakage. A blinded case
that meets expedited criteria is reported with the blind broken for that subject in the
randomization system first; the fact lands here with the reference.
