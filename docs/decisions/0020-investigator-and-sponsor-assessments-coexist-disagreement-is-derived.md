# ADR-0020: Investigator and sponsor causality assessments coexist; disagreement is derived, never adjudicated in the database

**Status**: accepted · 2026-08-17

## Context

The site's investigator reports every SAE to the sponsor with a causality assessment (21 CFR
312.64(b); FDA, *Investigator Responsibilities: Safety Reporting for Investigational Drugs and
Devices*, December 2025, §V.A, in the library as
`sources/FDA/fda-ind-safety-reporting-investigator-responsibilities-2025.md`). The sponsor
then makes its own. The two do not always agree, and the texts say what to do about it:

- Regulation (EU) 536/2014 Annex III §2.1 ¶4: "The causality assessment given by the
  investigator shall not be downgraded by the sponsor. If the sponsor disagrees with the
  investigator's causality assessment, the opinion of both the investigator and the sponsor
  shall be provided with the report."
- ICH E2A §III.A.1: a case judged by either the reporting health care professional or the
  sponsor as having a reasonable suspected causal relationship is an ADR.
- 21 CFR 312.32 as read by FDA's December 2025 sponsor guidance (§III.B, §IV.A): the sponsor
  makes the causality judgment for an IND safety report; it should not report when the
  investigator says related and its own review finds no evidence, and must report when the
  investigator says not related and its review does. Seriousness is the other way round:
  serious if either party says so (§III.D).
- ICH E2B(R3) IG §G.k.9.i: the assessment block repeats per source and method, and the IG's
  own worked example carries a reporter's and a company's divergent results in one ICSR.
- ICH E2F §3.7.2(l): the DSUR line listing's comment column carries the causality assessment
  "if the sponsor disagrees with the reporter".

`case_assessment` already had this shape: one row per drug, event, and assessor, and
`reporting_rule.causality_basis` already chose which opinion clocks a rule. What was missing
was any way to see a disagreement, and a stated position on how one is resolved.

## Decision

1. Both rows stay. The sponsor never edits the reporter's row; it records its own with a
   result and rationale. Both are exported (`G.k.9.i.2.r`) and both appear in the DSUR
   listing.
2. Disagreement is a derived column, not a state. `v_case_event_reportability.causality_disagreement`
   is true when both parties assessed and their recorded opinions differ; an unassessed side
   is not a disagreement (the fail-safe still treats it as related). It rolls up to the
   version, the queue, the DSUR comment (E2F §3.7.2(l)), a queue tile, and a digest section.
3. Which opinion starts a clock is the rule's `causality_basis`. The seeded FDA IND 7-day and
   15-day rules use `sponsor` (312.32; FDA Dec 2025 §IV.A); the EU CTR, investigator and IRB
   rules keep `either` (E2A §III.A.1). A sponsor that has not assessed is treated as related,
   so a spurious clock is the fail-safe direction (ADR-0007).
4. Resolution with the site happens outside pv-core. A query to the investigator runs through
   the EDC or a letter (a `correspondence` attachment on the case); the site's answer is
   follow-up information and opens a new version, where the reporter's row may change. There
   is no adjudication table, no override, no "resolved" flag.

## Alternatives considered

- An adjudication record (query text, response, resolution) in pv-core. Rejected for this
  pass: it duplicates the EDC's query workflow, and the record that matters (both opinions,
  each version, who wrote what and when) is already in the case and its audit trail.
- A single sponsor-only causality with the investigator's kept as free text. Rejected: the
  EU text requires both opinions in the report and E2B carries both structurally.

## Consequences

A medical monitor who disagrees with a site records the disagreement by assessing, and the
system shows it everywhere the two opinions matter. FDA and EU obligations can diverge on the
same case by design; the case page shows both. Whether a US-only deployment wants the FDA
rules on `sponsor` or `either` is a rule setting, not code.
