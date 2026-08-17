---
title: "Coding and assessment"
description: "Seriousness, expectedness against dated reference safety information, causality by drug and event, and the medical-review signature that locks a version."
---

Reportability rests on three judgments per event: is it serious, is it unexpected, and is
it reasonably related to the study drug. The app records the first as facts on the event,
derives the second from the reference safety information, and records the third per drug
and event for both the reporter and the sponsor. The Events tab shows all three at a
glance; the [guided tour](/pv-core/evaluate/tour/#step-coding) follows one event through
them.

![The Events tab of a case in medical review: the reported term, its MedDRA path from LLT through PT to SOC with the code, the hospitalization criterion, onset and outcome, and chips reading serious, unexpected against IB v2.0 §6.3, reporter related, sponsor related.](../../../assets/screenshots/events-tab.webp)

## Seriousness

The six criteria of ICH E2A §II.B are checkboxes on the event: death, life-threatening,
hospitalization or prolongation, persistent or significant disability, congenital
anomaly, and other medically important condition. Serious is any of them.

![Editing the Events tab: each event has a reported term, a dictionary-term search, onset and end dates, outcome, country, and the six seriousness checkboxes; the search shows Neutropenia and Febrile neutropenia with their Preferred Terms and system organ class.](../../../assets/screenshots/events-tab-editing-typeahead.webp)

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

![The Assessments grid: one row per suspect drug, event, and assessor, with related yes or no, method, result, rechallenge, an expectedness override column, and the rationale for any override.](../../../assets/screenshots/assessments-tab.webp)

## Medical review and signing

When data entry is complete, send the case to medical review. The physician reviews the
sections and assessments, then signs the medical review and, when satisfied, the approval.
Signing asks you to re-authenticate; the signature records who, when, why, and the
cryptographic hash of the exact version signed. The first signature locks the version. If
something must change afterwards, open a follow-up (new information) or an amendment (a
correction): the app clones the version and the clock follows.

![A case in medical review as the administrator sees it: the header shows 15-day, SUSAR, and five days overdue; the action bar offers Return to data entry, Sign medical review, Record unblinding, and Nullify.](../../../assets/screenshots/case-2-medical-review.webp)

![The Sign medical review dialog: it explains that the signature records name, time, and meaning bound to the hash of this exact version, asks the reviewer to re-authenticate, shows the version hash, and offers Confirm identity and sign.](../../../assets/screenshots/dialog-sign-medical-review.webp)

![The Signatures panel of an approved case: the medical-review and approval signatures with signer, version, timestamp, re-authentication method, and a green hash matches check beside the signed hash.](../../../assets/screenshots/signatures-card.webp)
