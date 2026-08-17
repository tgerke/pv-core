# ADR-0007: Reporting obligations are rules-as-data materialized into expected submissions with a derived clock

**Status**: accepted · 2026-08-17

## Context

Which cases must be reported, to whom, and by when is decided by a small number of rules
that differ by destination and change rarely: ICH E2A §III.B (7 calendar days for fatal or
life-threatening unexpected reactions, with a complete report within 8 more; 15 calendar
days for other serious unexpected reactions), 21 CFR 312.32(c)(1) and (c)(2) for IND
safety reports and (d) for follow-up, Regulation (EU) 536/2014 Article 42(2)(a)–(c) for
SUSARs with Annex III §2.4 restarting the clock at day zero on significant new
information. Incumbent systems encode these in configurable "reporting rule" tables;
spreadsheets encode them in someone's head.

## Decision

1. `reporting_rule` rows carry destination, scope (sponsor, study, product), obligation
   kind, a predicate over per-event flags (`serious`, `unexpected`, `related`,
   `fatal_or_life_threatening`, each nullable meaning "don't care"), the causality basis,
   timeline in calendar days, the submission kinds that satisfy the obligation, and
   effective dates. Rules change by ending one row and inserting another.
2. Day zero is `case_version.awareness_date`: the sponsor's first knowledge that the case
   meets the minimum criteria (E2A §III.B.3). It defaults to the date the information was
   received (C.1.5) and requires a rationale when set otherwise. Due dates are calendar
   days in the sponsor's business time zone.
3. `pv_sync_expected_submissions(case_version_id)` materializes obligations idempotently
   from `v_rule_match`; an `initial` obligation belongs to the earliest version at which
   the rule first matched, a `follow_up` obligation to each later version that carries new
   information. Status is derived in `v_expected_submission_status`; a submission of the
   triggering version or a later one, to the same destination, of a satisfying kind, on
   or before the due date is on time.
4. Fail-safe defaults over-report: an event with no causality assessment on a suspect
   drug is treated as related, and an event with no RSI version in effect is treated as
   unexpected. Both are surfaced in the queue (`causality_assessed`, `expectedness_basis`)
   rather than hidden.

## Alternatives considered

- Timelines in code (a `dueDate(case)` function). Rejected: a CRO's rules differ per
  sponsor and destination, and a due date nobody can explain from data is the tracker
  spreadsheet again.
- A trigger that runs the sync on every write. Rejected in favor of an explicit call
  inside the same transaction, as ctms-core does for expected documents: the write paths
  are few, and a trigger firing per child-row insert would recompute the same version
  many times.

## Consequences

`v_rule_match` is public API: "why does this rule apply to this case" is a query. Rule
edits are recorded as endings and insertions, so a due date computed last year is still
explainable this year. Time-zone discipline is real: every connection pins `PV_TIMEZONE`.
