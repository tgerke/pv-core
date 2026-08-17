# ADR-0009: E2B(R3) is the shape of the case record; export is JSON now, XML when the schema is source-verified

**Status**: accepted · 2026-08-17

## Decision

Tables and columns follow the ICH E2B(R3) Implementation Guide sections (C.1, C.2.r, C.5,
D, E.i, F.r, G.k, G.k.9.i, H), with element IDs in the schema comments.
`GET /case-versions/{id}/e2b.json` exports a version as JSON keyed by element ID. XML
serialization against the ICH schema package lands only when that package is in the
verified source library and can be validated locally.

## Rationale

Shaping the record by E2B(R3) means an ICSR can be exported without a mapping layer and
that the minimum-validity check (IG §3.3.1) and code sets (C.1.3, E.i.3.2, E.i.7, G.k.1)
are the standard's own. The IG text is in the source library; the HL7-derived XSDs are
not, and an XML export that claims schema validity without a schema to validate against
would violate ADR-0010.

## Consequences

Regulators accept files, not JSON; the honest gap is stated in docs/06-roadmap.md. Every
E2B code list beyond those the reference summary quotes is grepped from the IG source
before it becomes an enum.
