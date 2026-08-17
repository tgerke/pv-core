---
title: "Administration"
description: "Setting an instance up for a sponsor's program: studies, sites, products and their reference safety information, destinations and reporting rules, people and grants, dictionaries."
---

The **Admin** page is where a CRO sets an instance up for a sponsor's program. Everything
here is data the case pages read; nothing is configuration in a file. Non-administrators
can open the page and read it; the create forms and actions are absent for them.

## Studies, sites, products

A study belongs to a sponsor organization and lists its investigational products, its
sites (with country, which the reporter and event countries default from), and whether it
is blinded. Products belong to the sponsor too, so a sponsor-scoped grant covers them.

![Admin, Studies: each study with its protocol number, phase, blinding, IND and EU CT numbers, title, sponsor, products, status, and case counts with overdue in red; a one-way Mark active or Close study action; and the create-study form below.](../../../assets/screenshots/admin-studies.webp)

![Admin, Sites: each site with its study, site number, name, location, and status, and the forms to create a site or an organization.](../../../assets/screenshots/admin-sites.webp)

## Reference safety information

For each product, keep the RSI as dated versions: the Investigator's Brochure section (or
label) that lists the expected reactions, effective from a date, with its listed Preferred
Terms and, where useful, a listedness note ("listed as Grade ≤ 3"). Adding a new version
can end the previous one the day before. Expectedness on every event is derived from
these versions by onset date, so keeping them current is what keeps the clocks right.

![Admin, Products and RSI: each product with its substance and sponsor, its dated RSI versions with effective dates and listed Preferred Terms as chips, an End today action per version, and an Add RSI version button.](../../../assets/screenshots/admin-products-rsi.webp)

## Anticipated serious adverse events

For each study, keep the list of serious adverse events its safety surveillance plan
anticipates in the population independent of the drug (FDA, Sponsor Responsibilities:
Safety Reporting Requirements and Safety Assessment for IND and BA/BE Studies, December
2025, §V.A). One row is one medical concept and may carry several Preferred Terms; it
points at the plan section, or, when a concept is added during the trial, carries the
clinical justification the guidance asks for (§VI.A). Rows are dated like RSI versions and
end rather than change. Medical reviewers designate events against this list on the case
(see [coding and assessment](/pv-core/user-guide/coding-and-assessment/#anticipated-serious-adverse-events)),
and a rule marked "excludes anticipated events" holds its clock back for a designated
event.

![Admin, Anticipated events: each study with its concepts, the plan reference or the note that a concept was added during the trial, the effective dates, the approver, whether a predicted rate is recorded, and the Preferred Terms as chips; an End today action per concept and an Add concept button.](../../../assets/screenshots/admin-anticipated-events.webp)

A predicted rate is optional. The guidance wants one, with its basis, when the sponsor uses
a rate to decide when an unblinded look is warranted (§V.A, §VI.C.1.b), and it names the
kinds of sources: placebo databases, historical data, literature, external epidemiological
databases, electronic health records, and disease-specific registries. Public places to
look, checked 2026-08-17:

- ClinicalTrials.gov results (API v2, `resultsSection.adverseEventsModule`), which gives
  per-arm serious-event counts with the number at risk for every registered trial that
  posted results, so a placebo or standard-of-care arm in a comparable population yields a
  rate with a denominator; the AACT database (CTTI) is the same data as a Postgres
  download for bulk queries.
- Project Data Sphere, patient-level control-arm data from oncology trials, prostate
  cancer included, behind a free registration.
- The NCTN/NCORP Data Archive, patient-level data from completed NCI trials under a data
  use agreement; Vivli, YODA, and CSDR for industry trials under a proposal.
- SEER and CDC WONDER for population incidence and mortality; DailyMed labels for the
  adverse reactions of a background regimen.

Two cautions. Coding differs across these sources (CTCAE terms, MedDRA at different
versions, sponsor groupings), so a concept's Preferred Terms rarely map cleanly onto a
published table, and populations differ in age, line of therapy, and seriousness
definitions; the guidance's own footnote asks that the comparison account for that
uncertainty rather than compare two numbers. And pv-core does not compute, suggest, or
check a rate: the number and its source are the sponsor's, entered together, and the app
refuses one without the other.

## Destinations and reporting rules

A destination is a regulator, ethics committee, investigator group, or partner that
receives reports. A rule ties a destination to a timeline and a test over the case, scoped
to a sponsor, a study, or a product. Rules are never edited in place: end the old one and
add the new one, so a due date computed last year is still explainable this year. The
seeded rules cover FDA IND safety reports (21 CFR 312.32), EU SUSARs (Regulation (EU)
536/2014 Article 42), and investigator and IRB notifications. Two attributes decide how a
rule reads the sponsor's judgments: the causality basis (whose opinion starts the clock:
the sponsor's for the seeded FDA IND rules, either party's for the EU, investigator, and
IRB rules) and "excludes anticipated events" (set on the FDA IND rules only). A deployment
that wants a different posture ends the rule and adds one.

![Admin, Destinations: each destination with its kind, sponsor, country, E2B receiver identifier, and default format.](../../../assets/screenshots/admin-destinations.webp)

![Admin, Reporting rules: each rule with its citation, destination, scope, the predicate it applies to written out in prose, its clock and warning window in days, what satisfies it, and its effective dates; an End today action per rule and a Resync obligations button; and the create-rule form.](../../../assets/screenshots/admin-reporting-rules.webp)

## People and grants

A person is an email identity. A grant gives them a role (administrator, case processor,
medical reviewer, read-only, or intake service) at a scope: one study, one sponsor
organization, or the whole instance. Revoking a grant is a dated fact, and every grant
change is in the audit trail.

![Admin, People and grants: each person with their credentials and email and a pill per grant showing the role and its scope (a sponsor organization, a study, or unscoped), a revoke control on each, and the forms to create a person or grant access.](../../../assets/screenshots/admin-people-grants.webp)

## Dictionaries

The list shows the loaded MedDRA releases and marks the demo subset for what it is. Import
a licensed release by pointing the importer at its ASCII directory; the release is loaded
verbatim and its file hash recorded, and new cases code against the default release.

![Admin, Dictionaries: the loaded dictionary with its type, version, term count, an amber demo subset provenance chip, and load date, and the import form that takes a MedDRA version and the server directory of its ASCII distribution.](../../../assets/screenshots/admin-dictionaries.webp)
