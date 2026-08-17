---
title: "Coding and assessment"
---

Reportability rests on three judgments per event: is it serious, is it unexpected, and is
it reasonably related to the study drug. The app records the first as facts on the event,
derives the second from the reference safety information, and records the third per drug
and event for both the reporter and the sponsor.

## Seriousness

The six criteria of ICH E2A §II.B are checkboxes on the event: death, life-threatening,
hospitalization or prolongation, persistent or significant disability, congenital
anomaly, and other medically important condition. Serious is any of them.

## Expectedness

Expectedness is judged against the reference safety information (the Investigator's
Brochure section, or the label) in effect **when the event occurred**. Administrators
keep the RSI as dated versions with their listed Preferred Terms; the app looks up the
version in effect at the event's onset date and marks the event expected if its Preferred
Term is listed and unexpected otherwise. Each event shows the verdict and its basis: the
RSI version consulted and whether the term was listed, or that no RSI was in effect (in
which case the event counts as unexpected, deliberately).

The safety physician can override the derived verdict, in either direction, on the
assessment: a listed term whose reported severity or specificity exceeds the listing is
unexpected (E2A §II.C.2), and the override must carry a rationale.

## Causality

Assessments live in a grid of drug × event × assessor. The reporter's assessment and the
sponsor's are separate rows; each records whether a reasonable possibility of a causal
relationship exists, plus the method, the result wording, and any rechallenge
information. Until the sponsor has assessed an event, the app treats it as related: the
fail-safe direction is to over-report, and the queue flags the case as
"causality unassessed" so the gap is visible rather than silent.

## Medical review and signing

When data entry is complete, send the case to medical review. The physician reviews the
sections and assessments, then signs the medical review and, when satisfied, the approval.
Signing asks you to re-authenticate; the signature records who, when, why, and the
cryptographic hash of the exact version signed. The first signature locks the version. If
something must change afterwards, open a follow-up (new information) or an amendment (a
correction): the app clones the version and the clock follows.
