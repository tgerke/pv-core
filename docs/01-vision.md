# Vision

## Problem

Drug-safety databases (Oracle Argus, ArisGlobal LifeSphere, Veeva Vault Safety) are
case-processing workflow engines built and priced for pharmaceutical safety departments.
They are good at what they do. But the sponsor seat that academic consortia, investigator-
initiated programs, and the CROs serving them sit in looks different: a handful of
investigational products, a few dozen serious adverse events a year, one or two regulators,
and a safety physician who is also a clinician. In that seat the safety database is
usually a spreadsheet next to a CRO's system, and the questions that matter are relational
ones nobody's spreadsheet answers on its own:

- Which cases are reportable, to which authority, by which date, right now?
- Which 7-day and 15-day clocks are running, and which have already been missed?
- Which serious events were unexpected against the Investigator's Brochure version in
  effect when they happened?
- What goes into this year's DSUR line listing, and how much of it is still blinded?
- Who signed off on the medical assessment of case 14, and what did the record look like
  when they did?

## Thesis

**Reportability and the regulatory clock should be a query over the case record, not a
tracker spreadsheet.**

Three design commitments follow:

1. **A relational ICSR model shaped by ICH E2B(R3).** A case is a row with a worldwide
   unique identifier that never changes; each transmission-worthy state of it is a version
   with reporters, patient, coded events, drugs, drug-by-event assessments, and a
   narrative. Versions are editable until the first signature lands and immutable after
   it. Follow-ups and corrections are new versions.
2. **A reporting-obligation engine.** Rules are rows: destination, timeline, and a
   predicate over seriousness, expectedness, causality, and outcome, evaluated event by
   event. They materialize *expected submissions* with a day-zero and a due date. Whether an
   obligation is pending, due soon, overdue, submitted, acknowledged, superseded by a
   follow-up, or waived is derived by a view on every read; nobody maintains a status
   column.
3. **Compliance as schema, not as feature.** The 21 CFR Part 11 primitives are properties
   of the database: an append-only, hash-chained audit trail written by triggers on every
   mutation; signatures, submissions, and acknowledgements that cannot be updated or
   deleted; case versions locked by trigger once signed; signatures bound to the SHA-256 of
   the version they signed; and a runtime role that can only run DML. An auditor's question
   is also just a query.

The public API is the product; the web UI is its first customer and consumes nothing the
API does not offer. A safety physician working in R gets the same overdue queue and the
same DSUR listing as the dashboard, one `httr2` call away.

## Seat

The sponsor and CRO seat, clinical-trial first. A CRO runs one instance and hosts several
sponsors on it, with access scoped to a sponsor organization or to a single study. The
regulatory model is the pre-approval one: ICH E2A definitions and expedited timelines,
21 CFR 312.32 for IND safety reports, Regulation (EU) 536/2014 Article 42 for SUSARs, and
the DSUR of ICH E2F for periodic reporting. The E2B(R3) case model carries a report type,
so spontaneous post-marketing reports fit the schema, but the workflow, seed, and
documentation are written for study cases.

## Boundaries with the sibling systems

edc-core owns subject-level adverse-event capture; a serious event reaches pv-core by
manual entry today and by a machine-identity intake later, never by sharing a database.
rtsm-core owns unblinding; pv-core records that a subject was unblinded, when, why, and to
which arm, and never computes it. ctms-core owns filing of safety correspondence into the
TMF. Regulator gateway accounts and certificates belong to the deploying organization;
pv-core produces the files.

## Non-goals (current phase)

The formal computer system validation program (the software generates its raw material,
see docs/03-compliance.md); WHODrug coding; E2B(R3) gateway transmission and, until the
ICH schema package is in the verified source library, schema-validated E2B(R3) XML;
PSUR/PBRER aggregate reports for marketed products; signal detection; literature
monitoring; duplicate detection beyond what a query can show; per-sponsor tenancy
guarantees beyond scoped grants; a QC step distinct from medical review.

## What "worth building" would look like

The vertical slice in this repo is the test: if the case queue, the reportability
verdicts, the expected-submission calendar, the DSUR line listing, and the audit
timeline fall out of the schema as plain queries, and a CRO could pilot a program on it
with the honest gaps in docs/06-roadmap.md in view, the thesis holds.
