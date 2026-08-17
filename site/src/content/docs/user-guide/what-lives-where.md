---
title: "What lives where"
description: "Three kinds of record share a case: what the site reported, what the sponsor judged, and what the rules derived. Which is which, who writes it, and what stays outside pv-core."
---

A monitor looking at a case asks three different questions and gets them from three
different places: what did the site tell us, what did our physician conclude, and what
does the record say we owe. The app keeps them apart on purpose, and it helps to know the
boundary before a question lands on the wrong side of it.

## What the site reported

The E2B(R3) sections of a version (sources, patient, events, drugs, tests, narrative) and
the reporter's causality row are the site's report, coded as it arrived. The case also
records how it arrived: by email, fax, phone, or an EDC push, and the reference it carried,
with the SAE form attached as a source document. This layer is versioned, cloned into
follow-ups, and locked by the first signature. A reviewer never rewrites it; a correction is
a new version with new information behind it. The EDC's adverse-event page is not this
layer and never becomes it: the site's SAE report is the primary source for the safety
database, it usually arrives before the EDC entry exists, and the two are reconciled, not
merged.

## What the sponsor judged

The sponsor's causality row, the expectedness override against the RSI, the anticipated
designation against the study's list, and the unblinding fact are the medical reviewer's
judgments. They sit beside the reporter's data, never on top of it, and both travel in the
report. Only people with the assess operation write them, and the version hash covers them,
so a signed judgment cannot drift.

Two of these get mixed up at sites and sponsors alike:

- **Expected or unexpected** is judged against the reference safety information (the
  Investigator's Brochure) in effect when the event occurred. Sites do not decide it; the
  app derives it and the physician may override it with a rationale.
- **Anticipated** is a different question with a different owner: is this the kind of
  serious event the study population produces on its own, listed as such in the safety
  surveillance plan? An anticipated event that is not in the brochure is still unexpected.
  The designation is the sponsor's, and its only effect is on rules that say they exclude
  anticipated events (the FDA IND rules in the seed).

When the investigator and the sponsor disagree on causality, both rows stay, the difference
is marked everywhere the two opinions matter, and each rule says whose opinion starts its
clock. See [coding and assessment](/pv-core/user-guide/coding-and-assessment/#when-the-sponsor-disagrees-with-the-site).

## What the rules derived

The transitions, the obligations and their status, what was sent and acknowledged, waivers,
signatures, and the reminders digest are operational records. Nobody enters a status; every
one of them is computed from the two layers above plus the rule rows, on every read. What a
monitor "needs to do" is a queue tile or a digest section that reads those same views:
overdue and due-soon clocks, intake items, stale reviews, unassessed causality, cases where
the investigator and sponsor differ, and anticipated SAEs held from individual reporting
with their other obligations still open. Rules are rows an administrator can read and end,
so a due date is explainable from data a year later.

## What stays outside

pv-core does not hold the EDC's case report form or its queries, so when the sponsor wants
the site to reconsider a causality assessment, the query runs through the EDC or a letter
and the answer arrives here as follow-up information. It does not hold monitoring visits or
other CTMS tasks, TMF filing, or the site's own reporting to its IRB. It tracks the
sponsor's obligations to investigators and ethics committees as destinations, because
those are the sponsor's clocks. And it does not perform the aggregate analysis of
anticipated events: it lists what was designated and what was held back, but the exposure
denominator and the per-arm look belong to the sponsor's safety assessment process (see the
[roadmap](/pv-core/roadmap/)).
