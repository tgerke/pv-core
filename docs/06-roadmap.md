# Feature gaps and roadmap

What a team gets from an incumbent safety database that this system does not yet give
them, and how far the current pass is from the thing a CRO means when a sponsor asks it
to "build us a safety database". The comparison was checked against the vendors' and
directories' own public pages rather than assumed: Oracle Argus Safety, ArisGlobal
LifeSphere Safety, Veeva Vault Safety, and the entry-tier tools (BaseCon, MyPV) that
serve academic sponsors and small biotechs. Sources with access dates are listed at the
bottom.

Two ground rules for reading this page:

- A gap is not a commitment. This project is a product probe; the list below is an honest
  accounting of distance, not a delivery schedule.
- A boundary is not a gap. Several things incumbents sell are things this system has
  decided not to do. Those are restated first so the gap list stays clean.

## Deliberate boundaries (not gaps)

Recorded in docs/01-vision.md and the decision log; restated here because a feature
comparison is meaningless without them.

- Subject-level adverse-event capture. The EDC owns it. Serious events arrive here by
  entry or intake; the AE log itself never does.
- Unblinding. The randomization system breaks the blind; pv-core records the fact
  (ADR-0008).
- Regulator gateway transmission. FDA ESG and EudraVigilance accounts, certificates, and
  the transmission itself belong to the deploying organization. pv-core produces the files
  and records what was sent and acknowledged.
- Post-marketing spontaneous workflow and PSUR/PBRER. The E2B(R3) model carries a
  spontaneous report type, but the workflow, rules, and aggregate views are written for
  study cases and the DSUR.
- Signal detection and literature monitoring. Out of scope this phase; disproportionality
  over the API is a cookbook example, not a module.
- The validation program. The software generates its raw material (IQ/OQ reports,
  traceability matrix); SOPs, risk assessment, and training are the deploying
  organization's work.
- Tenancy. One instance per CRO; sponsors are a scope, not a tenant (ADR-0015).

## What a "build us a safety database" engagement needs

| A CRO engagement needs | After this pass |
| --- | --- |
| Case processing lifecycle with follow-up versions, medical review, approval, closure | Yes. A QC step distinct from medical review is a gap; only a return-to-entry transition exists. |
| MedDRA coding | Yes, against a licensed release you load yourself (`pnpm db:import-meddra`); nothing licensed ships in the repository. |
| WHODrug coding of concomitant medications | No. The dictionary tables already accommodate it; the importer and UI do not. |
| CIOMS I and MedWatch 3500A as submission-ready PDFs | Yes, rendered from the signed version with field lists transcribed from the official forms (ADR-0012), stored as the submission payload. |
| An E2B(R3) file a regulator or EudraVigilance accepts | Partly. Export is JSON keyed by E2B(R3) element IDs. Schema-valid XML waits until the ICH schema package is in the verified source library (ADR-0009). Since April 1, 2026 FAERS requires E2B(R3) for IND safety reports from non-exempt INDs, so this is the first arc for a commercial-sponsor CRO; noncommercial INDs may still send the 3500A PDF this system renders. |
| Gateway transmission | Boundary; see above. |
| 7-day and 15-day clocks, compliance metrics, reminders | Yes: the reporting-obligation engine, `v_reporting_compliance`, and `pnpm digest`. |
| Source documents on the case | Yes: content-addressed attachments; WORM with the s3 driver and Object Lock. |
| DSUR line listings and cumulative SAE tabulation | Yes as views. Exposure tables and the remaining DSUR sections are not generated. |
| PSUR/PBRER | Boundary this phase. |
| SAE reconciliation with the EDC | No. The intake seam and a reconciliation listing are the next arc; the case now records how each report arrived (`received_via`). |
| Investigator/sponsor causality disagreement | Yes. Both opinions are kept and transmitted, the difference is derived and surfaced (queue, DSUR comment, digest), and each rule says whose opinion starts its clock (ADR-0020). Resolution with the site runs through the EDC query or correspondence, never an in-app adjudication. |
| Anticipated SAE lists and aggregate review under FDA's December 2025 IND safety reporting guidance | Partly. The dated study list, the sponsor's per-event designation, and the rule carve-out are here and every held-back report is named (ADR-0019); the aggregate analysis (observed against predicted, per-arm imbalance) is not, because pv-core holds no exposure denominator. |
| A site-facing SAE report form | No. Sites report by their SAE form, phone, fax, or the EDC; the New case form and the intake service are the two ways in. |
| SSO, role-based access, sponsor segregation on one instance | Yes: OIDC, grants scoped to a sponsor organization or a study, DML-only runtime role. |
| Validation documentation | Generated IQ/OQ reports and a requirement-to-test traceability matrix (`docs/validation/`). The CSV program is organizational. |
| Duplicate detection, literature monitoring, signal detection | No. |

