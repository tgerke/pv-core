---
title: "Glossary"
---

Terms as pv-core uses them, with the standard each comes from. Regulatory citations are
checked against the source text ([ADR-0010](/pv-core/decisions/#adr-0010)).

- **Adverse event (AE)**: any untoward medical occurrence in a subject administered a
  medicinal product, whether or not related (ICH E2A §II.A.1).
- **Adverse drug reaction (ADR)**: a response for which a causal relationship is at least a
  reasonable possibility (E2A §II.A.2).
- **Serious**: results in death, is life-threatening, requires or prolongs hospitalization,
  results in persistent or significant disability, is a congenital anomaly, or is
  otherwise medically important (E2A §II.B). Serious is not severe.
- **Unexpected**: not consistent in nature or severity with the reference safety
  information (E2A §II.C).
- **Anticipated (FDA)**: likely to occur in the study population independent of the drug,
  as a consequence of the disease, of age, or of a background regimen (FDA, Sponsor
  Responsibilities: Safety Reporting Requirements and Safety Assessment for IND and BA/BE
  Studies, December 2025, §III.C). Not the same as expected: an anticipated event that is
  not in the brochure is still unexpected, but the sponsor lists it in the safety
  surveillance plan, does not report it to FDA as an individual IND safety report, and
  reviews it in aggregate (§IV.A.2.a, §V.A). In pv-core it is a sponsor designation
  against the study's list, and only rules marked "excludes anticipated events" act on it.
- **Causality disagreement**: the investigator's and the sponsor's recorded causality
  opinions differ; both stay on the record and travel with the report (Regulation (EU)
  536/2014 Annex III §2.1 ¶4), and each rule's causality basis says whose opinion starts
  its clock.
- **SUSAR**: a suspected unexpected serious adverse reaction: serious, unexpected, and
  reasonably related, judged event by event.
- **Reference safety information (RSI)**: the Investigator's Brochure section or label
  expectedness is judged against; the version in effect when the event occurred applies
  (Regulation (EU) 536/2014 Annex III §2.2(8)).
- **ICSR**: Individual Case Safety Report; valid when it has an identifiable patient, an
  identifiable reporter, at least one event, and at least one suspect drug (ICH E2B(R3)
  IG §3.3.1).
- **Awareness date (day zero)**: the sponsor's first knowledge that the case meets the
  minimum criteria (E2A §III.B.3); every clock counts calendar days from it.
- **Expedited report**: 7 calendar days for fatal or life-threatening unexpected reactions,
  15 for other serious unexpected ones (E2A §III.B; 21 CFR 312.32(c); Regulation (EU)
  536/2014 Article 42(2)).
- **Obligation (expected submission)**: a materialized instance of a reporting rule on a
  case version, with its due date and derived status.
- **Version**: one transmission-worthy state of a case; locks at its first signature.
- **Follow-up / amendment**: a new version carrying new information (a new day zero) or a
  correction without new information (C.1.5 unchanged).
- **Nullification**: a recorded fact that a case is void (E2B(R3) C.1.11.1 = 1).
- **Unblinding fact**: the recorded outcome of a single-subject code-break in the
  randomization system (E2A §III.D).
- **DSUR**: Development Safety Update Report (ICH E2F); pv-core serves its line listing
  (§3.7.2) and SAE tabulation (§3.7.3).
- **Acknowledgement**: a regulator's receipt of an ICSR (E2B(R3) IG §4.0: AA/AE/AR at batch
  level, CA/CR per message), or a manual receipt.
