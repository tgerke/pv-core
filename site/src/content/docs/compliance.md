---
title: "Compliance"
---

What "compliant-by-design" means here: the mechanisms 21 CFR Part 11 and the ICH E2
guidelines require are properties of the database schema, enforced below the
application layer. What it does **not** mean: that this software is validated. Formal
computer system validation (GAMP 5 categorization, risk assessment, IQ/OQ/PQ, SOPs,
training records) is a separate, deliberate program that has not been performed. This
document maps requirement → mechanism so that a future validation effort inherits
architecture instead of retrofit. Every citation below was checked against the source
text in the maintainers' standards library (ADR-0010).

## 21 CFR Part 11: electronic records

| Requirement | Mechanism | Where |
| --- | --- | --- |
| §11.10(a) validation of systems | **Not claimed.** The raw material is generated, not hand-written: `pnpm validation:iq` checks a live environment's controls and `pnpm validation:artifacts` emits an OQ run report and a requirement→test traceability matrix from a live suite run (ADR-0017). Formal CSV remains an organizational program | `packages/db/src/iq.ts`, `tools/validation-artifacts.ts`, `docs/validation/` |
| §11.10(b) accurate and complete copies | Attachments and submitted payloads are content-addressed (SHA-256) and immutable; the API serves the exact bytes at `/files/{sha256}` scoped to the case. Every version hashes to `pv_case_version_sha256()`; `GET /case-versions/{id}/e2b.json` exports the version keyed by E2B(R3) element IDs | `case_attachment`, blob store, `v_signature_integrity` |
| §11.10(c) record protection & retention | Signatures, submissions, acknowledgements, attachments, transitions, unblinding, nullification, listed RSI terms, dictionaries, and audit events reject UPDATE/DELETE via database triggers, for every role. A case version and its children reject them once a signature exists. Cases are never deleted | `pv_forbid_mutation()`, `pv_forbid_locked_version_mutation()`, `pv_case_identity_guard()` in migration 0001 |
| §11.10(d) limited system access | `AUTH_MODE=oidc`: JWTs validated against the IdP's issuer, audience, and JWKS; the verified email claim resolves to a person, or the request is refused; there is never a fallback actor. The API runs as a least-privilege DB role (`pv_app`: DML only, no TRUNCATE/DDL, no direct audit writes). A dev-token mode remains for the demo and is not a Part 11 posture | `apps/api/src/auth.ts`, migration 0002, ADR-0016 |
| §11.10(e) audit trails | Computer-generated, timestamped `audit_event` rows written by AFTER-triggers on every domain-table mutation; append-only; prior values preserved as full row images; **hash-chained** so retroactive edits are detectable (`pv_verify_audit_chain()`, `GET /audit-chain/verify`) | `pv_audit()` in migration 0001, ADR-0003 |
| §11.10(g) authority checks | Role-based grants (`access_grant`: admin / case_processor / medical_reviewer / read_only / ingest → read / enter / assess / sign / submit / administer, scoped to a sponsor organization, a study, or unscoped) enforced per route; grant changes are themselves audited and revocation is a fact. Actor identity is bound per transaction (`pv.actor_id`) | `packages/core/src/authz.ts`, ADR-0015, ADR-0016 |
| §11.50 signature manifestation | `signature` rows carry signer, timestamp, and meaning (medical_review / approval); the case page displays all three | `signature` table, case page |
| §11.70 signature/record linking | A signature stores the version's SHA-256 at signing; the first signature locks the version so the binding cannot drift; `v_signature_integrity` recomputes the hash on demand and `submission` rows copy the hash they sent, which the database checks against an approval signature | `signed_sha256`, `pv_require_approval_for_submission()`, ADR-0006 |
| §11.200 signature components | Signing requires re-authentication: in OIDC mode a freshly issued token for the same subject with `auth_time` inside a short window (default 300 s); method and time are recorded on the signature row and are NOT NULL from birth. The dev-mode stub restates the bearer token: API-shape parity, not a credential challenge | `verifyReauth()`, `POST /case-versions/{id}/sign` |

## ICH E2A, E2B(R3), E2F, and Regulation (EU) 536/2014

