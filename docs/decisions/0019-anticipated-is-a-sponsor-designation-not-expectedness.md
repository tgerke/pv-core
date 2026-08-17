# ADR-0019: Anticipated serious adverse events are a dated study list and a per-event sponsor designation; the reporting effect is a rule attribute

**Status**: accepted · 2026-08-17

## Context

FDA's final guidance *Sponsor Responsibilities: Safety Reporting Requirements and Safety
Assessment for IND and Bioavailability/Bioequivalence Studies* (December 2025; announced 90 FR
58250, December 16, 2025; in the verified source library as
`sources/FDA/fda-ind-safety-reporting-sponsor-responsibilities-2025.md`, accessed
2026-08-17) separates two words that were being used interchangeably. Under §III.C an
*expected* adverse reaction is one listed in the investigator's brochure; an *anticipated*
adverse event is one "likely to occur in the study population because the adverse events
(1) reflect consequences of participants' underlying disease or factors such as age and (2)
are events that may occur in the study population unrelated to an effect of a drug (e.g.,
cancer-related deaths in a cancer trial, strokes or acute myocardial infarctions in an older
population)". An anticipated event that is not in the brochure is still unexpected for
reporting purposes.

The consequence is in §IV.A.2.a: such SAEs "do not warrant expedited IND safety reporting as
individual cases"; the sponsor assesses them in aggregate under 21 CFR 312.32(c)(1)(i)(C) and
reports when an imbalance across arms supports a reasonable possibility. §V.A asks the
sponsor's safety surveillance plan to carry "a list of anticipated SAEs for the study
population ... that the sponsor does not plan to report individually, regardless of the
investigator's assessment of causality", coded as MedDRA preferred terms where each entry
"reflect[s] a cohesive medical concept and not necessarily a single PT", together with the
predicted rates and their basis when a trigger approach is used. §VI.A allows a concept that
was not prespecified to be treated as anticipated during the trial, with clinical judgment
and documentation. §VI.C.1.b names the sources of predicted rates: placebo databases,
historical data, literature, external epidemiological databases, electronic health records,
and disease-specific registries.

Nothing in ICH E2A, E2B(R3), E2F, or Regulation (EU) 536/2014 has this concept. The EU text
keeps disease-related events out of *expectedness* (Annex III §2.2 ¶6) and clocks SUSARs on
either party's causality; the closest analogue is the prospective agreement with a regulator
that certain disease-related serious events will not be expedited (E2A §III.D; E6(R3)
§3.13.2(f)). So the designation is real, it is FDA-specific, and it must not leak into rules
that know nothing of it.

## Decision

1. The list is data. `study_anticipated_event` holds one row per medical concept per study:
   label, `prespecified` with a `plan_reference`, or not prespecified with a
   `justification`, an optional `predicted_rate` that never exists without its `rate_unit`
   and `rate_basis` (CHECK), and effective dates. `study_anticipated_event_term` holds the
   preferred terms, immutable. Like an RSI version, a concept ends and is never edited or
   deleted.
2. The sponsor's judgment is data. `case_event_designation` records, per event of a version,
   `anticipated` with the concept it rolls up to (FK required when anticipated) and an
   optional rationale. It is a separate child table: the reporter's event facts stay
   untouched, and the version hash includes designations only when a version has any, so
   every version hashed before this table existed keeps its hash and every signature its
   binding (§11.70). Designations are cloned into follow-up versions and locked by the first
   signature. Only `assess` may write them; they are never accepted on case creation.
3. The reporting effect is a rule attribute. `reporting_rule.excludes_anticipated` makes an
   event the sponsor designated anticipated fail that rule's predicate, and nothing else
   changes: `expedited_class` stays authority-agnostic, EU CTR, investigator and IRB rules
   leave the flag off, and the seed sets it only on the FDA IND 7-day and 15-day rules.
   `v_rule_anticipated_exclusion` names every rule a designation held back, so the API, the
   case page, and the digest show a held-back report rather than a missing one.
4. No rate is ever generated. The seed lists concepts with no rate; the UI disables the
   unit and basis until a rate is typed and then requires the basis; the docs point at
   public sources and say that pv-core does not compute or suggest a rate.
5. Observed-versus-predicted monitoring is deferred. It needs an exposure denominator
   (participants or participant-years) that lives in the CTMS or randomization system, and
   a per-arm view that belongs to a firewalled entity, not to a case-processing screen.

## Alternatives considered

- Columns on `case_event`. Rejected: `pv_case_version_sha256()` hashes whole child rows, so
  a new column changes every existing hash and breaks every signature.
- Automatic designation when the PT is on the list. Rejected: §VI.A calls it clinical
  judgment. The view offers `anticipated_candidate` as a hint; a person designates.
- Free-text designation without a concept. Rejected: a designation that names no concept
  cannot be rolled up for the aggregate review the guidance is about; a during-trial
  judgment is a concept row with a justification.
- A third value on the `expectedness` enum. Rejected: the guidance's point is that the two
  are different questions with different owners (the RSI decides one, the safety
  surveillance plan the other), and a rule predicate over expectedness must not change
  meaning.

## Consequences

An FDA IND rule with the flag can be explained from data: the case shows the held-back rule
with the concept named, `all_susar_anticipated` and the reason string say why, and the
digest lists the case with its other obligations still open. A deployment that disagrees
with the seed's posture ends the rule and inserts one without the flag. The honest gap is
stated in `docs/03-compliance.md` and the roadmap: the aggregate analysis itself, and the
predicted rates it compares against, are outside pv-core.