## Genuine gaps

### Schema-valid E2B(R3) XML

Every incumbent transmits E2B(R3) XML. This system exports the same content as JSON keyed
by element IDs and refuses to claim XML validity it cannot check: the ICH schema package
is not in the verified source library, and a from-memory XSD is exactly the kind of
artifact ADR-0010 forbids. Adding the package to the library unblocks the arc.

### WHODrug and a QC step

Both are routine in incumbent case processing. WHODrug is a licensed dictionary with the
same shape problem MedDRA had (importer, never vendored). A QC state between data entry
and medical review is a small transition to add; it was left out to keep the derived
state machine minimal in the first pass.

### EDC reconciliation

Argus and Vault Safety both offer SAE reconciliation against the sponsor's EDC. Here the
seam is designed (a machine-identity intake, ADR-0001 boundary) but not built; the
reconciliation listing that compares EDC-reported serious events with pv-core cases is
the natural next query.

### Aggregate review of anticipated SAEs

FDA's December 2025 guidance asks the sponsor to compare the observed rate of each
anticipated SAE with a predicted rate from placebo databases, literature, registries, or
records, and to unblind by arm when a trigger is crossed (§VI.C). pv-core has the list and
the designations; it lacks the denominator (participants or participant-years, which the
CTMS or randomization system holds) and the firewalled per-arm view. A monitoring view
that shows pooled counts next to the plan's predicted rate and its source is the next step;
the unblinded imbalance test stays with the sponsor's safety assessment entity.

### A query to the site, and a site-facing form

When the medical reviewer disagrees with the investigator, the request to reconsider goes
through the EDC query or a letter today, and the answer arrives as follow-up information.
A `case_query` record inside pv-core, and a form a site coordinator fills instead of
emailing a PDF, are both plausible next arcs; both were left out so the first pass keeps
the case as the record and the EDC as the site's workflow.

### Duplicate detection, literature, signals

Advanced-tier features in every directory surveyed. Duplicate candidates are a query over
patient identifiers, suspect product, event PT, and onset window and would fit the
views-first design; literature and signal detection are further out.

## Sources

Vendor and directory pages verified 2026-08-17:

- IntuitionLabs, "An Overview of Pharmacovigilance (PV) Software Systems",
  https://intuitionlabs.ai/articles/pharmacovigilance-software-systems-overview
- IntuitionLabs, "Pharmacovigilance Databases: Argus vs. LifeSphere vs. Veeva",
  https://intuitionlabs.ai/articles/argus-vs-lifesphere-vs-veeva-safety-database
- CCRPS, "Top Pharmacovigilance Software Compared (2025 Directory)",
  https://ccrps.org/clinical-research-blog/pharmacovigilance-software-directory-reviews-and-features-compared
- Veeva Vault Safety Help, "Case Processing Overview", https://safety.veevavault.help/en/lr/01171/
- Veeva, "Veeva Safety Features Brief", https://www.veeva.com/resources/veeva-safety-product-brief/
- 21 CFR 312.32 (IND safety reporting), Legal Information Institute,
  https://www.law.cornell.edu/cfr/text/21/312.32