| Expectation | Mechanism |
| --- | --- |
| Seriousness criteria (E2A §II.B; E2B(R3) E.i.3.2 a–f) | Six booleans per event; a fatal outcome (E.i.7 = 5) requires the death criterion (CHECK) |
| Expectedness against the reference safety information (E2A §II.C; the RSI version at the moment of occurrence, Reg. 536/2014 Annex III §2.2(8)) | `product_rsi_version` + `rsi_listed_term`; `v_case_event_reportability` derives expectedness against the version in effect at event onset, records the basis, and applies a sponsor override only when a rationale is recorded (E2A §II.C.2) |
| What to expedite: serious, unexpected, and reasonably related, judged event by event (E2A §III.A.1) | `v_case_reportability` and `v_rule_match`; unassessed causality counts as related and is flagged, so the fail-safe direction is to over-report (ADR-0007) |
| Clocks: 7 calendar days for fatal/life-threatening unexpected reactions, 15 for other serious unexpected (E2A §III.B.1–2; 21 CFR 312.32(c)(2), (c)(1); Reg. 536/2014 Art. 42(2)(a)–(b)); follow-up information within 15 days (312.32(d); Annex III §2.4) | Rules are rows (`reporting_rule`); `pv_sync_expected_submissions()` materializes `expected_submission` rows from the awareness date; `v_expected_submission_status` derives due-soon / overdue / submitted / acknowledged / superseded / not-required on every read |
| Day zero is first knowledge that the minimum criteria are met (E2A §III.B.3) | `case_version.awareness_date`, defaulted to the receipt date, with a required rationale when they differ; no obligation exists before the version meets the minimum criteria |
| Minimum valid ICSR: identifiable patient, identifiable reporter, one event, one suspect drug (E2B(R3) IG §3.3.1) | `v_case_minimum_criteria`; medical review, signing, and submission are refused before it holds |
| Worldwide unique identifier constant across transmissions (C.1.8.1); nullification and amendment (C.1.11) | Identity columns guarded by trigger; `case_nullification` fact blocks further versions; `amendment` versions keep C.1.5 |
| One MedDRA version per ICSR, coded at LLT (IG §3.2) | `case_version.dictionary_id`; events snapshot the LLT and its path; the licensed release is loaded verbatim (ADR-0005) |
| Single-subject unblinding for expedited cases (E2A §III.D; Annex III §2.5) | `case_unblinding` fact recorded from the randomization system's code-break; arms never leave that table except through the DSUR aggregate (ADR-0008) |
| DSUR line listing of serious adverse reactions and cumulative SAE tabulation by SOC and arm (E2F §3.7.2, §3.7.3) | `v_dsur_sar_line_listing`, `v_dsur_sae_summary`, served at `/dsur/*` |
| Regulator acknowledgements (E2B(R3) IG §4.0) | `submission_acknowledgement` with the AA/AE/AR/CA/CR codes or a manual receipt; a rejected acknowledgement leaves the obligation visibly `submitted` |

## Honest gaps (current phase)

1. **The validation *program* is not performed.** The software generates its raw material,
   but a CSV dossier also needs SOPs, risk assessment, training records, and a QMS to live
   in. That is organizational work no repository can contain.
2. **Dev mode still exists.** `AUTH_MODE=dev` and the dev-grade role passwords (`pv_app`,
   `pv_readonly`) are demo affordances. A production deployment must run
   `AUTH_MODE=oidc` and rotate the DB role credentials (the deployment checklist in the repository (`docs/05-deployment.md`)); nothing in
   the code forces that choice.
3. **E2B(R3) export is JSON, not schema-validated XML.** The export carries the IG's element
   IDs and code values, but a regulator gateway wants the XML message, and the ICH schema
   package is not in the verified source library (ADR-0009).
4. **WORM depends on deployment.** The s3 driver with Object Lock extends immutability to
   attachment and payload bytes; the default local-directory driver does not.
5. **One instance per CRO; sponsors are a scope, not a tenant.** Segregation rests on grants
   and scoped reads (ADR-0015); there are no per-sponsor keys or isolation guarantees.
6. **`expected_submission` is derived state.** The sync may remove an obligation a still-open
   version stops triggering; the removal is audited, so the history is in `audit_event`,
   not in the row.
7. **Regulatory forms.** CIOMS I and MedWatch 3500A rendering land in this pass under
   ADR-0012 (field lists transcribed from the official documents); until that commit, the
   submission record stores what the CRO actually sent as an attachment.
