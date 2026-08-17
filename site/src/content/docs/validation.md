---
title: "Validation"
---

pv-core is not validated software. What it does is generate the raw material a validation
program consumes, from live runs, never by hand ([ADR-0017](/pv-core/decisions/#adr-0017)):

- `pnpm validation:iq` checks a running environment: migrations applied, immutability and
  lock triggers present, the audit trigger on every non-exempt table, role privileges, the
  audit chain, storage posture, and auth mode. It writes an installation-qualification
  report and exits non-zero on any failure.
- `pnpm validation:artifacts` runs the test suite with a JSON reporter and writes an
  operational-qualification run report plus a requirement-to-test traceability matrix.
  The join key is the regulatory token that appears verbatim in test names (`§11.10(e)`,
  `E2A §III.B`, `312.32(c)(2)`, `Art. 42(2)`), so the matrix cannot drift from the suite
  without showing it.

Both write to `docs/validation/` in the repository. The formal program (SOPs, risk
assessment, training records, a QMS) is the deploying organization's work; the
[compliance page](/pv-core/compliance/) says exactly which mechanisms exist and which
claims are not made.
