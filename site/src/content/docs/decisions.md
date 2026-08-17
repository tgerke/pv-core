---
title: "Design decisions"
---

The project keeps a numbered decision log (`docs/decisions/` in the repository). These
records exist so that adopters, auditors, and future maintainers can see *why* the
system is shaped the way it is, not just what it does. Summaries below; the full records
carry rationale, alternatives, and consequences.

## ADR-0001: The seat is sponsor/CRO-side, clinical-trial pharmacovigilance {#adr-0001}

pv-core is built for the sponsor and CRO seat of pre-approval pharmacovigilance: serious adverse events from interventional trials, processed as ICH E2B(R3)-shaped Individual Case Safety Reports, judged against ICH E2A definitions, clocked against 21 CFR 312.32 and Regulation (EU) 536/2014 Article 42, and summarized for the DSUR of ICH E2F. A CRO runs one instance and hosts several sponsors on it.
 Post-marketing spontaneous reporting is supported by the data model (the case carries an E2B(R3) report type) but is not the workflow, seed, or documentation focus.

## ADR-0002: TypeScript + Postgres; R is a client, not the implementation {#adr-0002}

Postgres 16 is the system of record. The backend and frontend are TypeScript end to end (Hono + Drizzle; Vite + React + Tailwind), the same stack as ctms-core. R (the team's analysis stack) consumes the OpenAPI-documented REST API and the `v_*` views.

## ADR-0003: Audit trail written and guarded by the database, not the application {#adr-0003}

Every domain table has an AFTER INSERT/UPDATE/DELETE trigger (`pv_audit()`) that appends an `audit_event` row with the actor, action, entity, full before and after row images, and a SHA-256 hash chained to the previous event. `audit_event`, `signature`, `submission`, `submission_acknowledgement`, `case_attachment`, `case_transition`, `case_unblinding`, `case_nullification`, `rsi_listed_term`, `dictionary`, and `dictionary_term` reject UPDATE and DELETE for every role (`pv_forbid_mutation()`). The API connects as a role that holds DML privileges only (`pv_app`, migration 0002): no DDL, no TRUNCATE, no trigger disablement, no direct writes to `audit_event`. `pv_verify_audit_chain()` replays the chain and reports any break.

## ADR-0004: Status is derived, endings are dated facts, corrections are new rows {#adr-0004}

No table stores a workflow status. A case's state (`intake`, `data_entry`, `medical_review`, `approved`, `submitted`, `closed`, `nullified`) is derived in `v_case_queue` from facts: whether the latest version meets the minimum criteria, the latest recorded transition, whether a signature or a submission exists on it, whether a nullification exists. An obligation's status is derived in `v_expected_submission_status` from due dates, submissions, acknowledgements, waivers, and later versions. Grants, delegations of RSI versions, and rules end by setting a dated ending column, never by delete.

## ADR-0005: MedDRA is loaded verbatim from the licensed files; the seed is a labeled illustrative subset {#adr-0005}

The repository ships no MedDRA content. `pnpm db:import-meddra -- --version <v> --dir <ascii dir>` reads `mdhier.asc` and `llt.asc` from a licensed distribution and loads every Lowest Level Term with its primary path, recording the source hash on the `dictionary` row (`is_demo_subset = false`). The seed creates a small dictionary of common terms for the demo cases, marked `is_demo_subset = true` and labeled "illustrative subset, not MedDRA" wherever it appears.

## ADR-0006: Case versions lock on signature; follow-ups and corrections are new versions {#adr-0006}

`case` is the constant identity. Each transmission-worthy state is a `case_version` (`initial`, `follow_up`, `amendment`) with its own set of child rows (patient, sources, events, drugs, assessments, tests, narrative). A version and its children are mutable while no signature exists on it, and every mutation is audited with before and after images. The first `signature` on a version freezes it: `pv_forbid_locked_version_mutation()` rejects INSERT, UPDATE, and DELETE on the version and every child table from then on. Any later change opens a new version, cloned from the previous one. A `follow_up` carries new source information and its own awareness date; an `amendment` is a sponsor correction with no new source information and keeps C.1.5. `case_nullification` is a fact; a trigger rejects further versions of a nullified case, and a resubmission is a new case with `replaces_case_id`.
 `pv_case_version_sha256(version_id)` hashes the canonical JSON of the version and its children; `signature.signed_sha256` copies it at signing and `v_signature_integrity` recomputes it on demand.

## ADR-0007: Reporting obligations are rules-as-data materialized into expected submissions with a derived clock {#adr-0007}

1. `reporting_rule` rows carry destination, scope (sponsor, study, product), obligation    kind, a predicate over per-event flags (`serious`, `unexpected`, `related`,    `fatal_or_life_threatening`, each nullable meaning "don't care"), the causality basis,    timeline in calendar days, the submission kinds that satisfy the obligation, and    effective dates. Rules change by ending one row and inserting another. 2. Day zero is `case_version.awareness_date`: the sponsor's first knowledge that the case    meets the minimum criteria (E2A §III.B.3). It defaults to the date the information was    received (C.1.5) and requires a rationale when set otherwise. Due dates are calendar    days in the sponsor's business time zone. 3. `pv_sync_expected_submissions(case_version_id)` materializes obligations idempotently    from `v_rule_match`; an `initial` obligation belongs to the earliest version at which    the rule first matched, a `follow_up` obligation to each later version that carries new    information. Status is derived in `v_expected_submission_status`; a submission of the    triggering version or a later one, to the same destination, of a satisfying kind, on    or before the due date is on time. 4. Fail-safe defaults over-report: an event with no causality assessment on a suspect    drug is treated as related, and an event with no RSI version in effect is treated as    unexpected. Both are surfaced in the queue (`causality_assessed`, `expectedness_basis`)    rather than hidden.

## ADR-0008: Unblinding is a stored fact; the randomization system computes it {#adr-0008}

`case_unblinding` records, at most once per case, that a subject's treatment allocation was revealed for safety reporting: arm label and role, when, by whom, why, and the code-break reference in the randomization system. pv-core never computes or infers an arm. The DSUR views read the arm from this fact and print `blinded` where none exists. The `pv_readonly` role cannot read the arm columns; arms reach readers only through the aggregate DSUR view.

## ADR-0009: E2B(R3) is the shape of the case record; export is JSON now, XML when the schema is source-verified {#adr-0009}

Tables and columns follow the ICH E2B(R3) Implementation Guide sections (C.1, C.2.r, C.5, D, E.i, F.r, G.k, G.k.9.i, H), with element IDs in the schema comments. `GET /case-versions/{id}/e2b.json` exports a version as JSON keyed by element ID. XML serialization against the ICH schema package lands only when that package is in the verified source library and can be validated locally.

## ADR-0010: Regulatory claims are verified against source text, never written from model memory {#adr-0010}

Any statement attributing a requirement, timeline, definition, or code to ICH E2A, E2B(R3), E2F, 21 CFR Part 11 or 312.32, Regulation (EU) 536/2014, GAMP 5, or MedDRA, in docs, ADRs, migration comments, test names, or the validation pack, is checked against the full text in the maintainers' verified source library before it lands, citing the section. The library lives at `~/Documents/gh-mskcc/clinical-standards-library/sources/` (integrity-checked via `MANIFEST.sha256`); the distilled reference used while writing this repository is `~/.claude/skills/clinical-regs/references/ich-e2-pharmacovigilance.md`. Texts not in the library (21 CFR 312.32, the CIOMS I form, FDA Form 3500A) are cited to the authoritative public source with an access date until they are added.

## ADR-0011: The docs site is a mirror of docs/, written per slice {#adr-0011}

`site/` is an Astro Starlight site (the tooling ctms-core settled on in its ADR-0033): getting started, a task-based user guide, compliance, validation, SQL access, cookbook, roadmap, glossary, and an ADR index. Its pages are written in the same commit as the feature they describe, not back-filled. `docs/*.md` and the site pages deliberately overlap; a change to one usually needs the other, and `starlight-links-validator` fails the build on broken internal links.

## ADR-0012: Regulatory forms are transcribed from the official documents; a PDF is a rendering of the signed version {#adr-0012}

CIOMS I and FDA MedWatch 3500A PDFs are rendered server-side (pdfkit) from a case version. The field lists and box numbering are transcribed from the official form documents fetched at implementation time (CIOMS I from the Council for International Organizations of Medical Sciences; Form FDA 3500A and its instructions from fda.gov), with URL and access date recorded here when that commit lands. If a form cannot be fetched and verified, the output ships as an "ICH E2A Attachment 1 element report" (the key data elements the source library does carry) and is listed as an honest gap; no form layout is written from memory. A rendered PDF is not the record: the version hash is. Recording a submission stores the exact bytes sent as a content-addressed attachment and copies the version hash onto the submission row.

## ADR-0013: Attachments and payloads are content-addressed; WORM depends on deployment {#adr-0013}

Source documents, correspondence, and submitted payloads are stored as bytes keyed by their SHA-256 in a blob store behind a driver interface (`local` directory for development, `s3` for any S3-compatible store). `case_attachment` rows are immutable and carry the hash, file name, MIME type, size, uploader, and provenance. With the s3 driver and a bucket created with Object Lock, the bytes are WORM; the local driver makes no such guarantee, and `pnpm validation:iq` says which one an environment runs.

## ADR-0014: Reminders are a stateless digest over the views {#adr-0014}

`pnpm digest` (`tools/digest.ts`, `packages/core/src/digest.ts`) reads the derived views for each study and emails the people holding study-wide or sponsor-wide grants: due-soon and overdue obligations, intake items awaiting validity, cases waiting in medical review, and the audit-chain status. It stores nothing and is scheduled by cron. The same data is served at `GET /studies/{id}/digest` so the email is never terminal-only knowledge.

## ADR-0015: Multi-sponsor is a scope on one CRO instance, not a tenant {#adr-0015}

`access_grant` scopes to a sponsor `organization`, to a `study`, or to nothing (instance-wide). Authorization resolves every resource to its study and its sponsor organization and permits the operation when the actor holds a matching grant at any of the three levels. Products, destinations, and rules can be owned by a sponsor organization. One instance per operating organization; the seed shows two sponsors so the scoping has something to hide.

## ADR-0016: OIDC for identity, grants in the database, fresh-token re-authentication for signing {#adr-0016}

`AUTH_MODE=oidc` validates bearer JWTs against the identity provider's issuer, audience, and JWKS; the verified email claim resolves to a `person`, or the request is refused. Machine identities (client-credentials tokens without an email claim) map to provisioned people through `API_SERVICE_SUBJECTS`. Authorization is `access_grant` rows in the database, not IdP roles. Signing a case version requires `reauth_token` in the request body: a freshly issued token for the same subject with `auth_time` inside `REAUTH_MAX_AGE_SECONDS` (default 300); method and time are recorded on the signature row and a database CHECK requires them on every new signature. `AUTH_MODE=dev` keeps static tokens for the demo and restates the bearer token as its re-authentication stub: API-shape parity, not a credential challenge.

## ADR-0017: Validation artifacts are generated from live runs, never hand-edited {#adr-0017}

`pnpm validation:iq` checks a live environment (migrations applied, immutability triggers present, audit trigger on every non-exempt table, role privileges, chain verification, storage posture, auth mode) and emits an installation-qualification report. `pnpm validation:artifacts` runs the test suite with a JSON reporter and emits an operational-qualification run report plus a requirement-to-test traceability matrix, joined on the regulatory tokens that appear verbatim in test names (`§11.10(e)`, `E2A §III.B`, `312.32(c)(2)`, `Art. 42(2)`). Both write to `docs/validation/`, which is never edited by hand.
