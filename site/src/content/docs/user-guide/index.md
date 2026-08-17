---
title: "User guide"
---

This guide is for the people who process safety cases: case processors, safety
physicians, and the QA and regulatory staff who work with them. It walks through the
everyday tasks (taking in a serious adverse event, coding and assessing it, watching the
regulatory clock, recording what was sent, and preparing the DSUR listings) as they look
in the app, with no code. If you script against the API or query the database directly,
the [cookbook](/pv-core/cookbook/) covers the same tasks in R and curl.

One idea explains most of what you will see: **the app never asks you to update a
status**. You record facts (a reporter's details arrived, a physician assessed causality,
a report was sent, a regulator acknowledged it), and every state on every page, including
whether a case is reportable and when each report is due, is computed from those facts
each time the page loads. Nothing needs to be remembered, refreshed, or reconciled.

## The pages

- **Queue**: every case you can read, overdue clocks first, with its derived state,
  expedited class, and next due date. Stat tiles count what needs attention today.
- **Case**: the E2B(R3) sections of the latest version (sources, patient, events, drugs,
  assessments, tests, narrative), the obligations and submissions, attachments, the
  facts (signatures, unblinding, nullification), and the audit timeline.
- **Reporting**: expected submissions across studies, grouped by due date, with the
  on-time metrics per study and destination.
- **DSUR**: the interval line listing of serious adverse reactions and the cumulative
  tabulation by system organ class and arm.
- **Admin**: studies, sites, products and their reference safety information,
  destinations, reporting rules, people and grants, dictionaries.
- **Audit**: the audit-chain status, every signature with its hash recomputed, and the
  raw event trail.

## Who sees what

Access is a grant on a person: a role (administrator, case processor, medical reviewer,
read-only, intake service) scoped to a sponsor organization, to a single study, or to the
whole instance. A CRO hosts several sponsors on one instance and their staff never see
each other's cases. The header shows who you are; the app renders only the actions your
grants permit.

Continue with [intake and data entry](/pv-core/user-guide/intake-and-data-entry/).
