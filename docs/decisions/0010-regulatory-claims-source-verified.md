# ADR-0010: Regulatory claims are verified against source text, never written from model memory

**Status**: accepted · 2026-08-17

## Decision

Any statement attributing a requirement, timeline, definition, or code to ICH E2A, E2B(R3),
E2F, 21 CFR Part 11 or 312.32, Regulation (EU) 536/2014, GAMP 5, or MedDRA, in docs, ADRs,
migration comments, test names, or the validation pack, is checked against the full text
in the maintainers' verified source library before it lands, citing the section. The
library lives at `~/Documents/gh-mskcc/clinical-standards-library/sources/`
(integrity-checked via `MANIFEST.sha256`); the distilled reference used while writing this
repository is `~/.claude/skills/clinical-regs/references/ich-e2-pharmacovigilance.md`.
Texts not in the library (21 CFR 312.32, the CIOMS I form, FDA Form 3500A) are cited to
the authoritative public source with an access date until they are added.

## Rationale

From-memory regulatory text is a known hallucination risk; a plausible paraphrase drifts
subtly out of date, and in a compliance-positioned product a wrong citation is an audit
finding. ctms-core recorded the same rule (its ADR-0012) after catching a from-memory
GAMP claim that was subtly wrong.

## Consequences

Compliance claims in docs never run ahead of the code. When a control ships,
`docs/03-compliance.md` and its mirror `site/src/content/docs/compliance.md` are updated
together and the honest-gaps list stays honest. The sibling repositories' CLAUDE.md files
still point at an older library path; this repository points at the current one.
